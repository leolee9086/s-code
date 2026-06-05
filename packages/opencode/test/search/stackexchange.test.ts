/**
 * StackExchange 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeStackExchange, parseStackExchangeResults } from "../../src/search/engines/stackexchange"
import { makeEngineConfig } from "../../src/search/engine"

describe("StackExchange engine", () => {
  test("creates engine", () => {
    const e = makeStackExchange(makeEngineConfig({ name: "stackexchange", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("stackexchange")
  })
  test("parseStackExchangeResults parses JSON", () => {
    const json = JSON.stringify({ items: [{ title: "Rust borrow checker", link: "https://stackoverflow.com/q/1", score: 42, answer_count: 3, view_count: 1500, tags: ["rust", "borrow-checker"] }] })
    const r = parseStackExchangeResults(json, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Rust borrow checker")
    expect(r[0].url).toContain("stackoverflow.com")
    expect(r[0].category).toBe("code")
    expect(r[0].snippet).toContain("⭐42")
  })
  test("returns empty for invalid JSON", () => expect(parseStackExchangeResults("bad", 10)).toEqual([]))
})
