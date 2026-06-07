import { Effect, Schema, Option } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"

function findAvailablePort(start: number): number {
  return start + Math.floor(Math.random() * 100)
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "副本的任务描述" }),
  agent: Schema.String.annotate({ description: "副本使用的 subagent 类型" }),
  prompt: Schema.String.annotate({ description: "副本的初始提示词" }),
})

type Metadata = {
  childSessionID: string
}

const childPIDs = new Map<string, number>()

export const SpawnTool = Tool.define<typeof Parameters, Metadata, Agent.Service | Session.Service>(
  "spawn",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    return {
      description: "启动一个带独立永续循环的副本。副本将独立执行任务，可通过 relayMessage 与其通信。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const childAgent = yield* agents.get(params.agent).pipe(Effect.option)
          if (Option.isNone(childAgent)) {
            return { title: "spawn", output: `Agent "${params.agent}" not found`, metadata: { childSessionID: "" } } satisfies Tool.ExecuteResult<Metadata>
          }
          if (childAgent.value.mode === "primary") {
            return { title: "spawn", output: "Cannot spawn primary agent", metadata: { childSessionID: "" } } satisfies Tool.ExecuteResult<Metadata>
          }

          // 1. 创建空白子 session（不继承父消息）
          const childSession = yield* sessions.create({ parentID: ctx.sessionID as SessionID }).pipe(Effect.orDie)
          const parentAgent = yield* agents.get(ctx.agent).pipe(Effect.option, Effect.map((o) => o ?? undefined))
          const childPermission = deriveSubagentSessionPermission({
            parentSessionPermission: [],
            parentAgent: Option.getOrUndefined(parentAgent) as any,
            subagent: childAgent.value,
          })
          yield* sessions.setPermission({ sessionID: childSession.id, permission: childPermission }).pipe(Effect.orDie)

          // 2. 构造子进程启动数据
          const childInit = {
            sessionID: childSession.id,
            agent: params.agent,
            prompt: params.prompt,
            permission: childPermission,
            parent: {
              sessionID: ctx.sessionID,
              httpURL: process.env["OPENCODE_HTTP_URL"] ?? "http://localhost:4096",
            },
          }

          // 3. 启动子进程（在 Windows 上打开新控制台窗口）
          if ((params as any).node) {
            // yield* startChildOnNode((params as any).node, childInit) -- 留空：远程节点启动不在本节范围内
          } else {
            // built 二进制下 process.argv[1] 是 CLI 参数而非入口脚本，需要区分
            const binPath = process.execPath?.replace(/\\/g, "/") ?? process.argv[0]
            const isBun = binPath.endsWith("bun") || binPath.endsWith("bun.exe")
            // bun dev 需要传入口脚本（process.argv[1]），built 二进制直接传可执行文件
            const childArgs = isBun
              ? [process.argv[1], "spawn", JSON.stringify(childInit), "--port", String(findAvailablePort(4097))]
              : ["spawn", JSON.stringify(childInit), "--port", String(findAvailablePort(4097))]
            // 确保子进程继承 OPENCODE_CHANNEL（如果父进程通过 --channel 设置了的话）
            const childEnv = { ...process.env as Record<string, string>, PARENT_HTTP_URL: childInit.parent.httpURL }
            let childPid = 0

            if (process.platform === "win32") {
              // Windows: 用 cmd.exe /c start 打开新控制台窗口
              const cp = require("child_process") as typeof import("child_process")
              const proc = cp.spawn("cmd.exe", [
                "/c", "start", "Spawn Session", "cmd", "/c",
                binPath, ...childArgs,
              ], { detached: true, stdio: "ignore", env: childEnv })
              childPid = proc.pid ?? 0
            } else {
              const child = Bun.spawn([binPath, ...childArgs], {
                detached: true, env: childEnv,
              })
              child.unref()
              childPid = child.pid ?? 0
            }

            childPIDs.set(childSession.id, childPid)
          }

          return {
            title: `Spawn: ${params.description.slice(0, 60)}`,
            output: `副本已启动。Session: ${childSession.id}。使用 relayMessage 工具与其通信。`,
            metadata: { childSessionID: childSession.id },
          } satisfies Tool.ExecuteResult<Metadata>
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
