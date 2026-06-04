export * as PrefixCommand from "."

export const Info = {
  prefixes: [] as string[],
  description: undefined as string | undefined,
  builtin: undefined as "ban" | "unban" | "stop-evolve" | undefined,
  command: undefined as string | undefined,
}

export type Info = {
  prefixes: string[]
  description?: string
  builtin?: "ban" | "unban" | "stop-evolve"
  command?: string
}

export type MatchResult = {
  info: Info
  prefix: string
  args: string
}

const entries: Info[] = []

export const register = (...newEntries: Info[]) => {
  entries.push(...newEntries)
}

export const match = (text: string): MatchResult | undefined => {
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
}

export const list = (): Info[] => {
  return [...entries]
}

export { ensureBuiltins } from "./builtins"
