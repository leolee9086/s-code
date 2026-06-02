import { Schema } from "effect"

export * as Directive from "./directive"

export type Info =
  | { type: "ban"; phrase: string }
  | { type: "unban"; phrase: string }
  | { type: "none" }

const banPrefixes = ["禁止:", "禁止：", "ban:", "禁语:"]
const unbanPrefixes = ["允许:", "允许：", "unban:", "解禁:"]

export const parse = (input: string): { directive: Info; remaining: string } => {
  const normalized = input.trimStart()

  for (const prefix of banPrefixes) {
    if (normalized.startsWith(prefix)) {
      const phrase = normalized.slice(prefix.length)
      return { directive: { type: "ban", phrase }, remaining: "" }
    }
  }

  for (const prefix of unbanPrefixes) {
    if (normalized.startsWith(prefix)) {
      const phrase = normalized.slice(prefix.length)
      return { directive: { type: "unban", phrase }, remaining: "" }
    }
  }

  return { directive: { type: "none" }, remaining: input }
}

export const directives = Schema.Literals(["禁止", "允许", "ban", "unban"]).annotate({
  description: "可用的指令词",
})

export const hasDirective = (input: string): boolean => {
  const normalized = input.trimStart()
  return [...banPrefixes, ...unbanPrefixes].some((p) =>
    normalized.startsWith(p),
  )
}
