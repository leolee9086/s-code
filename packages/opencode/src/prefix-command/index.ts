import { Effect, Context, Layer, Ref, Schema } from "effect"

export * as PrefixCommand from "."

export const InfoSchema = Schema.Struct({
  prefixes: Schema.Array(Schema.String),
  description: Schema.optional(Schema.String),
  builtin: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  styleId: Schema.optional(Schema.String),
})

export type BuiltinKind = "ban" | "unban" | "enter-evolve" | "exit-evolve"

export type Info = {
  prefixes: string[]
  description?: string
  builtin?: BuiltinKind
  command?: string
  styleId?: string
}

export type MatchResult = {
  info: Info
  prefix: string
  args: string
}

export interface Interface {
  readonly match: (text: string) => Effect.Effect<MatchResult | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PrefixCommand") {}

const builtins: Info[] = [
  { prefixes: ["禁止:", "禁止：", "ban:", "禁语:"], builtin: "ban", description: "屏蔽短语", styleId: "extmark.directive" },
  { prefixes: ["允许:", "允许：", "unban:", "解禁:"], builtin: "unban", description: "解除屏蔽短语", styleId: "extmark.directive" },
  { prefixes: ["进化:", "evolve:"], builtin: "enter-evolve", description: "进入进化模式", styleId: "extmark.directive" },
  { prefixes: ["停止进化:", "停止进化：", "exit-evolve:", "stop-evolve:"], builtin: "exit-evolve", description: "退出进化模式", styleId: "extmark.directive" },
]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<Info[]>([...builtins])

    const match = Effect.fn("PrefixCommand.match")(function* (text: string) {
      const entries = yield* Ref.get(state)
      const normalized = text.trimStart()
      let best: MatchResult | undefined
      for (const entry of entries) {
        for (const prefix of entry.prefixes) {
          if (normalized.startsWith(prefix)) {
            const args = normalized.slice(prefix.length)
            if (!best || prefix.length > best.prefix.length) {
              best = { info: entry, prefix, args }
            }
          }
        }
      }
      return best
    })

    const list = Effect.fn("PrefixCommand.list")(function* () {
      return yield* Ref.get(state)
    })

    return Service.of({ match, list })
  }),
)

export const defaultLayer = layer
