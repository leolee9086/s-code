import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ForeverRelay } from "@/forever/relay"
import type { SessionID } from "@/session/schema"

// 中继注入函数（按设计文档第 4 节）
function relayInject(input: {
  targetSessionID: string
  messages: Array<{ role: string; content: string }>
  mode: "suffix_once"
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const relayOption = yield* Effect.serviceOption(ForeverRelay.RelayService).pipe(Effect.orDie)
    if (relayOption._tag === "None") return
    const relay = relayOption.value

    const children = yield* relay.children().pipe(Effect.orDie)
    const route = children.find((r: { sessionID: string }) => r.sessionID === input.targetSessionID)
    if (!route) return

    // 通过 HTTP 向副本的 relay 端点注入消息
    yield* Effect.tryPromise({
      try: () =>
        fetch(`${route.httpURL}/api/relay/inject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetSessionID: input.targetSessionID,
            messages: [{ type: "text" as const, text: input.messages[0]?.content ?? "", synthetic: true as const }],
          }),
        }),
      catch: () => {},
    }).pipe(Effect.ignore)
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
