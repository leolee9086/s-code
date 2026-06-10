// Relay HTTP 端点
//
// 父子进程之间的通信中继。

import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ForeverRelay } from "@/forever/relay"
import { Injection } from "@/session/injection"
import { type SessionID } from "@/session/schema"

const RegisterBody = Schema.Struct({
  sessionID: Schema.String,
  httpURL: Schema.String,
  pid: Schema.optional(Schema.Number),
})

const HeartbeatBody = Schema.Struct({
  sessionID: Schema.String,
})

const InjectBody = Schema.Struct({
  targetSessionID: Schema.String,
  messages: Schema.mutable(Schema.Array(
    Schema.Struct({
      type: Schema.Literal("text"),
      text: Schema.String,
      synthetic: Schema.optional(Schema.Boolean),
    }),
  )),
})

export const relayRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const relay = yield* ForeverRelay.RelayService
    const injection = yield* Injection.Service

    function parseBody<T>(req: HttpServerRequest.HttpServerRequest, schema: Schema.Schema<T>) {
      return Effect.gen(function* () {
        const text = yield* Effect.orDie(req.text)
        const parsed = JSON.parse(text)
        return (Schema.decodeUnknownSync(schema as any)(parsed) as T)
      })
    }

    router.add("POST", "/api/relay/register", (req: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const body = yield* parseBody(req, RegisterBody)
        yield* relay.register(body.sessionID, body.httpURL, body.pid)
        return HttpServerResponse.jsonUnsafe({ ok: true })
      }),
    )

    router.add("POST", "/api/relay/unregister", (req: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const body = yield* parseBody(req, HeartbeatBody)
        yield* relay.unregister(body.sessionID)
        return HttpServerResponse.jsonUnsafe({ ok: true })
      }),
    )

    router.add("POST", "/api/relay/inject", (req: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const body = yield* parseBody(req, InjectBody)
        yield* injection.setSuffixOnce(body.targetSessionID as SessionID, body.messages)
        return HttpServerResponse.jsonUnsafe({ ok: true })
      }),
    )

    router.add("POST", "/api/relay/heartbeat", (req: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const body = yield* parseBody(req, HeartbeatBody)
        yield* relay.heartbeat(body.sessionID)
        return HttpServerResponse.jsonUnsafe({ ok: true })
      }),
    )

    router.add("POST", "/api/relay/shutdown", () =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true, shuttingDown: true })),
    )

    router.add("POST", "/api/relay/interrupt", (req: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        yield* parseBody(req, InjectBody)
        return HttpServerResponse.jsonUnsafe({ ok: true, interrupted: true })
      }),
    )
  }),
).pipe(
  Layer.provide([ForeverRelay.relayLayer, Injection.defaultLayer, FSUtil.defaultLayer]),
)
