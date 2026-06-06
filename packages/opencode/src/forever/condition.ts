// 条件引擎（Condition Engine）
import { existsSync, readdirSync, statSync } from "fs"
import { Context, Effect, Layer } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "forever.condition" })

// ---- 类型定义 ----

export type ConditionState = Record<string, unknown>

export type ConditionStrategy = "any" | "all" | "sequence"

export interface ConditionDriver {
  readonly name: string
  readonly init: (config: unknown, notify: () => void) => Effect.Effect<void>
  readonly shouldResume: (state: ConditionState) => Effect.Effect<boolean>
  readonly dispose: () => Effect.Effect<void>
}

// ---- File Watch Driver ----
// 通过轮询检查文件变化，不依赖 EventV2Bridge 以避免 Effect 类型泄漏

export class FileWatchDriver implements ConditionDriver {
  readonly name = "file_watch"
  private dirty = false
  private fileWatchPaths: string[] = []
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private _digest: string = ""

  init(config: unknown, notify: () => void): Effect.Effect<void> {
    const cfg = config as { enabled?: boolean; paths?: string[] } | undefined
    if (!cfg?.enabled) return Effect.void

    this.fileWatchPaths = cfg.paths ?? []

    // 通过定期检查文件变化（替代 EventV2Bridge 订阅）
    const self = this
    this.checkInterval = setInterval(() => {
      try {
        let currentDigest = ""
        for (const pattern of self.fileWatchPaths) {
          const dir = pattern
          if (existsSync(dir)) {
            const files = readdirSync(dir, { recursive: true })
            for (const f of files) {
              const fullPath = `${dir}/${f}`
              try {
                if (statSync(fullPath).isFile()) {
                  const stats = statSync(fullPath)
                  currentDigest += `${fullPath}:${stats.mtimeMs}:${stats.size};`
                }
              } catch {
                // skip files that disappear between readdir and stat
              }
            }
          }
        }
        if (self._digest && self._digest !== currentDigest) {
          self.dirty = true
          notify()
          log.info("file watch: change detected")
        }
        self._digest = currentDigest
      } catch {
        // silent
      }
    }, 2000) // 2秒轮询

    return Effect.void
  }

  shouldResume(_state: ConditionState): Effect.Effect<boolean> {
    return Effect.sync(() => {
      if (this.dirty) {
        this.dirty = false
        log.info("file watch: resuming")
        return true
      }
      return false
    })
  }

  dispose(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.checkInterval) {
        clearInterval(this.checkInterval)
        this.checkInterval = null
      }
      this.dirty = false
      this.fileWatchPaths = []
    })
  }
}

// ---- Timer Driver ----

export class TimerDriver implements ConditionDriver {
  readonly name = "timer"
  private ready = false
  private intervalId: ReturnType<typeof setInterval> | null = null

  init(config: unknown, notify: () => void): Effect.Effect<void> {
    return Effect.sync(() => {
      const cfg = config as { enabled?: boolean; interval_ms?: number } | undefined
      if (!cfg?.enabled) return

      const ms = cfg.interval_ms ?? 30000
      log.info("timer driver starting", { interval_ms: ms })

      this.intervalId = setInterval(() => {
        log.info("timer condition met")
        this.ready = true
        notify()
      }, ms)
    })
  }

  shouldResume(_state: ConditionState): Effect.Effect<boolean> {
    return Effect.sync(() => {
      if (this.ready) {
        this.ready = false
        log.info("timer: resuming")
        return true
      }
      return false
    })
  }

  dispose(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.intervalId) {
        clearInterval(this.intervalId)
        this.intervalId = null
      }
      this.ready = false
    })
  }
}

// ---- Condition Engine ----

export interface ConditionEngineInterface {
  readonly init: (
    config: {
      file_watch?: { enabled?: boolean; paths?: string[]; debounce_ms?: number; ignore?: string[] }
      timer?: { enabled?: boolean; interval_ms?: number }
      strategy?: ConditionStrategy
    },
    notify?: () => void,
  ) => Effect.Effect<void>
  readonly shouldResume: (state: ConditionState) => Effect.Effect<boolean>
  readonly dispose: () => Effect.Effect<void>
  readonly getState: () => Effect.Effect<ConditionState>
}

export class ConditionEngineService extends Context.Service<ConditionEngineService, ConditionEngineInterface>()(
  "@opencode/ForeverCondition",
) {}

export const conditionEngineLayer = Layer.effect(
  ConditionEngineService,
  Effect.gen(function* () {
    const drivers: ConditionDriver[] = [new FileWatchDriver(), new TimerDriver()]
    let strategy: ConditionStrategy = "any"

    const init: ConditionEngineInterface["init"] = (config, notify) =>
      Effect.gen(function* () {
        strategy = config.strategy ?? "any"
        const cb = notify ?? (() => {})

        for (const driver of drivers) {
          const driverConfig = config[driver.name as keyof typeof config]
          if (driverConfig && (driverConfig as { enabled?: boolean }).enabled !== false) {
            yield* driver.init(driverConfig, cb)
          }
        }
      })

    const shouldResume: ConditionEngineInterface["shouldResume"] = (state) =>
      Effect.gen(function* () {
        if (drivers.length === 0) return false

        const results = yield* Effect.forEach(
          drivers,
          (driver) => driver.shouldResume(state).pipe(Effect.catch(() => Effect.succeed(false))),
          { concurrency: "unbounded" },
        )

        switch (strategy) {
          case "all": return results.every(Boolean)
          case "sequence": return results.findIndex(Boolean) === 0
          case "any":
          default: return results.some(Boolean)
        }
      })

    const dispose: ConditionEngineInterface["dispose"] = () =>
      Effect.forEach(drivers, (d) => d.dispose().pipe(Effect.catch(() => Effect.void)), { discard: true })

    const getState: ConditionEngineInterface["getState"] = () => Effect.succeed({} as ConditionState)

    return ConditionEngineService.of({ init, shouldResume, dispose, getState })
  }),
)

export * as ForeverCondition from "./condition"
