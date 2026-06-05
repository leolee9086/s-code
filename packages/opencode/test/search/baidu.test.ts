/**
 * 百度引擎测试：验证 JSON 响应解析
 */
import { describe, expect, test } from "bun:test"
import { makeBaidu, parseBaiduResults } from "../../src/search/engines/baidu"
import { makeEngineConfig } from "../../src/search/engine"

const SAMPLE_JSON = JSON.stringify({
  feed: {
    entry: [
      { title: "Rust编程入门 &amp; 教程", url: "https://example.com/rust", abs: "学习Rust编程语言的最佳方式", time: 1735689600 },
      { title: "AI人工智能发展", url: "https://example.com/ai", abs: "人工智能技术的最新进展", time: 1696000000 },
    ],
  },
})

describe("Baidu engine", () => {
  test("makeBaidu creates engine", () => {
    const e = makeBaidu(makeEngineConfig({ name: "baidu", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("baidu")
    expect(typeof e.search).toBe("function")
  })

  test("parseBaiduResults parses JSON correctly", () => {
    const r = parseBaiduResults(SAMPLE_JSON, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Rust编程入门 & 教程")
    expect(r[0].url).toBe("https://example.com/rust")
    expect(r[0].snippet).toContain("学习Rust编程语言")
    expect(r[0].publishedDate).toBe(1735689600000)
    expect(r[1].title).toBe("AI人工智能发展")
  })

  test("respects maxResults", () => {
    expect(parseBaiduResults(SAMPLE_JSON, 1).length).toBe(1)
  })

  test("returns empty for invalid JSON", () => {
    expect(parseBaiduResults("not json", 10)).toEqual([])
  })

  test("returns empty for missing entry field", () => {
    expect(parseBaiduResults('{"feed":{}}', 10)).toEqual([])
  })
})
