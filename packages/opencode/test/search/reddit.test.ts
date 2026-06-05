/**
 * Reddit 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeReddit, parseRedditResults } from "../../src/search/engines/reddit"
import { makeEngineConfig } from "../../src/search/engine"

describe("Reddit engine", () => {
  test("creates engine", () => {
    const e = makeReddit(makeEngineConfig({ name: "reddit", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("reddit")
  })
  test("parseRedditResults extracts items", () => {
    const html = `<a id="t3_abc" class="search-result" href="/r/rust/comments/test"><faceplate-screen-reader-content>Rust is awesome</faceplate-screen-reader-content></a>`
    const r = parseRedditResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Rust is awesome")
    expect(r[0].url).toContain("reddit.com/r/rust")
    expect(r[0].category).toBe("social")
  })
  test("returns empty for empty HTML", () => expect(parseRedditResults("", 10)).toEqual([]))
})
