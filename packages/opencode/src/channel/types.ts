// s-code: src/channel/types.ts
//
// 外部消息通道的消息类型定义。
// 参考 s-forge kernel/nerv/magi/channel/types.go 设计，保证双向兼容。

// ── 通道类型 ──────────────────────────────────────────

/** 通道能力位掩码 */
export enum Capability {
  /** 可接收消息 */
  Receive = 1 << 0,
  /** 可被主动发送消息 */
  ProactiveSend = 1 << 1,
  /** 支持附件 */
  Attachments = 1 << 2,
}

/** 通道状态 */
export type ChannelStatus = {
  id: string
  connected: boolean
  accountID?: string
  userCount: number
  lastMessageAt?: number
  error?: string
}

/** 消息角色（与 s-forge types.MessageRole 兼容） */
export type MessageRole = "user" | "assistant" | "system" | "tool"

/** 媒体类型 */
export type MediaType = "image" | "video" | "audio" | "file"

/** 媒体附件（与 s-forge channel.MediaAttachment 兼容） */
export interface MediaAttachment {
  type: MediaType
  url?: string
  mimeType?: string
  fileName?: string
  fileSize?: number
}

// ── 消息信封（与 s-forge 完全兼容） ─────────────────────

/**
 * 入站消息。兼容 s-forge InboundMessage，但不限定 channelType 取值。
 * 任何外部程序可以使用任意 channelType 字符串。
 */
export interface InboundMessage {
  channelId: string
  channelType: string
  accountId: string
  userId: string
  nickname?: string
  identityId?: string
  identityDisplayName?: string
  text?: string
  media?: MediaAttachment[]
  conversationToken?: string
  timestamp: number             // Unix 毫秒
}

/** 出站消息（s-forge OutboundMessage 兼容） */
export interface OutboundMessage {
  channelId: string
  channelType: string
  accountId: string
  userId: string
  text?: string
  media?: MediaAttachment[]
  conversationToken?: string
}

// ── 子进程通信协议 ────────────────────────────────────

/** 请求负载类型 */
export type RequestType = "search" | "shell" | "read" | "write" | "edit" | "git" | "execute" | "ping"

/** 子进程请求（stdin 输入） */
export interface WorkerRequest {
  id: string
  type: RequestType
  envelope: OutboundMessage
  payload: unknown
}

/** 子进程响应（stdout 输出） */
export interface WorkerResponse {
  id: string
  status: "success" | "error"
  /** 响应信封复用 InboundMessage，与 s-forge 入站消息字段一致 */
  envelope: InboundMessage
  result?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
