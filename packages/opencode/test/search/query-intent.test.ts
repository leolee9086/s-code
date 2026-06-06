/**
 * 查询意图检测测试
 */
import { describe, expect, test } from "bun:test"
import { detectQueryIntent } from "../../src/search/query-intent"

describe("detectQueryIntent", () => {
  test("detects code queries by language name", () => {
    expect(detectQueryIntent("how to sort in Rust").queryType).toBe("code")
    expect(detectQueryIntent("Python async await example").queryType).toBe("code")
    expect(detectQueryIntent("TypeScript interface vs type").queryType).toBe("code")
  })

  test("detects code queries by keywords", () => {
    expect(detectQueryIntent("npm install express").queryType).toBe("code")
    expect(detectQueryIntent("docker compose tutorial").queryType).toBe("code")
    expect(detectQueryIntent("what is graphql").queryType).toBe("code")
  })

  test("detects currency conversion", () => {
    const r = detectQueryIntent("100 USD to CNY")
    expect(r.isCurrency).toBe(true)
    expect(r.queryType).toBe("general")
  })

  test("detects weather queries", () => {
    const r = detectQueryIntent("weather in Tokyo")
    expect(r.isWeather).toBe(true)
    expect(r.queryType).toBe("general")
  })

  test("detects translation", () => {
    const r = detectQueryIntent("translate hello to french")
    expect(r.isTranslation).toBe(true)
  })

  test("detects academic queries", () => {
    expect(detectQueryIntent("machine learning paper 2024").queryType).toBe("academic")
    expect(detectQueryIntent("doi 10.1007/s10948").queryType).toBe("academic")
  })

  test("detects news queries", () => {
    expect(detectQueryIntent("breaking news today").queryType).toBe("news")
    expect(detectQueryIntent("latest technology update").queryType).toBe("news")
  })

  test("detects video queries", () => {
    expect(detectQueryIntent("new movie trailer").queryType).toBe("video")
  })

  test("defaults to general for plain queries", () => {
    expect(detectQueryIntent("best restaurants in Tokyo").queryType).toBe("general")
    expect(detectQueryIntent("history of coffee").queryType).toBe("general")
  })

  test("handles empty query", () => {
    expect(detectQueryIntent("").queryType).toBeUndefined()
  })

  test("URL queries go to general", () => {
    expect(detectQueryIntent("https://example.com/page").queryType).toBe("general")
  })
})
