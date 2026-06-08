// s-code: src/channel/local-adapter.ts
//
// s-code 内置本地通道适配器——将 s-code 自身注册为通道。
// 不依赖 Effect Service，直接通过 JSONL 文件持久化。

import { Effect } from "effect"
import type { ChannelAdapter } from "./adapter"
import type { ChannelStatus, OutboundMessage } from "./types"
import { appendFileSync } from "fs"

/** 创建本地通道适配器 */
export const makeLocalAdapter = (id: string, queuePath: string): ChannelAdapter => {
  let connected = false
  let error: string | undefined

  const writeToQueue = (msg: OutboundMessage) => {
    try {
      appendFileSync(queuePath, JSON.stringify({ ...msg, _timestamp: Date.now(), _direction: "outbound" }) + "\n", "utf-8")
    } catch (e) {
      error = String(e)
    }
  }

  return {
    id,

    start: () => Effect.sync(() => {
      connected = true
      error = undefined
    }),

    stop: () => Effect.sync(() => {
      connected = false
    }),

    send: (msg: OutboundMessage) => Effect.sync(() => {
      writeToQueue(msg)
    }),

    status: () => Effect.sync((): ChannelStatus => ({
      id,
      connected,
      accountID: "s-code",
      userCount: 1,
      error,
    })),

    capabilities: () => 1 | 2, // Receive | ProactiveSend
  }
}
