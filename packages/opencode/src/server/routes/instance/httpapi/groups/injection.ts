// External Injection API — HTTP 端点用于编程式注入消息到 agent 循环
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { SessionID } from "@/session/schema"
import { ApiNotFoundError } from "../errors"

const root = "/injection"

export const InjectionPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "InjectionPart" })

export const InjectionPrefixPayload = Schema.Struct({
  parts: Schema.Array(InjectionPartSchema),
}).annotate({ identifier: "InjectionPrefixPayload" })

export const InjectionSuffixPayload = Schema.Struct({
  parts: Schema.Array(InjectionPartSchema),
  once: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "InjectionSuffixPayload" })

export const InjectionApi = HttpApi.make("injection")
  .add(
    HttpApiGroup.make("injection")
      .add(
        HttpApiEndpoint.post("setPrefix", `${root}/prefix/:sessionID`, {
          params: Schema.Struct({ sessionID: SessionID }),
          payload: InjectionPrefixPayload,
          success: Schema.String,
          error: ApiNotFoundError,
        }),
      )
      .add(
        HttpApiEndpoint.post("setSuffix", `${root}/suffix/:sessionID`, {
          params: Schema.Struct({ sessionID: SessionID }),
          payload: InjectionSuffixPayload,
          success: Schema.String,
          error: ApiNotFoundError,
        }),
      )
      .add(
        HttpApiEndpoint.delete("clear", `${root}/:sessionID`, {
          params: Schema.Struct({ sessionID: SessionID }),
          success: Schema.String,
          error: ApiNotFoundError,
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
