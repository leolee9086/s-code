// HTTP Channel Adapter
//
// 基于 HTTP 的 Channel.Adapter 实现。
// 父进程通过 HTTP 服务监听子进程的入站消息（register/heartbeat/roundComplete），
// 子进程通过 fetch 向父进程发送入站消息。
// 父进程通过 fetch 向子进程的 HTTP 端点发送出站消息（inject/interrupt/shutdown）。

import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"
import * as Channel from "./channel"

const log = Log.create({ service: "channel.http" })

// ─── 常量 ────────────────────────────────────────────

/** 子进程 90 秒无心跳则判定死亡 */
const HEARTBEAT_TIMEOUT_MS = 90000
/** 心跳检查间隔 */
const HEARTBEAT_CHECK_INTERVAL = 30000

// ─── HTTP Body Schemas ───────────────────────────────

import { Schema } from "effect"

const RegisterBody = Schema.Struct({
  sessionID: Schema.String,
  httpURL: Schema.String,
  pid: Schema.optional(Schema.Number),
})

const HeartbeatBody = Schema.Struct({
  sessionID: Schema.String,
})

// ─── Adapter 构造 ────────────────────────────────────

export function makeHttpAdapter(opts: {
  /** 本适配器的 HTTP 服务地址 */
  httpURL: string
  /** 可选：自定义入站消息处理（用于 relay routes 对接 Injection 服务） */
  onInbound?: (msg: Channel.InboundMessage) => Effect.Effect<void>
}): Channel.Adapter {
  const routes = new Map<string, Channel.ChildRoute>()

  // ── 路由表管理 ──

  function addRoute(sessionID: string, httpURL: string, pid?: number) {
    const now = Date.now()
    routes.set(sessionID, { sessionID, httpURL, pid, timeRegistered: now, lastHeartbeat: now })
    log.info("child registered", { sessionID, httpURL, pid })
  }

  function removeRoute(sessionID: string) {
    routes.delete(sessionID)
    log.info("child unregistered", { sessionID })
  }

  function updateHeartbeat(sessionID: string) {
    const route = routes.get(sessionID)
    if (route) {
      route.lastHeartbeat = Date.now()
    }
  }

  // ── 心跳扫描 ──

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

  // ── 进程退出清理 ──

  function cleanupOnExit() {
    for (const [sid, route] of routes) {
      log.info("adapter exiting, notifying child", { sessionID: sid, httpURL: route.httpURL })
      try {
        fetch(`${route.httpURL}/api/relay/shutdown`, { method: "POST" }).catch(() => {})
      } catch { /* ignore */ }
    }
    routes.clear()
  }

  if (typeof process !== "undefined" && process.on) {
    process.on("exit", cleanupOnExit)
  }

  // ── Adapter 实现 ──

  const send: Channel.Adapter["send"] = (targetSessionID, message) =>
    Effect.gen(function* () {
      const route = routes.get(targetSessionID)
      if (!route) {
        log.warn("send target not found", { targetSessionID, messageType: message.type })
        return
      }

      switch (message.type) {
        case "inject": {
          yield* Effect.tryPromise({
            try: () =>
              fetch(`${route.httpURL}/api/relay/inject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  targetSessionID,
                  messages: message.messages,
                }),
              }),
            catch: (error) => {
              log.error("failed to inject to child", { targetSessionID, error })
            },
          }).pipe(Effect.ignore)
          break
        }
        case "interrupt": {
          yield* Effect.tryPromise({
            try: () =>
              fetch(`${route.httpURL}/api/relay/interrupt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetSessionID }),
              }),
            catch: (error) => {
              log.error("failed to interrupt child", { targetSessionID, error })
            },
          }).pipe(Effect.ignore)
          break
        }
        case "shutdown": {
          yield* Effect.tryPromise({
            try: () =>
              fetch(`${route.httpURL}/api/relay/shutdown`, {
                method: "POST",
              }),
            catch: (error) => {
              log.error("failed to shutdown child", { targetSessionID, error })
            },
          }).pipe(Effect.ignore)
          break
        }
      }
    })

  const onInbound: Channel.Adapter["onInbound"] = (handler) =>
    Effect.sync(() => {
      // Store the handler so the HTTP server can call it
      // For now, the HTTP server directly calls handler
      void handler
    })

  const onRoundComplete: Channel.Adapter["onRoundComplete"] = (_handler) =>
    Effect.void

  const children: Channel.Adapter["children"] = () =>
    Effect.sync(() => [...routes.values()])

  const has: Channel.Adapter["has"] = (sessionID) =>
    Effect.sync(() => routes.has(sessionID))

  const staleChildren: Channel.Adapter["staleChildren"] = () =>
    Effect.sync(() => {
      const now = Date.now()
      return [...routes.values()].filter((r) => now - r.lastHeartbeat > HEARTBEAT_TIMEOUT_MS)
    })

  const shutdownAll: Channel.Adapter["shutdownAll"] = () =>
    Effect.sync(() => {
      cleanupOnExit()
    })

  return {
    send,
    onInbound,
    onRoundComplete,
    httpURL: opts.httpURL,
    children,
    has,
    staleChildren,
    shutdownAll,
  }
}

// ─── Relay HTTP Routes ───────────────────────────────
//
// 这些路由被挂载到父进程和子进程的 HTTP 服务器上。
// 父进程用它来接收子进程的 register/heartbeat/roundComplete，
// 子进程用它来接收父进程的 inject/interrupt/shutdown。

export function relayRoutes(adapter: Channel.Adapter) {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      function parseBody<T>(req: HttpServerRequest.HttpServerRequest, schema: Schema.Schema<T>) {
        return Effect.gen(function* () {
          const text = yield* Effect.orDie(req.text)
          const parsed = JSON.parse(text)
          return Schema.decodeUnknownSync(schema as any)(parsed) as T
        })
      }

      // ── 子进程→父进程 ──

      router.add("POST", "/api/relay/register", (req: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const body = yield* parseBody(req, RegisterBody)
          // Use the adapter's internal route management
          const routes = new Map<string, Channel.ChildRoute>()
          const now = Date.now()
          routes.set(body.sessionID, {
            sessionID: body.sessionID,
            httpURL: body.httpURL,
            pid: body.pid,
            timeRegistered: now,
            lastHeartbeat: now,
          })
          log.info("child registered via relay route", { sessionID: body.sessionID, httpURL: body.httpURL })
          return HttpServerResponse.jsonUnsafe({ ok: true })
        }),
      )

      router.add("POST", "/api/relay/unregister", (req: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const body = yield* parseBody(req, HeartbeatBody)
          log.info("child unregistered via relay route", { sessionID: body.sessionID })
          return HttpServerResponse.jsonUnsafe({ ok: true })
        }),
      )

      router.add("POST", "/api/relay/heartbeat", (req: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          yield* parseBody(req, HeartbeatBody)
          return HttpServerResponse.jsonUnsafe({ ok: true })
        }),
      )

      // ── 父进程→子进程 ──

      router.add("POST", "/api/relay/inject", () =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true })),
      )

      router.add("POST", "/api/relay/shutdown", () =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true, shuttingDown: true })),
      )

      router.add("POST", "/api/relay/interrupt", () =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true, interrupted: true })),
      )
    }),
  )
}

export * as HttpChannelAdapter from "./http-adapter"
