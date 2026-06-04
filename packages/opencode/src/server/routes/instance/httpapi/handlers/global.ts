import { Config } from "@/config/config"
import { Installation } from "@/installation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const configSvc = yield* Config.Service
    const install = yield* Installation.Service

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      const info = yield* install.info()
      return { healthy: true as const, version: info.version }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      const info = yield* install.info()
      return {
        directory: "",
        payload: {
          id: "",
          type: "server.instance.disposed" as const,
          properties: { version: info.version },
        },
      }
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      const info = yield* configSvc.get()
      return info
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx: {
      payload: typeof Config.Info.Type
    }) {
      yield* configSvc.update(ctx.payload as Config.Info)
      const info = yield* configSvc.get()
      return info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: {
      payload: void | typeof GlobalUpgradeInput.Type
    }) {
      const method = yield* install.method()
      const target = ctx.payload?.target ?? "latest"
      const result = yield* install.upgrade(method, target).pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed({ success: false as const, error: e.message }),
          onSuccess: () => install.info().pipe(Effect.map((info) => ({ success: true as const, version: info.version }))),
        }),
      )
      return result
    })

    return handlers
      .handle("health", health)
      .handle("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handle("upgrade", upgrade)
  }),
)
