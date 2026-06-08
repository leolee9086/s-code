// Queue API handlers + dispatcher
//
// 端到端链路:
//   POST /queue/message → RingQueue.push() → runDispatcher → handler → LLM
//
// 所有 Effect 操作均在运行时内完成，无 runPromise 逃逸。

import { Context, Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { QueuePushPayload } from "../groups/queue"
import { makeRingQueue, runDispatcher, TaskRing } from "@/channel/queue"
import type { RingQueueInterface, MessageRecord } from "@/channel/queue"
import { SessionID } from "@/session/schema"
import { Injection } from "@/session/injection"
import { SessionMapper, SessionMapperLive } from "@/channel/session-mapper"
import { SessionPrompt } from "@/session/prompt"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "queue.handler" })

// ── Queue Service ────────────────────────────────────

export interface QueueServiceInterface {
  readonly push: RingQueueInterface["push"]
  readonly len: RingQueueInterface["len"]
  readonly ringLen: RingQueueInterface["ringLen"]
  readonly bindSession: (token: string, sessionID: string) => void
}

export class QueueService extends Context.Service<QueueService, QueueServiceInterface>()("@opencode/QueueService") {}

// 使用 Layer.provide 在定义时就满足 SessionMapper 依赖，
// 避免在 server.ts 合并 Layer 时类型推断失败。
export const QueueServiceLive = Layer.effect(
  QueueService,
  Effect.gen(function* () {
    const q = makeRingQueue()
    const injection = yield* Injection.Service
    const mapper = yield* SessionMapper
    const promptSvc = yield* SessionPrompt.Service

    yield* Effect.forkScoped(runDispatcher(q, (rec: MessageRecord) =>
      Effect.gen(function* () {
        if (!rec.text) return

        const rawID = rec.conversationToken ? mapper.resolve(rec.conversationToken) : undefined
        if (!rawID) { log.warn("drop msg: no session binding", { token: rec.conversationToken }); return }
        let sessionID: typeof SessionID.Type
        try { sessionID = Schema.decodeUnknownSync(SessionID)(rawID) } catch (e) {
          log.warn("drop msg: invalid sessionID", { rawID, err: e }); return
        }

        // Ring 0: 打断当前 LLM → 创建独立用户消息 → 重启循环
        // Ring 1-3: 注入后缀，当前轮完成后自然消费
        if (rec.ring === TaskRing.ExternalMessage) {
          yield* promptSvc.interruptAndInject(sessionID, rec.text)
        } else {
          yield* injection.setSuffixOnce(sessionID, [{ type: "text", text: rec.text, synthetic: true }])
        }
      }),
    ))

    return QueueService.of({
      push: (ring, msg) => q.push(ring, msg),
      len: () => q.len(),
      ringLen: (r) => q.ringLen(r),
      bindSession: (token, id) => { mapper.bind(token, id) },
    })
  }),
).pipe(Layer.provide([SessionMapperLive, Injection.defaultLayer, SessionPrompt.defaultLayer]))

// ── HTTP API Handlers ────────────────────────────────

export const queueHandlers = HttpApiBuilder.group(InstanceHttpApi, "queue", (handlers) =>
  Effect.gen(function* () {
    const q = yield* QueueService

    const push = Effect.fn("QueueHttpApi.push")(function* (ctx: {
      payload: typeof QueuePushPayload.Type
    }) {
      // ring 由 Schema.filter 验证范围（groups/queue.ts），此处无需重复校验
      const ring = ctx.payload.ring !== undefined ? ctx.payload.ring as TaskRing : TaskRing.ExternalMessage

      // 如果提供了 sessionID，bind 到 conversationToken
      if (ctx.payload.sessionID && ctx.payload.conversationToken) {
        q.bindSession(ctx.payload.conversationToken, ctx.payload.sessionID)
      }

      const id = q.push(ring, {
        channelId: ctx.payload.channelId,
        channelType: ctx.payload.channelType,
        accountId: ctx.payload.accountId,
        userId: ctx.payload.userId,
        conversationToken: ctx.payload.conversationToken,
        nickname: ctx.payload.nickname,
        dedupeKey: ctx.payload.dedupeKey,
        text: ctx.payload.text,
        timestamp: ctx.payload.timestamp ?? Date.now(),
        direction: "inbound",
        taskType: ctx.payload.taskType,
        taskPayload: ctx.payload.taskPayload,
      })
      return { ok: true as const, messageID: id }
    })

    const status = Effect.fn("QueueHttpApi.status")(function* () {
      return {
        total: q.len(),
        rings: [
          q.ringLen(TaskRing.ExternalMessage),
          q.ringLen(TaskRing.Heartbeat),
          q.ringLen(TaskRing.Background),
          q.ringLen(TaskRing.Maintenance),
        ],
      }
    })

    return handlers.handle("push", push).handle("status", status)
  }),
)
