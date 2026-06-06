import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  targetSessionID: Schema.String.annotate({ description: "目标副本的 sessionID" }),
  messages: Schema.String.annotate({ description: "消息内容（纯文本）" }),
})

type Metadata = {
  targetSessionID: string
}

export const RelayMessageTool = Tool.define<typeof Parameters, Metadata, never>(
  "relayMessage",
  Effect.gen(function* () {
    return {
      description: "向指定的 spawn 副本发送消息。副本在下一轮循环中收到。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          return {
            title: "relayMessage",
            output: `消息已排队。目标: ${params.targetSessionID}\n（跨进程中继需额外配置 relay 端点）`,
            metadata: { targetSessionID: params.targetSessionID },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
