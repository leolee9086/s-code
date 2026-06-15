import { Context, Effect, Layer, Option } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { execSync } from "child_process"
import { Global } from "@opencode-ai/core/global"
import { Log } from "@opencode-ai/core/util/log"
import { Database } from "@opencode-ai/core/database/database"
import { InstallationVersion, InstallationChannel, getDatabaseChannel } from "@opencode-ai/core/installation/version"

import { InstanceState } from "@/effect/instance-state"
import { isEvolveMode, readEvolveMessage } from "@/evolve/file-protocol"
import { Installation } from "@/installation"
import { Session } from "./session"
import type { SessionID } from "./schema"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model, sessionID?: SessionID) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly custom_tools: () => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model, sessionID?: SessionID) {
        const ctx = yield* InstanceState.context
        const startMode = Installation.isLocal() ? "源码(bun run dev)" : "二进制"

        // Session 信息（通过 Effect.context() 避免引入 Service 依赖）
        const sessionInfo = sessionID
          ? yield* Effect.gen(function* () {
              const ctx = yield* Effect.context()
              const sessionsOption = Context.getOption(ctx, Session.Service)
              if (Option.isNone(sessionsOption)) return undefined
              const sessions = sessionsOption.value
              const session = yield* sessions.get(sessionID).pipe(Effect.option)
              if (Option.isNone(session)) return undefined
              const s = session.value
              const childrenCount = yield* sessions.children(sessionID).pipe(
                Effect.map((c) => c.length),
                Effect.catch(() => Effect.succeed(0)),
              )
              return { id: s.id, parentID: s.parentID, version: s.version, childrenCount }
            }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined

        // 系统信息
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const utcOffset = -new Date().getTimezoneOffset()
        const utcStr = `UTC${utcOffset >= 0 ? "+" : ""}${Math.floor(utcOffset / 60)}:${String(utcOffset % 60).padStart(2, "0")}`

        // Git 工作树状态（同步执行 git status，允许失败）
        const gitStatus = yield* Effect.sync(() => {
          try {
            const out = execSync("git status --porcelain", {
              cwd: ctx.worktree, encoding: "utf-8", timeout: 3000,
              stdio: ["pipe", "pipe", "pipe"],
            })
            const lines = out.trim().split("\n").filter(Boolean)
            if (lines.length === 0) return { dirty: false, staged: 0, unstaged: 0, total: 0 }
            let staged = 0
            for (const l of lines) {
              const c = l[0]
              if (c === "M" || c === "A" || c === "D" || c === "R" || c === "C") staged++
            }
            return { dirty: true, staged, unstaged: lines.length - staged, total: lines.length }
          } catch (error) {
            Log.Default.warn("无法执行 git status", {
              worktree: ctx.worktree,
              error: error instanceof Error ? error.message : String(error),
            })
            return undefined
          }
        })

        // Shell 信息
        const shellPath = process.env.SHELL || process.env.ComSpec || ""
        const shellName = shellPath.includes("bash") ? "bash"
          : shellPath.includes("zsh") ? "zsh"
          : shellPath.includes("fish") ? "fish"
          : shellPath.includes("cmd.exe") ? "cmd"
          : shellPath.includes("powershell") || shellPath.includes("pwsh") ? "pwsh"
          : shellPath || "未知"

        // git 分支/提交信息（同步读取，允许失败）
        const gitInfo = yield* Effect.sync(() => {
          try {
            const gitDir = path.join(ctx.worktree, ".git")
            const headPath = path.join(gitDir, "HEAD")
            const head = fs.readFileSync(headPath, "utf-8").trim()
            if (head.startsWith("ref: ")) {
              const branch = head.slice(5)
              try {
                const commitPath = path.join(gitDir, branch)
                const sha = fs.readFileSync(commitPath, "utf-8").trim().slice(0, 12)
                return { branch, commit: sha }
              } catch {
                return { branch, commit: undefined }
              }
            }
            return { branch: "HEAD", commit: head.slice(0, 12) }
          } catch {
            return undefined
          }
        })

        // 常用软件版本（同步检查常见 CLI 工具，允许失败）
        const software: { name: string; version: string }[] = []
        for (const [name, cmd, flag] of [
          ["Node.js", "node", "--version"],
          ["npm", "npm", "--version"],
          ["pnpm", "pnpm", "--version"],
          ["Yarn", "yarn", "--version"],
          ["Git", "git", "--version"],
          ["GitHub CLI", "gh", "--version"],
          ["Rust", "rustc", "--version"],
          ["Cargo", "cargo", "--version"],
          ["Go", "go", "version"],
          ["Python", "python", "--version"],
          ["pip", "pip", "--version"],
          ["Bun", "bun", "--version"],
          ["Docker", "docker", "--version"],
        ] as const) {
          try {
            const out = execSync(`${cmd} ${flag}`, {
              encoding: "utf-8", timeout: 3000,
              stdio: ["pipe", "pipe", "pipe"],
            })
            software.push({ name, version: out.trim().split("\n")[0] })
          } catch (error) {
            Log.Default.debug("工具未安装", {
              tool: name,
              command: `${cmd} ${flag}`,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        const lines: (string | undefined)[] = [
          `你的底层模型是 ${model.api.id}，精确模型 ID 是 ${model.providerID}/${model.api.id}`,
          `以下是你运行环境的一些有用信息：`,
          `<env>`,
          `  工作目录：${ctx.directory}`,
          `  工作区根目录：${ctx.worktree}`,
          `  是否为 git 仓库：${ctx.project.vcs === "git" ? "是" : "否"}`,
          `  平台：${process.platform}`,
          `  当前日期：${new Date().toDateString()}`,
          ``,
          `  <process>`,
          `    启动方式：${startMode}`,
          `    二进制路径：${process.execPath}`,
          `    运行 ID：${process.env.OPENCODE_RUN_ID ?? "未知"}`,
          `    进程角色：${process.env.OPENCODE_PROCESS_ROLE ?? "main"}`,
          `    进程 PID：${process.pid}`,
          `  </process>`,
          ``,
          `  <database>`,
          `    数据库路径：${Database.path()}`,
          `    数据库渠道：${getDatabaseChannel()}`,
          `    数据库文件存在：${fs.existsSync(Database.path()) ? "是" : "否"}`,
          `  </database>`,
          ``,
          `  <paths>`,
          `    数据目录：${Global.Path.data}`,
          `    日志文件：${Log.file()}`,
          `    缓存目录：${Global.Path.cache}`,
          `    临时目录：${Global.Path.tmp}`,
          `  </paths>`,
          ``,
          `  <system>`,
          `    时区：${tz}（${utcStr}）`,
          `    Bun 版本：${Bun.version}`,
          `    CPU 核心：${os.cpus().length}`,
          `    内存：${Math.round(os.totalmem() / (1024 ** 3))} GB`,
          `    主机名：${os.hostname()}`,
          `  </system>`,
          ``,
          `  <shell>`,
          `    默认 Shell：${shellName}`,
          `    路径：${shellPath || "无"}`,
          `  </shell>`,
          ``,
          `  <software>`,
          ...(software.length > 0
            ? software.map(({ name, version }) => `    ${name}：${version}`)
            : [`    未检测到常用软件`]),
          `  </software>`,
          ...(sessionInfo
            ? [
                `  <session>`,
                `    Session ID：${sessionInfo.id}`,
                `    父 Session ID：${sessionInfo.parentID ?? "无（根 session）"}`,
                `    接续次数（子 session 数量）：${sessionInfo.childrenCount}`,
                `    Session 版本：${sessionInfo.version}`,
                `  </session>`,
              ]
            : []),
          ...(isEvolveMode()
            ? [
                `  <mode>`,
                `    进化模式：激活`,
                `    临时目录：${process.env.S_CODE_TEMP ?? "无"}`,
                readEvolveMessage() ? `    消息：${readEvolveMessage()}` : undefined,
                `  </mode>`,
              ]
            : []),
          ``,
          `  <build>`,
          `    版本：${InstallationVersion}`,
          `    渠道：${InstallationChannel}`,
          gitInfo ? `    git 分支：${gitInfo.branch}` : undefined,
          gitInfo?.commit ? `    git commit：${gitInfo.commit}` : undefined,
          gitStatus ? `    工作树：${gitStatus.dirty ? `有 ${gitStatus.total} 个文件更改（暂存 ${gitStatus.staged}，未暂存 ${gitStatus.unstaged}）` : "干净"}` : undefined,
          `  </build>`,
          `</env>`,
        ]

        return [lines.filter((l): l is string => l !== undefined).join("\n")]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "技能提供特定任务的专门指令和工作流程。",
          "当任务与描述匹配时，使用 skill 工具加载技能。",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),

      custom_tools: Effect.fn("SystemPrompt.custom_tools")(function* () {
        const ctx = yield* InstanceState.context
        const toolDir = path.join(ctx.worktree, ".opencode", "tool")

        // 读目录（允许失败）
        let entries: fs.Dirent[]
        try {
          entries = yield* Effect.promise(() =>
            fs.promises.readdir(toolDir, { withFileTypes: true }),
          )
        } catch {
          return undefined
        }

        // 过滤 .ts 文件（排除 _ 前缀的内部文件），收集 name + mtime
        const files: { name: string; mtime: number }[] = []
        for (const e of entries) {
          if (!e.isFile() || !e.name.endsWith(".ts")) continue
          if (e.name.startsWith("_")) continue
          const stat = yield* Effect.promise(() =>
            fs.promises.stat(path.join(toolDir, e.name)).catch(() => null),
          )
          if (stat) files.push({ name: e.name.replace(/\.ts$/, ""), mtime: stat.mtimeMs })
        }
        if (files.length === 0) return undefined

        // mtime 倒序，最多 20 条
        files.sort((a, b) => b.mtime - a.mtime)
        const top = files.slice(0, 20)

        return [
          "以下是当前工作区可用的自定义工具（位于 .opencode/tool/）：",
          ...top.map((f) => `  - ${f.name}`),
          "",
          "优先复用已有工具：若任务与上述工具功能匹配，先用 Read 工具查看其内容，",
          "然后直接在工具调用中填入同名 name 即可调用，无需再次提供代码。",
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
