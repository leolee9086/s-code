import { PrefixCommand } from "."

let loaded = false

export function ensureBuiltins() {
  if (loaded) return
  loaded = true
  PrefixCommand.register(
    { prefixes: ["禁止:", "禁止：", "ban:", "禁语:"], builtin: "ban", description: "屏蔽短语" },
    { prefixes: ["允许:", "允许：", "unban:", "解禁:"], builtin: "unban", description: "解除屏蔽短语" },
    { prefixes: ["进化:", "evolve:"], builtin: "stop-evolve", description: "结束本轮进化" },
  )
}
