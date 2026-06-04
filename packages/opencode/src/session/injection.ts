// 消息注入系统 — 通用的前缀/后缀注入机制
//
// 允许调用方在 session 的 agent 循环中注入自定义消息序列。
// 前缀注入在首轮 LLM 调用前生效，后缀注入在每轮 LLM 响应后生效。
//
// 编程接口：
//   yield* Injection.Service  → 获取服务实例
//   svc.setPrefix(sessionID, messages)  → 设置下一轮的前缀
//   svc.setSuffix(sessionID, messages)  → 设置每轮后的后缀
//   svc.setSuffixOnce(sessionID, messages) → 设置仅下一轮的后缀
//   svc.onRoundComplete(sessionID, handler) → 注册轮次完成回调
//   svc.clear(sessionID) → 清除所有注入
import { Context, Effect, Layer } from "effect"
import type { PartID, SessionID } from "./schema"
import type { SessionLegacy } from "@opencode-ai/core/session/legacy"

// ---- 类型定义 ----

/** 一条可注入的消息 */
export type InjectionPart = {
  type: "text"
  text: string
  synthetic?: boolean
}

/** 轮次完成事件的上下文，供外部决定是否注入后缀 */
export type RoundCompleteContext = {
  sessionID: SessionID
  round: number
  finish: string | undefined
  toolCalls: Array<{ tool: string; callID: string }>
  lastAssistantMessage: string | undefined
}

/** 外部注入决定 */
export type InjectionDecision =
  | { action: "inject"; parts: InjectionPart[] }
  | { action: "continue" }
  | { action: "stop" }

// ---- 服务接口 ----

export interface Interface {
  /** 为 session 设置前缀消息（首轮注入） */
  readonly setPrefix: (sessionID: SessionID, parts: InjectionPart[]) => Effect.Effect<void>
  /** 为 session 设置后缀消息（每轮后注入） */
  readonly setSuffix: (sessionID: SessionID, parts: InjectionPart[]) => Effect.Effect<void>
  /** 为 session 设置一次性后缀（仅下一轮，用后清除） */
  readonly setSuffixOnce: (sessionID: SessionID, parts: InjectionPart[]) => Effect.Effect<void>
  /** 注册轮次完成回调，返回 InjectionDecision */
  readonly onRoundComplete: (
    sessionID: SessionID,
    handler: (ctx: RoundCompleteContext) => Effect.Effect<InjectionDecision>,
  ) => Effect.Effect<void>
  /** 读取并消费 session 的前缀 */
  readonly consumePrefix: (sessionID: SessionID) => Effect.Effect<InjectionPart[]>
  /** 读取并消费 session 的后缀 */
  readonly consumeSuffix: (sessionID: SessionID) => Effect.Effect<InjectionPart[]>
  /** 获取轮次完成回调 */
  readonly getRoundHandler: (sessionID: SessionID) => Effect.Effect<((ctx: RoundCompleteContext) => Effect.Effect<InjectionDecision>) | null>
  /** 清除 session 的所有注入 */
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
}

// ---- 状态 ----

type SessionState = {
  prefix: InjectionPart[]
  suffix: InjectionPart[]
  suffixOnce: InjectionPart[] | null
  roundHandler: ((ctx: RoundCompleteContext) => Effect.Effect<InjectionDecision>) | null
}

const store = new Map<string, SessionState>()

function getState(sessionID: SessionID): SessionState {
  const key = typeof sessionID === "string" ? sessionID : String(sessionID)
  let s = store.get(key)
  if (!s) {
    s = { prefix: [], suffix: [], suffixOnce: null, roundHandler: null }
    store.set(key, s)
  }
  return s
}

// ---- 实现 ----

function make() {
  const setPrefix: Interface["setPrefix"] = (sessionID, parts) =>
    Effect.sync(() => { getState(sessionID).prefix = parts })

  const setSuffix: Interface["setSuffix"] = (sessionID, parts) =>
    Effect.sync(() => { getState(sessionID).suffix = parts })

  const setSuffixOnce: Interface["setSuffixOnce"] = (sessionID, parts) =>
    Effect.sync(() => { getState(sessionID).suffixOnce = parts })

  const onRoundComplete: Interface["onRoundComplete"] = (sessionID, handler) =>
    Effect.sync(() => { getState(sessionID).roundHandler = handler })

  const consumePrefix: Interface["consumePrefix"] = (sessionID) =>
    Effect.sync(() => {
      const s = getState(sessionID)
      const parts = [...s.prefix]
      s.prefix = []
      return parts
    })

  const consumeSuffix: Interface["consumeSuffix"] = (sessionID) =>
    Effect.sync(() => {
      const s = getState(sessionID)
      // 一次性后缀优先，用后清除
      if (s.suffixOnce) {
        const parts = [...s.suffixOnce]
        s.suffixOnce = null
        return parts
      }
      return [...s.suffix]
    })

  const getRoundHandler: Interface["getRoundHandler"] = (sessionID) =>
    Effect.sync(() => getState(sessionID).roundHandler)

  const clear: Interface["clear"] = (sessionID) =>
    Effect.sync(() => store.delete(typeof sessionID === "string" ? sessionID : String(sessionID)))

  return { setPrefix, setSuffix, setSuffixOnce, onRoundComplete, consumePrefix, consumeSuffix, getRoundHandler, clear }
}

// ---- Effect 服务 ----

export class Service extends Context.Service<Service, Interface>()("@opencode/Injection") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer

export * as Injection from "./injection"
