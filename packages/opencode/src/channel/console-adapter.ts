// s-code: src/channel/console-adapter.ts
//
// 控制台通道适配器 — 将出站消息打印到控制台。
// 注册到 Registry 后，send_channel_message 工具可通过此适配器投递消息。

import { Effect } from "effect"
import type { ChannelAdapter } from "./adapter"
import type { ChannelStatus, OutboundMessage } from "./types"
import { Capability } from "./types"

export const makeConsoleAdapter = (id: string): ChannelAdapter => ({
  id,

  start: () => Effect.sync(() => {
    console.log(`[channel:${id}] adapter started`)
  }),

  stop: () => Effect.sync(() => {
    console.log(`[channel:${id}] adapter stopped`)
  }),

  send: (msg: OutboundMessage) => Effect.sync(() => {
    console.log(`[channel:${id}] → ${msg.accountId}/${msg.userId}: ${msg.text?.slice(0, 200)}`)
  }).pipe(Effect.asVoid),

  status: () => Effect.sync((): ChannelStatus => ({
    id,
    connected: true,
    accountID: "console",
    userCount: 1,
  })),

  capabilities: () => Capability.Receive | Capability.ProactiveSend,
})
