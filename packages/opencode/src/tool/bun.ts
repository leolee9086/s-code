import { Effect, Schema } from "effect"
import { BunSecurity } from "./bun-security"
import * as Tool from "./tool"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { tmpdir } from "os"
import { spawn } from "child_process"
import { InstanceState } from "@/effect/instance-state"
import type { BlockedDep } from "./bun-security"

const SCRIPT_ID_LENGTH = 12

const Parameters = Schema.Struct({
  code: Schema.String.annotate({ description: "要执行的 TypeScript/JavaScript 代码" }),
  description: Schema.String.annotate({
    description: "脚本功能的自然语言描述（一句话），仅用于安全审核上下文，不影响文件名",
  }),
  name: Schema.String.annotate({
    description:
      "脚本的 snake_case 标识符（仅小写字母、数字、下划线，如 parse_csv_config），" +
      "用作保存的文件名和索引键。必须语义化且稳定，便于后续复用与覆盖更新。",
  }),
  packages: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "需要安装的 npm 包，自动解析传递依赖并进行安全检查",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "工作目录（必须传入绝对路径，不传则使用当前会话目录）",
  }),
})

/**
 * 防御性归一化 name → 文件名片段。
 * name 应已是 snake_case；此函数只做兜底清洗，不做语义翻译。
 */
function toFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")   // 非 [a-z0-9_] 统一变 _
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 60) || "script"
}

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
        const instanceCtx = yield* InstanceState.context
        const cwd = params.workdir ?? instanceCtx.directory

        if (params.workdir && !path.isAbsolute(params.workdir)) {
          return {
            output: `❌ workdir 必须传入绝对路径，收到: ${params.workdir}`,
            title: "bun (error)",
            metadata: {} as Record<string, unknown>,
          }
        }

        // ── 依赖安全检查 ──────────────────────────────────────────
        if (params.packages && params.packages.length > 0) {
          const pkgs = [...params.packages]
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

        // ── 脚本持久化 ────────────────────────────────────────────
        // 脚本保存到项目工作树根目录（repo root）下的 .opencode/scripts/。
        const worktreeRoot = instanceCtx.project.worktree
        const scriptsDir = path.join(worktreeRoot, ".opencode", "scripts")
        const filename = `${toFilename(params.name || "script")}.ts`
        const fullPath = path.join(scriptsDir, filename)

        yield* Effect.promise(() =>
          Bun.$`mkdir -p ${scriptsDir}`.catch(() => {}),
        )
        yield* Effect.promise(() => Bun.write(fullPath, params.code))

        // ── 索引记录（便于后续检索已有脚本）──────────────────────
        yield* Effect.promise(() =>
          scriptIndexSave({
            id: `script_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
            description: params.description,
            path: fullPath,
            sessionID: ctx.sessionID,
          }),
        )

        // ── 执行脚本 ──────────────────────────────────────────────
        const resultFile = path.join(tmpdir(), `${scriptId}.result.json`)
        const result = yield* Effect.promise<{ stdout: string; stderr: string; exitCode: number }>(
          () =>
            new Promise((resolve, reject) => {
              const child = spawn(process.execPath, ["run", fullPath], {
                cwd,
                env: {
                  ...(process.env as Record<string, string>),
                  O_SESSION_ID: ctx.sessionID,
                  O_DIRECTORY: cwd,
                  O_WORKTREE: worktreeRoot,
                  O_AGENT: ctx.agent,
                  O_SCRIPT_ID: scriptId,
                  O_SCRIPT_PATH: fullPath,
                  O_RESULT_PATH: resultFile,
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

        const output = result.stderr
          ? `[exit: ${result.exitCode}] [saved: ${fullPath}]\n${result.stdout}\n--- stderr ---\n${result.stderr}`
          : `[exit: ${result.exitCode}] [saved: ${fullPath}]\n${result.stdout}`

        return {
          output,
          title: `bun#${filename}`,
          metadata: {
            scriptId,
            scriptPath: fullPath,
            exitCode: result.exitCode,
            ...(structured !== undefined ? { result: structured } : {}),
          },
        }
      }).pipe(Effect.orDie)

    return {
      description: [
        "在 Bun 运行时中执行 TypeScript/JavaScript 代码，并自动保存为可复用脚本。",
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
        "## 脚本可复用性",
        "- 脚本自动保存到 .opencode/scripts/ 目录，以 name（snake_case）命名；description 仅用于审核",
        "- 同名脚本会被覆盖更新，因此应关注脚本的可复用性和扩展性",
        "- 脚本通过 O_DIRECTORY / O_WORKTREE / O_AGENT 环境变量获取上下文",
        "- 可通过 O_RESULT_PATH 写入 JSON 结构化结果供后续使用",
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

/**
 * 读取全局脚本索引（跨 worktree）。
 * 注意：索引可能包含其他 worktree 的脚本，不用于当前 worktree 的启动注入。
 * 启动注入改用扫 .opencode/scripts/ 目录，见 SystemPrompt.scripts()。
 */
export async function scriptIndexList(): Promise<Array<{ id: string; description: string; path: string }>> {
  const db = scriptIndexPath()
  const data = await Bun.file(db).json().catch(() => ({}))
  return Object.values(data) as Array<{ id: string; description: string; path: string }>
}

export * as Bun from "./bun"
