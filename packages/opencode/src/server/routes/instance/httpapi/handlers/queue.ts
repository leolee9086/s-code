// Queue API handlers + dispatcher
//
// 端到端链路:
//   POST /queue/message → RingQueue.push() → runDispatcher
//   → handler → LLM session 注入

import { Context, Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { QueuePushPayload } from "../groups/queue"
import { makeRingQueue, runDispatcher, TaskRing } from "@/channel/queue"
import type { RingQueueInterface, MessageRecord } from "@/channel/queue"
import { Injection } from "@/session/injection"
import { SessionMapper } from "@/channel/session-mapper"

// ── Queue Service ────────────────────────────────────

export interface QueueServiceInterface {
  readonly push: RingQueueInterface["push"]
  readonly len: RingQueueInterface["len"]
  readonly ringLen: RingQueueInterface["ringLen"]
}

export class QueueService extends Context.Service<QueueService, QueueServiceInterface>()("@opencode/QueueService") {}

export const QueueServiceLive = Layer.effect(
  QueueService,
  Effect.gen(function* () {
    const q = makeRingQueue()
    const injection = yield* Injection.Service
    const sessionMapper = yield* SessionMapper

    // dispatcher: pop → 路由到目标 session
    runDispatcher(q, (rec: MessageRecord) => {
      if (!rec.text) return

      // 通过 conversationToken 找到目标 session
      const sessionID = rec.conversationToken ? sessionMapper.resolve(rec.conversationToken) : undefined
      if (!sessionID) return  // 无对应 session，静默丢弃

      // Ring 0: 高优先级，注入前缀（下一轮立即消费）
      // Ring 1-3: 普通优先级，注入后缀（当前轮完成后消费）
      const parts = [{ type: "text" as const, text: rec.text, synthetic: true as const }]
      if (rec.ring === TaskRing.ExternalMessage) {
        // Ring 0: setPrefix 让消息在下一轮 LLM 调用前被消费
        Effect.runPromise(injection.setPrefix(sessionID, parts)).catch(() => {})
      } else {
        // Ring 1-3: setSuffixOnce 让消息在当前轮完成后被消费
        Effect.runPromise(injection.setSuffixOnce(sessionID, parts)).catch(() => {})
      }
    })

    return QueueService.of({
      push: (ring, msg) => q.push(ring, msg),
      len: () => q.len(),
      ringLen: (r) => q.ringLen(r),
    })
  }),
)

// ── HTTP API Handlers ────────────────────────────────

export const queueHandlers = HttpApiBuilder.group(InstanceHttpApi, "queue", (handlers) =>
  Effect.gen(function* () {
    const q = yield* QueueService

    const push = Effect.fn("QueueHttpApi.push")(function* (ctx: {
      payload: typeof QueuePushPayload.Type
    }) {
      const ring = ctx.payload.ring !== undefined ? ctx.payload.ring as TaskRing : TaskRing.ExternalMessage
      const id = q.push(ring, {
        channelId: ctx.payload.channelId,
        channelType: ctx.payload.channelType,
        accountId: ctx.payload.accountId,
        userId: ctx.payload.userId,
        nickname: ctx.payload.nickname,
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
