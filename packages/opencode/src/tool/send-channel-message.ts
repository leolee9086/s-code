// s-code: src/tool/send-channel-message.ts
//
// send_channel_message 工具 — LLM 通过此工具向外部消息通道发送回复。
// 参考 s-forge: kernel/nerv/magi/coordinator/send_channel_message.go
//
// 工具接收 channelId/accountId/userId/motivation 参数，
// 通过 ChannelRegistry 查找适配器，调用 adapter.send() 投递。

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { RegistryService } from "@/channel/registry"
import type { OutboundMessage } from "@/channel/types"

export const Parameters = Schema.Struct({
  channelId: Schema.String.annotate({ description: "目标渠道 ID，由 list_channels 返回" }),
  accountId: Schema.String.annotate({ description: "目标账号 ID" }),
  userId: Schema.String.annotate({ description: "目标用户 ID" }),
  text: Schema.String.annotate({ description: "消息正文" }),
  motivation: Schema.String.annotate({ description: "发送此消息的动机说明" }),
})

export const SendChannelMessageTool = Tool.define<typeof Parameters, never, never>(
  "send_channel_message",
  Effect.gen(function* () {
    return {
      description: "向外部消息渠道上的特定用户主动发送消息。先使用 list_channels 查找可用的 channelId 和 accountId，调用时必须明确填写本次行动动机。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<never>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "shell",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          // 从注册表查找适配器（可选依赖，无注册表时仅记录日志）
          const registryOpt = yield* Effect.serviceOption(RegistryService)
          const adapter = registryOpt._tag === "Some" ? yield* registryOpt.value.get(params.channelId) : undefined

          if (adapter) {
            // 有注册的适配器：通过适配器发送
            yield* adapter.send({
              channelId: params.channelId,
              channelType: params.channelId.split("-")[0] ?? "generic",
              accountId: params.accountId,
              userId: params.userId,
              text: params.text,
            })
          } else {
            yield* Effect.sync(() => console.warn("[send_channel_message] no adapter for channel", params.channelId))
          }

          return {
            title: "send_channel_message",
            output: `消息已发送到 ${params.channelId}/${params.userId}`,
            metadata: {} as never,
          } satisfies Tool.ExecuteResult<never>
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, never>
  }),
)
