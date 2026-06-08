import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Channel } from "@/channel/channel"

// 使用 Channel.Adapter 发送中继消息
function relayInject(input: {
  targetSessionID: string
  messages: Array<{ role: string; content: string }>
  mode: "suffix_once"
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const channelOption = yield* Effect.serviceOption(Channel.Service).pipe(Effect.orDie)
    if (channelOption._tag === "None") return
    const adapter = channelOption.value

    // 使用 Channel.Adapter 的 typed send 方法
    yield* adapter.send(input.targetSessionID, {
      type: "inject",
      messages: [{ type: "text", text: input.messages[0]?.content ?? "", synthetic: true }],
    })
  })
}

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

          yield* relayInject({
            targetSessionID: params.targetSessionID,
            messages: [{ role: "user", content: params.messages }],
            mode: "suffix_once",
          })

          return {
            title: "relayMessage",
            output: `消息已发送到副本 ${params.targetSessionID}`,
            metadata: { targetSessionID: params.targetSessionID },
          } satisfies Tool.ExecuteResult<Metadata>
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
