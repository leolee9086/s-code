// 中继引擎（Relay Engine）
//
// 管理父子进程之间的 session 路由表和消息中继。
// 同时提供 Channel.Adapter 接口，用于类型安全的双向通信。

import { Context, Effect, Layer } from "effect"
import { Channel } from "@/channel/channel"
import { Injection } from "@/session/injection"
import { SessionID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "forever.relay" })

// 子进程 90 秒无心跳则判定死亡
const HEARTBEAT_TIMEOUT_MS = 90000
// 心跳检查间隔
const HEARTBEAT_CHECK_INTERVAL = 30000

export interface ChildRoute {
  sessionID: string
  httpURL: string
  pid?: number
  timeRegistered: number
  lastHeartbeat: number
}

export interface RelayInterface {
  readonly register: (sessionID: string, httpURL: string, pid?: number) => Effect.Effect<void>
  readonly unregister: (sessionID: string) => Effect.Effect<void>
  readonly heartbeat: (sessionID: string) => Effect.Effect<void>
  readonly inject: (targetSessionID: string, messages: Array<{ type: "text"; text: string; synthetic?: boolean }>) => Effect.Effect<void>
  readonly children: () => Effect.Effect<ChildRoute[]>
  readonly has: (sessionID: string) => Effect.Effect<boolean>
  readonly shutdownAll: () => Effect.Effect<void>
  readonly staleChildren: () => Effect.Effect<ChildRoute[]>
}

export class RelayService extends Context.Service<RelayService, RelayInterface>()(
  "@opencode/ForeverRelay",
) {}

// ─── Channel.Adapter 适配层 ──────────────────────────
// 将 ForeverRelay 的内部实现包装为 Channel.Adapter 接口，
// 供 relayMessage 等工具通过 Channel.Service 使用。

function relayToChannelAdapter(relay: RelayInterface, httpURL: string): Channel.Adapter {
  return {
    httpURL,
    send: (targetSessionID, message) =>
      Effect.gen(function* () {
        switch (message.type) {
          case "inject": {
            yield* relay.inject(targetSessionID, message.messages)
            break
          }
          case "interrupt":
          case "shutdown": {
            // 对于 interrupt/shutdown，通过子进程的 HTTP 端点发送
            const children = yield* relay.children()
            const route = children.find((r) => r.sessionID === targetSessionID)
            if (!route) return
            const endpoint = message.type === "shutdown" ? "/api/relay/shutdown" : "/api/relay/interrupt"
            yield* Effect.tryPromise({
              try: () =>
                fetch(`${route.httpURL}${endpoint}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ targetSessionID }),
                }),
              catch: () => {},
            }).pipe(Effect.ignore)
            break
          }
        }
      }),
    onInbound: () => Effect.void,
    onRoundComplete: () => Effect.void,
    children: () => relay.children().pipe(Effect.map((list) =>
      list.map((r) => ({
        sessionID: r.sessionID,
        httpURL: r.httpURL,
        pid: r.pid,
        timeRegistered: r.timeRegistered,
        lastHeartbeat: r.lastHeartbeat,
      })),
    )),
    has: (sessionID) => relay.has(sessionID),
    staleChildren: () => relay.staleChildren().pipe(Effect.map((list) =>
      list.map((r) => ({
        sessionID: r.sessionID,
        httpURL: r.httpURL,
        pid: r.pid,
        timeRegistered: r.timeRegistered,
        lastHeartbeat: r.lastHeartbeat,
      })),
    )),
    shutdownAll: () => relay.shutdownAll(),
  }
}

export const relayLayer = Layer.effect(
  RelayService,
  Effect.gen(function* () {
    const routes = new Map<string, ChildRoute>()
    const injection = yield* Injection.Service

    // 每 30 秒扫描路由表，清理 90 秒无心跳的子进程
    const heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [sid, route] of routes) {
        if (now - route.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          log.warn("child heartbeat timeout, unregistering", {
            sessionID: sid,
            lastHeartbeat: new Date(route.lastHeartbeat).toISOString(),
          })
          routes.delete(sid)
        }
      }
    }, HEARTBEAT_CHECK_INTERVAL)

    // 父进程退出时通知所有子进程
    const cleanupOnExit = () => {
      for (const [sid, route] of routes) {
        log.info("parent exiting, notifying child", { sessionID: sid, httpURL: route.httpURL })
        try {
          fetch(`${route.httpURL}/api/relay/shutdown`, { method: "POST" }).catch(() => {})
        } catch { /* ignore */ }
      }
      routes.clear()
    }

    if (typeof process !== "undefined" && process.on) {
      process.on("exit", cleanupOnExit)
    }

    const register: RelayInterface["register"] = (sessionID, httpURL, pid) =>
      Effect.sync(() => {
        const now = Date.now()
        routes.set(sessionID, { sessionID, httpURL, pid, timeRegistered: now, lastHeartbeat: now })
        log.info("child registered", { sessionID, httpURL, pid })
      })

    const unregister: RelayInterface["unregister"] = (sessionID) =>
      Effect.sync(() => {
        routes.delete(sessionID)
        log.info("child unregistered", { sessionID })
      })

    const heartbeat: RelayInterface["heartbeat"] = (sessionID) =>
      Effect.sync(() => {
        const route = routes.get(sessionID)
        if (route) {
          route.lastHeartbeat = Date.now()
        }
      })

    const inject: RelayInterface["inject"] = (targetSessionID, messages) =>
      Effect.gen(function* () {
        const route = routes.get(targetSessionID)
        if (!route) {
          log.warn("inject target not found", { targetSessionID })
          return
        }
        yield* injection.setSuffixOnce(targetSessionID as SessionID, messages)
        log.info("injected message to child", { targetSessionID, count: messages.length })
      })

    const children: RelayInterface["children"] = () =>
      Effect.sync(() => [...routes.values()])

    const has: RelayInterface["has"] = (sessionID) =>
      Effect.sync(() => routes.has(sessionID))

    const shutdownAll: RelayInterface["shutdownAll"] = () =>
      Effect.sync(() => {
        cleanupOnExit()
      })

    const staleChildren: RelayInterface["staleChildren"] = () =>
      Effect.sync(() => {
        const now = Date.now()
        return [...routes.values()].filter((r) => now - r.lastHeartbeat > HEARTBEAT_TIMEOUT_MS)
      })

    return RelayService.of({ register, unregister, heartbeat, inject, children, has, shutdownAll, staleChildren })
  }),
)

/** 从 ForeverRelay 提供 Channel.Service 的层 */
export const channelFromRelayLayer = Layer.effect(
  Channel.Service,
  Effect.gen(function* () {
    const relay = yield* RelayService
    const httpURL = process.env["OPENCODE_HTTP_URL"] ?? "http://localhost:0"
    return Channel.Service.of(relayToChannelAdapter(relay, httpURL))
  }),
)

export const defaultLayer = Layer.merge(relayLayer, channelFromRelayLayer)

export * as ForeverRelay from "./relay"
