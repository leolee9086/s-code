import { Effect, Context, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { eq, and, or, isNull, sql, type SQL } from "drizzle-orm"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@opencode-ai/core/database/schema.sql"
import { spawn } from "child_process"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { tmpdir } from "os"

const log = Log.create({ service: "bun.security" })

// ─── 数据库表 ───────────────────────────────────────────────

export const DepWhitelistTable = sqliteTable("dep_whitelist", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  version_constraint: text(),
  approved_by: text().notNull(),
  note: text(),
  session_id: text(),
  ...Timestamps,
})

export const DepBlacklistTable = sqliteTable("dep_blacklist", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  version_constraint: text().notNull(),
  cve: text(),
  severity: text().notNull().default("medium"),
  reason: text(),
  source: text().notNull().default("manual"),
  ...Timestamps,
})

export const DepApprovalLogTable = sqliteTable("dep_approval_log", {
  id: integer().primaryKey({ autoIncrement: true }),
  session_id: text(),
  package_name: text().notNull(),
  version: text(),
  action: text().notNull(),
  decided_by: text().notNull(),
  reason: text(),
  ...Timestamps,
})

// ─── Types ──────────────────────────────────────────────────

export interface ResolvedDep {
  name: string
  version: string
  requestedBy: string
}

export interface CheckResult {
  approved: ResolvedDep[]
  blocked: BlockedDep[]
  pending: ResolvedDep[]
}

export interface BlockedDep extends ResolvedDep {
  reason: string
  cve?: string
  severity?: string
}

export interface CheckOptions {
  packages: string[]
  sessionID: string
  cwd: string
}

export interface ApproveInput {
  name: string
  version: string
  approvedBy: string
  sessionID: string
  note?: string
}

// ─── 内嵌已知恶意包列表 ────────────────────────────────────

const KNOWN_MALICIOUS: Array<{ name: string; reason: string }> = [
  { name: "crossenv", reason: "假装是 cross-env，实际窃取环境变量" },
  { name: "node-fabric", reason: "挖矿程序" },
  { name: "babel-handshake", reason: "后门" },
  { name: "event-stream", reason: "包含依赖 flatmap-stream 恶意后门" },
  { name: "eslint-scope", reason: "ESLint 官方 npm 账号被黑后发布恶意版本" },
  { name: "rc", reason: "npm 官方账号被黑后发布包含恶意代码的版本" },
  { name: "coa", reason: "npm 官方账号被黑后发布包含恶意代码的版本" },
  { name: "ua-parser-js", reason: "npm 官方账号被黑后发布包含恶意代码的版本" },
]

// ─── Service ────────────────────────────────────────────────

export interface Interface {
  readonly resolveAndCheck: (input: CheckOptions) => Effect.Effect<CheckResult>
  readonly approve: (input: ApproveInput) => Effect.Effect<void>
  readonly reject: (input: { name: string; version: string; sessionID: string; reason: string }) => Effect.Effect<void>
  readonly install: (input: { packages: string[]; cwd: string }) => Effect.Effect<boolean>
  readonly syncAdvisories: () => Effect.Effect<number>
  readonly isBlacklisted: (name: string, version: string) => Effect.Effect<BlockedDep | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BunSecurity") {}

// ─── 版本匹配 ──────────────────────────────────────────────

function versionSatisfies(version: string, constraint: string): boolean {
  if (constraint.startsWith("<=")) return compareVersions(version, constraint.slice(2)) <= 0
  if (constraint.startsWith("<")) return compareVersions(version, constraint.slice(1)) < 0
  if (constraint.startsWith(">=")) return compareVersions(version, constraint.slice(2)) >= 0
  if (constraint.startsWith(">")) return compareVersions(version, constraint.slice(1)) > 0
  if (constraint.includes("||")) return constraint.split("||").some((c) => versionSatisfies(version, c.trim()))
  if (constraint.includes(",")) return constraint.split(",").every((c) => versionSatisfies(version, c.trim()))
  return version === constraint
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// ─── 子进程执行辅助 ───────────────────────────────────────

function execCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number },
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }> {
  return Effect.promise(
    () =>
      new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: opts.env ?? { ...(process.env as Record<string, string>) },
          stdio: ["pipe", "pipe", "pipe"],
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        const timer = opts.timeout
          ? setTimeout(() => {
              child.kill()
              reject(new Error(`timeout: ${cmd} ${args.join(" ")}`))
            }, opts.timeout)
          : undefined

        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
        child.on("error", (err) => {
          clearTimeout(timer)
          reject(err)
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({
            stdout: Buffer.concat(stdout).toString(),
            stderr: Buffer.concat(stderr).toString(),
            exitCode: code ?? -1,
          })
        })
      }),
  )
}

