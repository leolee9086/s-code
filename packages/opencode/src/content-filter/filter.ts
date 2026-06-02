import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "@/session/schema"
import { PhraseBan } from "./phrase-ban"

export { PhraseBan } from "./phrase-ban"

export * as ContentFilter from "./filter"

const log = Log.create({ service: "content-filter" })

export class BlockedError extends Schema.TaggedErrorClass<BlockedError>()("ContentFilterBlockedError", {
  pattern: Schema.String,
  action: Schema.Literals(["retry", "block"]),
  message: Schema.String,
}) {
  override get message(): string {
    return `ContentFilter.${this.action}: ${this.message} (pattern: ${this.pattern})`
  }
}

export const Pattern = Schema.Struct({
  regex: Schema.String,
  action: Schema.Literals(["retry", "warn", "block"]),
  message: Schema.optional(Schema.String),
})
export type Pattern = typeof Pattern.Type

export const Config = Schema.Struct({
  patterns: Schema.optional(Schema.mutable(Schema.Array(Pattern))),
})
export type Config = typeof Config.Type

const renderReason = (pattern: Pattern, text: string): string => {
  const preview = text.length > 80 ? text.slice(0, 80) + "..." : text
  return pattern.message ?? `匹配模式: /${pattern.regex}/ 于 "${preview}"`
}

export const check = (text: string, config: Config, sessionID: SessionID): Effect.Effect<void, BlockedError> =>
  Effect.gen(function* () {
    if (config.patterns) {
      for (const pattern of config.patterns) {
        if (!tryMatch(pattern.regex, text)) continue

        const reason = renderReason(pattern, text)

        if (pattern.action === "warn") {
          log.warn(reason)
          continue
        }

        return yield* new BlockedError({
          pattern: pattern.regex,
          action: pattern.action === "block" ? "block" : "retry",
          message: reason,
        })
      }
    }

    const banned = yield* PhraseBan.check(sessionID, text)
    if (banned) {
      return yield* new BlockedError({
        pattern: banned,
        action: "retry",
        message: `禁止词匹配: "${banned}"`,
      })
    }
  })

const tryMatch = (regex: string, text: string): boolean => {
  try {
    const re = new RegExp(regex, "i")
    return re.test(text)
  } catch (err: unknown) {
    log.warn("invalid regex in content filter", { regex, error: String(err) })
    return false
  }
}
