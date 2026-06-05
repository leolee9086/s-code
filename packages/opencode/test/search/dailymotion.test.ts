/**
 * Dailymotion 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeDailymotion, parseDailymotionResults } from "../../src/search/engines/dailymotion"
import { makeEngineConfig } from "../../src/search/engine"

describe("Dailymotion engine", () => {
  test("makeDailymotion creates engine", () => {
    const e = makeDailymotion(makeEngineConfig({ name: "dailymotion", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("dailymotion")
    expect(typeof e.search).toBe("function")
  })

  test("parseDailymotionResults parses JSON", () => {
    const json = JSON.stringify({
      list: [
        { title: "Test Video", url: "https://dailymotion.com/v1", description: "A test", created_time: 1700000000, duration: 300 },
        { title: "Video 2", url: "https://dailymotion.com/v2", description: "Second video", duration: 630 },
      ],
    })
    const r = parseDailymotionResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].url).toContain("dailymotion.com")
    expect(r[0].category).toBe("video")
    expect(r[1].snippet).toContain("10:30")
  })

  test("returns empty for invalid JSON", () => expect(parseDailymotionResults("bad", 10)).toEqual([]))
  test("respects maxResults", () => {
    const json = JSON.stringify({ list: [{ title: "V1", url: "https://ex.com/1" }, { title: "V2", url: "https://ex.com/2" }] })
    expect(parseDailymotionResults(json, 1).length).toBe(1)
  })
})
