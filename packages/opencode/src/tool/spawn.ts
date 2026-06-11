import { Effect, Schema, Option } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import * as SessionLegacy from "@opencode-ai/core/v1/session"
import { getDatabaseChannel } from "@opencode-ai/core/installation/version"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { Channel } from "@/channel/channel"
import path from "path"
import { fileURLToPath } from "url"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "副本的任务描述" }),
  agent: Schema.String.annotate({ description: "副本使用的 subagent 类型" }),
  prompt: Schema.String.annotate({ description: "副本的初始提示词" }),
})

type Metadata = {
  childSessionID: string
  spawnDepth: number
}

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
            return { title: "spawn", output: `Agent "${params.agent}" not found`, metadata: { childSessionID: "", spawnDepth: 0 } } satisfies Tool.ExecuteResult<Metadata>
          }
          if (childAgent.value.mode === "primary") {
            return { title: "spawn", output: "Cannot spawn primary agent", metadata: { childSessionID: "", spawnDepth: 0 } } satisfies Tool.ExecuteResult<Metadata>
          }

          // ── Spawn Depth 检查 ──
          // 读取当前 session 的 spawn depth，防止无限递归
          const parentSession = yield* sessions.get(ctx.sessionID as SessionID).pipe(Effect.option)
          const currentDepth: number = parentSession._tag === "Some"
            ? (parentSession.value.metadata?.[Channel.SPAWN_DEPTH_KEY] ?? 0)
            : 0

          if (currentDepth >= Channel.MAX_SPAWN_DEPTH) {
            return {
              title: "spawn",
              output: `Spawn depth limit reached (${Channel.MAX_SPAWN_DEPTH}). Cannot spawn deeper nested agents.`,
              metadata: { childSessionID: "", spawnDepth: currentDepth },
            } satisfies Tool.ExecuteResult<Metadata>
          }

          // 1. 创建空白子 session，记录 parentID 和 spawn depth
          const childDepth = currentDepth + 1
          const childSession = yield* sessions.create({
            parentID: ctx.sessionID as SessionID,
            metadata: { [Channel.SPAWN_DEPTH_KEY]: childDepth },
          }).pipe(Effect.orDie)

          const parentAgent = yield* agents.get(ctx.agent).pipe(Effect.option, Effect.map((o) => o ?? undefined))
          const childPermission = deriveSubagentSessionPermission({
            parentSessionPermission: [],
            parentAgent: Option.getOrUndefined(parentAgent) as any,
            subagent: childAgent.value,
          })
          yield* sessions.setPermission({ sessionID: childSession.id, permission: childPermission }).pipe(Effect.orDie)

          // 2. 写初始 prompt 到子 session
          if (params.prompt) {
            const now = Date.now()
            const userMsg: SessionLegacy.User = {
              id: MessageID.ascending(),
              sessionID: childSession.id as SessionID,
              role: "user",
              time: { created: now },
              agent: params.agent,
              model: { providerID: "" as any, modelID: "" as any },
            }
            yield* sessions.updateMessage(userMsg).pipe(Effect.orDie)
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: childSession.id as SessionID,
              type: "text",
              text: params.prompt,
            } as SessionLegacy.TextPart).pipe(Effect.orDie)
          }

          // 3. 启动完整实例，通过环境变量传递 spawn depth
          const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
          const binPath = process.execPath?.replace(/\\/g, "/") ?? process.argv[0]
          const isBun = binPath.endsWith("bun") || binPath.endsWith("bun.exe")
          const channel = getDatabaseChannel()
          const cp = require("child_process") as typeof import("child_process")
          const childEnv = {
            ...process.env as Record<string, string>,
            OPENCODE_SPAWN_DEPTH: String(childDepth),
          }

          if (isBun) {
            cp.spawn("cmd", ["/c", "start", "", "cmd", "/c", "bun", "run", "--conditions=browser",
              "./src/index.ts", "--session", childSession.id, "--channel", channel], {
              cwd: pkgDir, detached: true, stdio: "ignore", env: childEnv,
            })
          } else {
            cp.spawn("cmd", ["/c", "start", "", "cmd", "/c", binPath,
              "--session", childSession.id, "--channel", channel], {
              detached: true, stdio: "ignore", env: childEnv,
            })
          }

          return {
            title: `Spawn: ${params.description.slice(0, 60)}`,
            output: `副本已启动。Session: ${childSession.id}。使用 relayMessage 工具与其通信。`,
            metadata: { childSessionID: childSession.id, spawnDepth: childDepth },
          } satisfies Tool.ExecuteResult<Metadata>
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
