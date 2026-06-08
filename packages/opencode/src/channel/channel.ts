// 双向通信 Channel Adapter
//
// 定义父子进程之间类型安全的通信协议。
//
// InboundMessage — 子进程 → 父进程（父进程接收）
// OutboundMessage — 父进程 → 子进程（子进程接收）
//
// Channel.Adapter 是一个统一接口，隐藏底层传输细节（HTTP/进程内等）。

import { Context, Effect, Schema } from "effect"

// ─── 类型定义 ────────────────────────────────────────

/** 注入消息的一部分 */
export interface InjectionPart {
  type: "text"
  text: string
  synthetic?: boolean
}

/** 子进程→父进程的入站消息 (TypeScript 联合类型) */
export type InboundMessage =
  | { type: "register"; sessionID: string; httpURL: string; pid?: number }
  | { type: "unregister"; sessionID: string }
  | { type: "heartbeat"; sessionID: string }
  | { type: "roundComplete"; sessionID: string; content: string }

/** 父进程→子进程的出站消息 (TypeScript 联合类型) */
export type OutboundMessage =
  | { type: "inject"; messages: InjectionPart[] }
  | { type: "interrupt" }
  | { type: "shutdown" }

/** 子进程路由信息 */
export interface ChildRoute {
  sessionID: string
  httpURL: string
  pid?: number
  timeRegistered: number
  lastHeartbeat: number
}

/** 轮次完成回调上下文 */
export interface RoundCompleteContext {
  sessionID: string
  content: string
}

// ─── Adapter 接口 ────────────────────────────────────

export interface Adapter {
  /** 向指定子进程发送出站消息 */
  readonly send: (targetSessionID: string, message: OutboundMessage) => Effect.Effect<void>

  /** 注册入站消息处理器（子进程→父进程） */
  readonly onInbound: (
    handler: (msg: InboundMessage) => Effect.Effect<void>,
  ) => Effect.Effect<void>

  /** 注册轮次完成回调 */
  readonly onRoundComplete: (
    handler: (ctx: RoundCompleteContext) => Effect.Effect<void>,
  ) => Effect.Effect<void>

  /** 获取本适配器的 HTTP 地址（用于子进程注册） */
  readonly httpURL: string

  /** 当前已注册的子进程列表 */
  readonly children: () => Effect.Effect<ChildRoute[]>

  /** 检查某个 sessionID 是否已注册 */
  readonly has: (sessionID: string) => Effect.Effect<boolean>

  /** 获取心跳超时的子进程 */
  readonly staleChildren: () => Effect.Effect<ChildRoute[]>

  /** 关闭所有子进程 */
  readonly shutdownAll: () => Effect.Effect<void>
}

// ─── Effect 服务 ─────────────────────────────────────

export class Service extends Context.Service<Service, Adapter>()("@opencode/Channel") {}

// ─── 常量 ────────────────────────────────────────────

/** 最大 spawn 深度，防止无限递归 */
export const MAX_SPAWN_DEPTH = 3

/** spawn depth 在 session metadata 中的 key */
export const SPAWN_DEPTH_KEY = "spawnDepth"

export * as Channel from "./channel"
