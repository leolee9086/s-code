// External Injection API handlers
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Injection } from "@/session/injection"
import { InjectionPrefixPayload, InjectionSuffixPayload } from "../groups/injection"
import type { SessionID } from "@/session/schema"

export const injectionHandlers = HttpApiBuilder.group(InstanceHttpApi, "injection", (handlers) =>
  Effect.gen(function* () {
    const injection = yield* Injection.Service

    const setPrefix = (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InjectionPrefixPayload.Type
    }) =>
      injection.setPrefix(ctx.params.sessionID, [...ctx.payload.parts]).pipe(Effect.as("ok" as const))

    const setSuffix = (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InjectionSuffixPayload.Type
    }) =>
      (ctx.payload.once
        ? injection.setSuffixOnce(ctx.params.sessionID, [...ctx.payload.parts])
        : injection.setSuffix(ctx.params.sessionID, [...ctx.payload.parts])
      ).pipe(Effect.as("ok" as const))

    const clear = (ctx: { params: { sessionID: SessionID } }) =>
      injection.clear(ctx.params.sessionID).pipe(Effect.as("ok" as const))

    return handlers
      .handle("setPrefix", setPrefix)
      .handle("setSuffix", setSuffix)
      .handle("clear", clear)
  }),
)
