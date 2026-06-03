import { describe, expect, test } from "bun:test"

type Message = { role: "user" | "assistant"; id: number; tokens: number }

function turns(messages: Message[]) {
  const result: Array<{ start: number; end: number; id: number }> = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue
    result.push({ start: i, end: messages.length, id: messages[i].id })
  }
  for (let i = 0; i < result.length - 1; i++) result[i].end = result[i + 1].start
  return result
}

function sum(messages: Message[], start: number, end: number) {
  return messages.slice(start, end).reduce((s, m) => s + m.tokens, 0)
}

interface SelectInput {
  messages: Message[]
  headTurns: number
  tailTurns: number
  headBudget: number
  tailBudget: number
}

interface SelectResult {
  headKeep: Message[]
  compact: Message[]
  tailKeep: Message[]
  description: string
}

function select(input: SelectInput): SelectResult {
  const all = turns(input.messages)
  if (!all.length) {
    return { headKeep: [], compact: input.messages, tailKeep: [], description: "no turns" }
  }

  let headEnd = 0
  if (input.headTurns > 0) {
    const earliest = all.slice(0, input.headTurns)
    for (const turn of earliest) {
      const size = sum(input.messages, turn.start, turn.end)
      if (size <= input.headBudget) {
        input.headBudget -= size
        headEnd = turn.end
      } else break
    }
  }

  let tailStart = input.messages.length
  if (input.tailTurns > 0) {
    const latest = all.slice(-input.tailTurns)
    let total = 0
    for (let i = latest.length - 1; i >= 0; i--) {
      const size = sum(input.messages, latest[i].start, latest[i].end)
      if (total + size <= input.tailBudget) {
        total += size
        tailStart = latest[i].start
      } else break
    }
  }

  if (headEnd >= tailStart) {
    return {
      headKeep: input.messages.slice(0, tailStart),
      compact: [],
      tailKeep: input.messages.slice(tailStart),
      description: `overlap: head covers tail, no compact area`,
    }
  }

  return {
    headKeep: input.messages.slice(0, headEnd),
    compact: input.messages.slice(headEnd, tailStart),
    tailKeep: input.messages.slice(tailStart),
    description: `head:[0-${headEnd}) compact:[${headEnd}-${tailStart}) tail:[${tailStart}-${input.messages.length})`,
  }
}

function makeSession(turns: number): Message[] {
  const msgs: Message[] = []
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "user", id: i * 2, tokens: 500 })
    msgs.push({ role: "assistant", id: i * 2 + 1, tokens: 1500 })
  }
  return msgs
}

describe("dual-anchor compaction (head_turns + tail_turns)", () => {
  test("default: head_turns=0 tail_turns=2 (current behavior)", () => {
    const msgs = makeSession(10)
    const r = select({ messages: msgs, headTurns: 0, tailTurns: 2, headBudget: 0, tailBudget: 10_000 })

    expect(r.headKeep).toEqual([])
    expect(r.compact.length).toBe(16)
    expect(r.compact[0].id).toBe(0)
    expect(r.compact.at(-1)!.id).toBe(15)
    expect(r.tailKeep.length).toBe(4)
    expect(r.tailKeep[0].id).toBe(16)
  })

  test("head-only: head_turns=2 tail_turns=0", () => {
    const msgs = makeSession(10)
    const r = select({ messages: msgs, headTurns: 2, tailTurns: 0, headBudget: 10_000, tailBudget: 0 })

    expect(r.headKeep.length).toBe(4)
    expect(r.headKeep[0].id).toBe(0)
    expect(r.tailKeep).toEqual([])
    expect(r.compact.length).toBe(16)
  })

  test("dual: head_turns=2 tail_turns=2 splits three zones", () => {
    const msgs = makeSession(10)
    const r = select({ messages: msgs, headTurns: 2, tailTurns: 2, headBudget: 10_000, tailBudget: 10_000 })

    expect(r.headKeep.length).toBe(4)
    expect(r.headKeep[0].id).toBe(0)
    expect(r.headKeep.at(-1)!.id).toBe(3)
    expect(r.compact.length).toBe(12)
    expect(r.compact[0].id).toBe(4)
    expect(r.compact.at(-1)!.id).toBe(15)
    expect(r.tailKeep.length).toBe(4)
    expect(r.tailKeep[0].id).toBe(16)
    expect(r.tailKeep.at(-1)!.id).toBe(19)
  })

  test("dual-anchor: cache stability across growth", () => {
    const results: Array<{ n: number; headIds: string; tailIds: string }> = []
    for (let n = 4; n <= 12; n++) {
      const msgs = makeSession(n)
      const r = select({ messages: msgs, headTurns: 2, tailTurns: 2, headBudget: 10_000, tailBudget: 10_000 })
      results.push({
        n,
        headIds: r.headKeep.map((m) => m.id).join(","),
        tailIds: r.tailKeep.map((m) => m.id).join(","),
      })
    }

    for (let i = 1; i < results.length; i++) {
      expect(results[i].headIds).toBe(results[0].headIds)
    }

    console.log(
      "\nDual-anchor cache stability:",
      results
        .map((r) => `\n  ${r.n} turns → head: [${r.headIds || "—"}] ... compact ... tail: [${r.tailIds}]`)
        .join(""),
    )
  })

  test("dual: overlap gracefully when head+turns cover entire session", () => {
    const msgs = makeSession(3)
    const r = select({ messages: msgs, headTurns: 2, tailTurns: 2, headBudget: 10_000, tailBudget: 10_000 })

    expect(r.compact).toEqual([])
    expect(r.headKeep.length).toBeGreaterThan(0)
    expect(r.tailKeep.length).toBeGreaterThan(0)
  })

  test("dual: first-turn-heavy scenario", () => {
    const msgs: Message[] = [
      { role: "user", id: 0, tokens: 3000 },
      { role: "assistant", id: 1, tokens: 2000 },
      { role: "user", id: 2, tokens: 500 },
      { role: "assistant", id: 3, tokens: 500 },
      { role: "user", id: 4, tokens: 500 },
      { role: "assistant", id: 5, tokens: 500 },
      { role: "user", id: 6, tokens: 500 },
      { role: "assistant", id: 7, tokens: 500 },
      { role: "user", id: 8, tokens: 500 },
      { role: "assistant", id: 9, tokens: 500 },
    ]

    const r = select({ messages: msgs, headTurns: 1, tailTurns: 1, headBudget: 10_000, tailBudget: 10_000 })

    expect(r.headKeep.length).toBe(2)
    expect(r.headKeep[0].id).toBe(0)
    expect(r.tailKeep.length).toBe(2)
    expect(r.tailKeep[0].id).toBe(8)
    expect(r.compact.length).toBe(6)

    console.log(
      `\nLarge first turn: head keeps spec [${r.headKeep.map((m) => `#${m.id}`).join(",")}] -- compact mid [${r.compact.map((m) => `#${m.id}`).join(",")}] -- tail keeps recent [${r.tailKeep.map((m) => `#${m.id}`).join(",")}]`,
    )
  })
})
