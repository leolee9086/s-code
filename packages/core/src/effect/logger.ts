import { Cause, Effect, Logger, References } from "effect"
import * as Log from "../util/log"

type Fields = Record<string, unknown>

const normalizeKey = (key: string) => (key === "sessionID" ? "session.id" : key)

export interface Handle {
  readonly debug: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
  readonly info: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
  readonly warn: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
  readonly error: (msg?: unknown, extra?: Fields) => Effect.Effect<void>
  readonly with: (extra: Fields) => Handle
  readonly time: (
    message: string,
    extra?: Fields,
  ) => {
    stop(): void
    [Symbol.dispose](): void
  }
}

const clean = (input?: Fields): Fields =>
  Object.fromEntries(
    Object.entries(input ?? {})
      .filter((entry) => entry[1] !== undefined && entry[1] !== null)
      .map(([key, value]) => [normalizeKey(key), value]),
  )

const text = (input: unknown): string => {
  // oxlint-disable-next-line no-base-to-string
  if (Array.isArray(input)) return input.map((item) => String(item)).join(" ")
  // oxlint-disable-next-line no-base-to-string
  return input === undefined ? "" : String(input)
}

const call = (run: (msg?: unknown) => Effect.Effect<void>, base: Fields, msg?: unknown, extra?: Fields) => {
  const ann = clean({ ...base, ...extra })
  const fx = run(msg)
  return Object.keys(ann).length ? Effect.annotateLogs(fx, ann) : fx
}

export const logger = Logger.make((opts) => {
  const extra = clean(opts.fiber.getRef(References.CurrentLogAnnotations))
  const now = opts.date.getTime()
  for (const [key, start] of opts.fiber.getRef(References.CurrentLogSpans)) {
    extra[`logSpan.${key}`] = `${now - start}ms`
  }
  if (opts.cause.reasons.length > 0) {
    extra.cause = Cause.pretty(opts.cause)
  }

  const svc = typeof extra.service === "string" ? extra.service : undefined
  if (svc) delete extra.service
  const log = svc ? Log.create({ service: svc }) : Log.Default
  const msg = text(opts.message)

  switch (opts.logLevel) {
    case "Trace":
    case "Debug":
      return log.debug(msg, extra)
    case "Warn":
      return log.warn(msg, extra)
    case "Error":
    case "Fatal":
      return log.error(msg, extra)
    default:
      return log.info(msg, extra)
  }
})

/** stderr sink: Error/Fatal logs always go to stderr with fiber annotations */
export const stderrSink = Logger.make((opts) => {
  if (opts.logLevel === "Error" || opts.logLevel === "Fatal") {
    const ann = opts.fiber.getRef(References.CurrentLogAnnotations)
    const svc = typeof ann.service === "string" ? ann.service : undefined
    const tag = svc ? `[${svc}] ` : ""
    const extra: string[] = []
    if (ann.sessionID) extra.push(`session=${ann.sessionID}`)
    if (ann.requestID) extra.push(`req=${ann.requestID}`)
    const suffix = extra.length > 0 ? " {" + extra.join(", ") + "}" : ""
    const parts = [`[${opts.logLevel}]`, tag, opts.message, suffix].filter(Boolean)
    process.stderr.write(parts.join(" ") + "\n")
  }
})

/** Development logger: file logging only (stderr is not suitable for TUI apps) */
export const developmentLayer = Logger.layer([logger], { mergeWithExisting: false })

/** Production logger: file logging only (OTLP merged externally) */
export const productionLayer = Logger.layer([logger], { mergeWithExisting: false })

/** Default layer always includes stderr sink regardless of OTEL config */
export const layer = developmentLayer

export const create = (base: Fields = {}): Handle => {
  const result: Handle = {
    debug: (msg, extra) => call((item) => Effect.logDebug(item), base, msg, extra),
    info: (msg, extra) => call((item) => Effect.logInfo(item), base, msg, extra),
    warn: (msg, extra) => call((item) => Effect.logWarning(item), base, msg, extra),
    error: (msg, extra) => call((item) => Effect.logError(item), base, msg, extra),
    with: (extra) => create({ ...base, ...extra }),
    time(message: string, extra?: Fields) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, { status: "completed", duration: Date.now() - now, ...extra })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }
  return result
}