// ─── 实现 ──────────────────────────────────────────────────

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const { db } = database

    const isBlacklisted = Effect.fnUntraced(function* (name: string, version: string) {
      // 1. 内嵌黑名单
      const known = KNOWN_MALICIOUS.find((k) => k.name === name)
      if (known) return { name, version, requestedBy: "", reason: known.reason } satisfies BlockedDep

      // 2. 数据库黑名单
      const rows = yield* db
        .select()
        .from(DepBlacklistTable)
        .where(eq(DepBlacklistTable.name, name))
        .all()
        .pipe(Effect.orDie)

      for (const row of rows) {
        if (versionSatisfies(version, row.version_constraint)) {
          return {
            name,
            version,
            requestedBy: "",
            reason: row.reason ?? "黑名单",
            cve: row.cve ?? undefined,
            severity: row.severity,
          } satisfies BlockedDep
        }
      }

      return undefined
    })

    const resolveAndCheck = Effect.fnUntraced(function* (input: CheckOptions) {
      const result: CheckResult = { approved: [], blocked: [], pending: [] }

      let depTree: ResolvedDep[] = []

      // 解析依赖树
      try {
        const tmpDir = path.join(tmpdir(), `bun-sec-${Date.now()}`)
        yield* Effect.promise(() =>
          Bun.$`mkdir -p ${tmpDir}`.then(() =>
            Bun.write(
              path.join(tmpDir, "package.json"),
              JSON.stringify({
                name: "bun-security-check",
                private: true,
                dependencies: Object.fromEntries(input.packages.map((p) => [p, "*"])),
              }),
            ),
          ),
        )

        const result = yield* execCapture("bun", ["install", "--dry-run", "--json"], {
          cwd: tmpDir,
          timeout: 30000,
        })

        // 清理
        yield* Effect.promise(() => Bun.$`rm -rf ${tmpDir}`.catch(() => {})).pipe(Effect.ignore)

        if (result.exitCode === 0 && result.stdout) {
          depTree = parseBunDryRun(result.stdout, input.packages)
        }
      } catch (e) {
        log.warn("依赖树解析失败，使用简单顶层检查", { error: String(e) })
      }

      if (depTree.length === 0) {
        depTree = input.packages.map((p) => {
          const atIdx = p.indexOf("@")
          const name = atIdx > 0 ? p.slice(0, atIdx) : p
          const version = atIdx > 0 ? p.slice(atIdx + 1) : "latest"
          return { name, version, requestedBy: p }
        })
      }

      for (const dep of depTree) {
        const blacklisted = yield* isBlacklisted(dep.name, dep.version)
        if (blacklisted) {
          result.blocked.push(blacklisted)
          continue
        }

        // 白名单检查：无版本约束
        const whitelisted = yield* db
          .select()
          .from(DepWhitelistTable)
          .where(and(eq(DepWhitelistTable.name, dep.name), isNull(DepWhitelistTable.version_constraint)))
          .get()
          .pipe(Effect.orDie)

        if (whitelisted) {
          result.approved.push(dep)
          continue
        }

        // 白名单检查：版本约束匹配
        const versionRows = yield* db
          .select()
          .from(DepWhitelistTable)
          .where(and(eq(DepWhitelistTable.name, dep.name), sql`${DepWhitelistTable.version_constraint} IS NOT NULL`))
          .all()
          .pipe(Effect.orDie)

        const versionMatched = versionRows.some((r) =>
          versionSatisfies(dep.version, r.version_constraint!),
        )

        if (versionMatched) {
          result.approved.push(dep)
          continue
        }

        result.pending.push(dep)
      }

      return result
    })

    const approve = Effect.fnUntraced(function* (input: ApproveInput) {
      yield* db
        .insert(DepWhitelistTable)
        .values({
          name: input.name,
          version_constraint: input.version,
          approved_by: input.approvedBy,
          note: input.note,
          session_id: input.sessionID,
        })
        .run()
        .pipe(Effect.orDie)

      yield* db
        .insert(DepApprovalLogTable)
        .values({
          session_id: input.sessionID,
          package_name: input.name,
          version: input.version,
          action: "approved",
          decided_by: input.approvedBy,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const reject = Effect.fnUntraced(function* (input: { name: string; version: string; sessionID: string; reason: string }) {
      yield* db
        .insert(DepBlacklistTable)
        .values({
          name: input.name,
          version_constraint: input.version,
          reason: input.reason,
          severity: "medium",
          source: "manual",
        })
        .run()
        .pipe(Effect.orDie)

      yield* db
        .insert(DepApprovalLogTable)
        .values({
          session_id: input.sessionID,
          package_name: input.name,
          version: input.version,
          action: "blacklisted",
          decided_by: "user",
          reason: input.reason,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const install = Effect.fnUntraced(function* (input: { packages: string[]; cwd: string }) {
      try {
        const result = yield* execCapture("bun", ["add", ...input.packages], {
          cwd: input.cwd,
          timeout: 120000,
        })
        return result.exitCode === 0
      } catch (e) {
        log.error("依赖安装失败", { error: String(e) })
        return false
      }
    })

    const syncAdvisories = Effect.fnUntraced(function* () {
      try {
        const res = yield* Effect.promise(() =>
          fetch("https://registry.npmjs.org/-/npm/v1/security/advisories?limit=200"),
        )
        const data: any = yield* Effect.promise(() => res.json())

        let count = 0
        const advisories = Object.values(data.advisories ?? {}) as any[]
        for (const advisory of advisories) {
          const cve = advisory.cve?.[0]
          const existing = yield* db
            .select()
            .from(DepBlacklistTable)
            .where(and(eq(DepBlacklistTable.name, advisory.module_name), cve ? eq(DepBlacklistTable.cve, cve) : sql`1=0`))
            .get()
            .pipe(Effect.orDie)

          if (!existing) {
            yield* db
              .insert(DepBlacklistTable)
              .values({
                name: advisory.module_name,
                version_constraint: advisory.vulnerable_versions,
                cve: cve ?? null,
                severity: advisory.severity ?? "medium",
                reason: advisory.overview?.slice(0, 500) ?? null,
                source: "npm_advisory",
              })
              .run()
              .pipe(Effect.orDie)
            count++
          }
        }

        log.info("同步 npm advisory 完成", { count })
        return count
      } catch (e) {
        log.warn("同步 npm advisory 失败", { error: String(e) })
        return 0
      }
    })

    return Service.of({
      resolveAndCheck,
      approve,
      reject,
      install,
      syncAdvisories,
      isBlacklisted,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.orDie,
)

// ─── 依赖树解析 ──────────────────────────────────────────────

function parseBunDryRun(
  output: string,
  topLevel: string[],
): ResolvedDep[] {
  const result: ResolvedDep[] = []
  const topSet = new Set(topLevel.map((p) => p.split("@")[0]))

  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as { name?: string; version?: string; from?: string }
      if (entry.name) {
        result.push({
          name: entry.name,
          version: entry.version ?? "latest",
          requestedBy: topSet.has(entry.name) ? entry.name : (entry.from ?? "transitive"),
        })
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return result
}

export * as BunSecurity from "./bun-security"
