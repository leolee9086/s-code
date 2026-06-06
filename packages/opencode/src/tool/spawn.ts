import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "副本的任务描述" }),
  agent: Schema.String.annotate({ description: "副本使用的 subagent 类型" }),
  prompt: Schema.String.annotate({ description: "副本的初始提示词" }),
})

type Metadata = {
  childSessionID: string
}

export const SpawnTool = Tool.define<typeof Parameters, Metadata, Agent.Service>(
  "spawn",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
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
          const childAgent = yield* agents.get(params.agent)
          if (!childAgent) {
            return { title: "spawn", output: `Agent "${params.agent}" not found`, metadata: { childSessionID: "" } }
          }
          return {
            title: `Spawn: ${params.description.slice(0, 60)}`,
            output: `副本已创建。Agent: ${params.agent}\n使用 relayMessage 工具与其通信。\n注意：跨进程副本需额外配置 spawn 入口点。`,
            metadata: { childSessionID: "pending" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
