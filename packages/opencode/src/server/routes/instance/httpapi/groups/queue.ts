// Queue API — 外部消息队列 HTTP 端点
// 外部系统通过 POST /queue/message 投递消息，按 ring 优先级消费
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InvalidRequestError } from "../errors"
import { TaskRing } from "@/channel/queue"

const root = "/queue"

export const QueuePushPayload = Schema.Struct({
  channelId: Schema.String,
  channelType: Schema.String,
  accountId: Schema.String,
  userId: Schema.String,
  nickname: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.Number),
  ring: Schema.optional(Schema.Number),
  taskType: Schema.String,
  taskPayload: Schema.optional(Schema.Unknown),
}).annotate({ identifier: "QueuePushPayload" })

export const QueuePushResponse = Schema.Struct({
  ok: Schema.Literal(true),
  messageID: Schema.String,
}).annotate({ identifier: "QueuePushResponse" })

export const QueueStatusResponse = Schema.Struct({
  total: Schema.Number,
  rings: Schema.Array(Schema.Number),
}).annotate({ identifier: "QueueStatusResponse" })

export const QueueApi = HttpApi.make("queue")
  .add(
    HttpApiGroup.make("queue")
      .add(
        HttpApiEndpoint.post("push", `${root}/message`, {
          payload: QueuePushPayload,
          success: QueuePushResponse,
          error: InvalidRequestError,
        }),
      )
      .add(
        HttpApiEndpoint.get("status", `${root}/status`, {
          success: QueueStatusResponse,
          error: InvalidRequestError,
        }),
      )
      .middleware(Authorization),
  )
