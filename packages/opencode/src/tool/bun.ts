import { Effect, Schema } from "effect"
import { BunSecurity } from "./bun-security"
import * as Tool from "./tool"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { tmpdir } from "os"
import { spawn } from "child_process"
import type { BlockedDep } from "./bun-security"

const SCRIPT_ID_LENGTH = 12

const Parameters = Schema.Struct({
  code: Schema.String.annotate({ description: "要执行的 TypeScript/JavaScript 代码" }),
  packages: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "需要安装的 npm 包，自动解析传递依赖并进行安全检查",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "工作目录（必须传入绝对路径，不传则使用当前会话目录）",
  }),
})

export const BunTool = Tool.define(
  "bun",
  Effect.gen(function* () {
    const security = yield* BunSecurity.Service

    const execute = (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) =>
      Effect.gen(function* () {
        const scriptId = `bun_${crypto.randomUUID().slice(0, SCRIPT_ID_LENGTH)}`
        const cwd = params.workdir ?? (ctx.extra?.directory as string) ?? process.cwd()

        if (params.workdir && !path.isAbsolute(params.workdir)) {
          return {
            output: `❌ workdir 必须传入绝对路径，收到: ${params.workdir}`,
            title: "bun (error)",
            metadata: {} as Record<string, unknown>,
          }
        }

        // 安全检查
        if (params.packages && params.packages.length > 0) {
          const pkgs = [...params.packages] // 解除 readonly
          const check = yield* security.resolveAndCheck({
            packages: pkgs,
            sessionID: ctx.sessionID,
            cwd,
          })

          if (check.blocked.length > 0) {
            return {
              output: [
                "❌ 以下依赖因安全原因被阻止：",
                ...check.blocked.map((d) => `  - ${d.name}@${d.version}: ${d.reason}`),
              ].join("\n"),
              title: "bun (blocked)",
              metadata: {} as Record<string, unknown>,
            }
          }

          if (check.pending.length > 0) {
            yield* ctx.ask({
              permission: "bun.dependencies",
              patterns: check.pending.map((d) => `${d.name}@${d.version}`),
              always: ["*"],
              metadata: {
                scriptId,
                pending: check.pending.map((d) => ({ name: d.name, version: d.version })),
              },
            })

            for (const dep of check.pending) {
              yield* security.approve({
                name: dep.name,
                version: dep.version,
                approvedBy: "user",
                sessionID: ctx.sessionID,
              })
            }
          }

          const installOk = yield* security.install({ packages: pkgs, cwd })
          if (!installOk) {
            return {
              output: "❌ 依赖安装失败",
              title: "bun (install failed)",
              metadata: {} as Record<string, unknown>,
            }
          }
        }

        const tmpFile = path.join(tmpdir(), `${scriptId}.ts`)
        const resultFile = path.join(tmpdir(), `${scriptId}.result.json`)
        yield* Effect.promise(() => Bun.write(tmpFile, params.code))

        const result = yield* Effect.promise<{ stdout: string; stderr: string; exitCode: number }>(
          () =>
            new Promise((resolve, reject) => {
              const child = spawn("bun", ["run", tmpFile], {
                cwd,
                env: {
                  ...(process.env as Record<string, string>),
                  O_SESSION_ID: ctx.sessionID,
                  O_DIRECTORY: cwd,
                  O_AGENT: ctx.agent,
                  O_SCRIPT_ID: scriptId,
                  O_RESULT_PATH: resultFile, // 脚本可向此文件写入结构化结果
                },
                stdio: ["pipe", "pipe", "pipe"],
              })
              const stdout: Buffer[] = []
              const stderr: Buffer[] = []
              child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
              child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
              child.on("error", reject)
              child.on("close", (exitCode) => {
                resolve({
                  stdout: Buffer.concat(stdout).toString(),
                  stderr: Buffer.concat(stderr).toString(),
                  exitCode: exitCode ?? -1,
                })
              })
            }),
        )

        // 读取结构化结果（如果脚本写了的话）
        let structured: unknown = undefined
        const resultFileExists = yield* Effect.promise(() =>
          Bun.file(resultFile).exists().catch(() => false),
        )
        if (resultFileExists) {
          const raw = yield* Effect.promise(() => Bun.file(resultFile).text().catch(() => ""))
          try { structured = JSON.parse(raw) } catch { /* ignore */ }
          yield* Effect.promise(() => Bun.$`rm -f ${resultFile}`.catch(() => {})).pipe(Effect.ignore)
        }

        yield* Effect.promise(() => Bun.$`rm -f ${tmpFile}`.catch(() => {})).pipe(Effect.ignore)

        const output = result.stderr
          ? `[exit: ${result.exitCode}]\n${result.stdout}\n--- stderr ---\n${result.stderr}`
          : `[exit: ${result.exitCode}]\n${result.stdout}`

        return {
          output,
          title: `bun#${scriptId}`,
          metadata: {
            scriptId,
            exitCode: result.exitCode,
            ...(structured !== undefined ? { result: structured } : {}),
          },
        }
      }).pipe(Effect.orDie)

    return {
      description: [
        "在 Bun 运行时中执行 TypeScript/JavaScript 代码。",
        "",
        "## 与 bash 的区别",
        "相比 bash，bun 拥有完整的编程能力：类型安全、无编码问题、可直接操作 JSON、",
        "可 import 任意 npm 包。LLM 对 TypeScript 的掌握远超 bash。",
        "",
        "## 适用场景（优先用 bun，不要用 bash）",
        "- 文件读写 → Bun.file(path).text() / Bun.write(path, content)",
        "- 数据变换 → 原生 JS 处理 JSON/CSV/YAML",
        "- 批量文件操作 → Bun.glob() + 遍历",
        "- 网络请求 → fetch()",
        "- 调用外部命令 → spawn()",
        "- 代码分析、搜索 → fs + RegExp",
        "- 复杂逻辑 → 条件、循环、错误处理",
        "- 安装并使用 npm 包 → 通过 packages 参数自动安装",
        "",
        "## 何时应该用 bash（而不是 bun）",
        "- 需要交互式终端（如 vim、htop）",
        "- 用户明确要求用 shell",
      ].join("\n"),
      parameters: Parameters,
      execute,
    }
  }),
)

