/**
 * Vimeo 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeVimeo, parseVimeoResults } from "../../src/search/engines/vimeo"
import { makeEngineConfig } from "../../src/search/engine"

describe("Vimeo engine", () => {
  test("creates engine", () => {
    const e = makeVimeo(makeEngineConfig({ name: "vimeo", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("vimeo")
  })
  test("parseVimeoResults extracts items", () => {
    const html = `<a href="/123456" class="iris_link"><div class="title">Test Video</div></a>`
    const r = parseVimeoResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].url).toBe("https://vimeo.com/123456")
    expect(r[0].category).toBe("video")
  })
  test("returns empty for empty HTML", () => expect(parseVimeoResults("", 10)).toEqual([]))
})
