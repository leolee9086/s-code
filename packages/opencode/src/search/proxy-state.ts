/**
 * 代理状态管理模块
 *
 * 按 session 记忆用户对系统代理的选择，避免同一次对话中反复询问。
 * 状态变化通过 GlobalBus 通知 TUI 更新侧边栏开关。
 *
 * 状态流转：
 *   pending → enabled  （用户确认启用 / 侧边栏开关打开）
 *   pending → disabled （用户拒绝 / 侧边栏开关关闭）
 *   enabled ↔ disabled （侧边栏开关切换）
 *
 * 进程级 env 变量（HTTP_PROXY / HTTPS_PROXY）由本模块统一管理，
 * 仅移除本模块设置的变量，不触碰用户启动前已配置的环境变量。
 */
import { Effect, Ref } from "effect"
import type { SessionID } from "@/session/schema"
import { GlobalBus } from "@/bus/global"
import { detectProxyConfig, type ProxyConfig } from "./proxy"

export type ProxyDecision = "enabled" | "disabled"

export interface ProxyStateEntry {
  decision: ProxyDecision
  /** 检测到的代理地址（探测结果，不含环境变量已有值） */
  proxyUrl: string
}

type ProxyStateMap = Map<string, ProxyStateEntry>

// ── 进程级状态 ──────────────────────────────────────────

const stateRef = Effect.runSync(Ref.make<ProxyStateMap>(new Map()))

/** 标记本模块是否设置了 HTTP_PROXY（用于 toggle off 时安全移除） */
const weSetHttpProxy = Effect.runSync(Ref.make(false))
/** 标记本模块是否设置了 HTTPS_PROXY */
const weSetHttpsProxy = Effect.runSync(Ref.make(false))

// ── 事件通知 ──────────────────────────────────────────

const emitChange = (sessionID: SessionID) => {
  const state = Ref.get(stateRef).pipe(
    Effect.map((s) => {
      const entry = s.get(sessionID)
      return entry ?? null
    }),
  )
  Effect.runPromise(
    Effect.map(state, (entry) => {
      GlobalBus.emit("event", {
        payload: {
          type: "session.proxy_state",
          properties: { sessionID, state: entry },
        },
      })
    }),
  ).catch(() => {})
}

// ── 环境变量管理 ──────────────────────────────────────

/** 设置代理环境变量（仅当未被外部预先设置时） */
function applyEnv(proxyUrl: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!process.env.HTTP_PROXY) {
      process.env.HTTP_PROXY = proxyUrl
      yield* Ref.set(weSetHttpProxy, true)
    }
    if (!process.env.HTTPS_PROXY) {
      process.env.HTTPS_PROXY = proxyUrl
      yield* Ref.set(weSetHttpsProxy, true)
    }
    if (!process.env.NO_PROXY) {
      process.env.NO_PROXY = "localhost,127.0.0.0/8,.local"
    }
  })
}

/** 移除本模块设置的代理环境变量 */
function removeEnv(): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (yield* Ref.get(weSetHttpProxy)) {
      delete process.env.HTTP_PROXY
      yield* Ref.set(weSetHttpProxy, false)
    }
    if (yield* Ref.get(weSetHttpsProxy)) {
      delete process.env.HTTPS_PROXY
      yield* Ref.set(weSetHttpsProxy, false)
    }
  })
}

// ── 公开 API ──────────────────────────────────────────

/** 获取当前 session 的代理决策（未设置则返回 undefined） */
export function getDecision(sessionID: SessionID): Effect.Effect<ProxyStateEntry | undefined> {
  return Effect.gen(function* () {
    const state = yield* Ref.get(stateRef)
    return state.get(sessionID)
  })
}

/**
 * 启用代理：记录决策、设置 env、通知 TUI。
 * proxyUrl 应为探测到的代理地址。
 */
export function enable(sessionID: SessionID, proxyUrl: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      const next = new Map(state)
      next.set(sessionID, { decision: "enabled", proxyUrl })
      return next
    })
    yield* applyEnv(proxyUrl)
    emitChange(sessionID)
  })
}

/** 禁用代理：记录决策、移除 env、通知 TUI */
export function disable(sessionID: SessionID): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      const next = new Map(state)
      next.set(sessionID, { decision: "disabled", proxyUrl: "" })
      return next
    })
    yield* removeEnv()
    emitChange(sessionID)
  })
}

/**
 * 侧边栏开关切换：根据当前状态自动 enable/disable。
 * 如果还没有检测过代理，先探测再 enable。
 */
export function toggle(sessionID: SessionID): Effect.Effect<void> {
  return Effect.gen(function* () {
    const current = yield* getDecision(sessionID)
    if (current?.decision === "enabled") {
      yield* disable(sessionID)
      return
    }

    if (current?.decision === "disabled" && current.proxyUrl) {
      yield* enable(sessionID, current.proxyUrl)
      return
    }

    // pending 状态：先探测代理
    const config = yield* detectProxyConfig().pipe(
      Effect.catch(() => Effect.succeed<ProxyConfig>({})),
    )
    const proxyUrl = config.http ?? config.https ?? ""
    if (proxyUrl) {
      yield* enable(sessionID, proxyUrl)
    }
  })
}

/** 清除 session 的代理状态（session 结束时调用） */
export function clear(sessionID: SessionID): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      const next = new Map(state)
      next.delete(sessionID)
      return next
    })
    emitChange(sessionID)
  })
}

export * as ProxyState from "./proxy-state"