// ─── bun.save 工具 ────────────────────────────────────────────

const SaveParameters = Schema.Struct({
  filename: Schema.String.annotate({ description: "脚本文件名（相对于项目 .opencode/scripts/ 目录）" }),
  code: Schema.String.annotate({ description: "完整的 TypeScript/JavaScript 脚本代码" }),
  description: Schema.String.annotate({ description: "脚本功能描述（自然语言，用于后续检索）" }),
  run: Schema.optional(Schema.Boolean).annotate({ description: "保存后立即执行，默认 false" }),
})

export const BunSaveTool = Tool.define(
  "bun_save",
  Effect.gen(function* () {
    const execute = (
      params: Schema.Schema.Type<typeof SaveParameters>,
      ctx: Tool.Context,
    ) =>
      Effect.gen(function* () {
        const worktree = (ctx.extra?.worktree as string) ?? (ctx.extra?.directory as string) ?? process.cwd()
        const scriptsDir = path.join(worktree, ".opencode", "scripts")
        const fullPath = path.join(scriptsDir, params.filename)

        yield* Effect.promise(() =>
          Bun.$`mkdir -p ${path.dirname(fullPath)}`.catch(() => {}),
        )

        yield* Effect.promise(() => Bun.write(fullPath, params.code))

        yield* Effect.promise(() =>
          scriptIndexSave({
            id: `saved_${params.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
            description: params.description,
            path: fullPath,
            sessionID: ctx.sessionID,
          }),
        )

        if (params.run) {
          const result = yield* Effect.promise<{ stdout: string; stderr: string; exitCode: number }>(
            () =>
              new Promise((resolve, reject) => {
                const child = spawn("bun", ["run", fullPath], {
                  cwd: worktree,
                  env: {
                    ...(process.env as Record<string, string>),
                    O_SESSION_ID: ctx.sessionID,
                    O_DIRECTORY: worktree,
                  },
                  stdio: ["pipe", "pipe", "pipe"],
                })
                const stdout: Buffer[] = []
                const stderr: Buffer[] = []
                child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
                child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
                child.on("error", reject)
                child.on("close", (exitCode) => {
                  resolve({
                    stdout: Buffer.concat(stdout).toString(),
                    stderr: Buffer.concat(stderr).toString(),
                    exitCode: exitCode ?? -1,
                  })
                })
              }),
          )

          const output = result.stderr
            ? `[exit: ${result.exitCode}]\n${result.stdout}\n--- stderr ---\n${result.stderr}`
            : `[exit: ${result.exitCode}]\n${result.stdout}`

          return { output, title: "bun.save (ran)", metadata: { path: fullPath, exitCode: result.exitCode } }
        }

        return { output: `脚本已保存至 ${fullPath}`, title: "bun_save", metadata: { path: fullPath } }
      }).pipe(Effect.orDie)

    return {
      description: [
        "将一段 TypeScript/JavaScript 脚本持久化保存到项目目录中。",
        "保存后的脚本会在未来相关任务中自动可用。",
        "",
        "## 何时使用",
        "- 发现一段可复用的数据处理逻辑",
        "- 编写了项目专用的工具函数",
        "- 创建了分析/报告生成脚本",
        "",
        "## 注意事项",
        "- 脚本代码应避免依赖文件系统绝对路径",
        "  （使用 process.env.O_DIRECTORY 或 process.cwd() 替代）",
        "- 每条脚本应包含自然语言说明",
      ].join("\n"),
      parameters: SaveParameters,
      execute,
    } as Tool.DefWithoutID<typeof SaveParameters, { path: string; exitCode?: number }>
  }),
)

// ─── 脚本索引 ────────────────────────────────────────────────

const scriptIndexPath = () => path.join(Global.Path.data, "script-index.json")

async function scriptIndexSave(input: {
  id: string
  description: string
  path: string
  sessionID: string
}) {
  const db = scriptIndexPath()
  const existing = await Bun.file(db).json().catch(() => ({}))
  existing[input.id] = {
    id: input.id,
    description: input.description,
    path: input.path,
    sessionID: input.sessionID,
    createdAt: Date.now(),
  }
  await Bun.write(db, JSON.stringify(existing, null, 2))
}

export async function scriptIndexList(): Promise<Array<{ id: string; description: string; path: string }>> {
  const db = scriptIndexPath()
  const data = await Bun.file(db).json().catch(() => ({}))
  return Object.values(data) as Array<{ id: string; description: string; path: string }>
}

export * as Bun from "./bun"
