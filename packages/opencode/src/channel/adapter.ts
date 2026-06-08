// s-code: src/channel/adapter.ts
//
// 外部通道适配器接口。参考 s-forge kernel/nerv/magi/channel/adapter.go。
// 每个 ChannelAdapter 封装一个外部消息通道的具体通信实现。

import { Effect } from "effect"
import type { ChannelStatus, OutboundMessage } from "./types"
import { Capability } from "./types"

/** 通道适配器接口 */
export interface ChannelAdapter {
  /** 唯一标识，如 "s-code-app"、"wechat-main" */
  readonly id: string

  /** 启动通道（建立连接、开始监听） */
  readonly start: () => Effect.Effect<void>

  /** 停止通道 */
  readonly stop: () => Effect.Effect<void>

  /** 发送消息（MAGI → 外部） */
  readonly send: (msg: OutboundMessage) => Effect.Effect<void>

  /** 当前状态快照 */
  readonly status: () => Effect.Effect<ChannelStatus>

  /** 通道能力位掩码 */
  readonly capabilities: () => Capability
}
