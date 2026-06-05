/**
 * Bing News 引擎单元测试
 */
import { describe, expect, test } from "bun:test"
import { makeBingNews, parseBingNewsResults } from "../../src/search/engines/bing-news"
import { makeEngineConfig } from "../../src/search/engine"

const SAMPLE_HTML = `<html>
<div class="newsitem">
  <a class="title" href="https://example.com/news1">AI Breakthrough in 2026</a>
  <div class="snippet">Scientists announce major breakthrough in artificial intelligence research.</div>
  <div class="source"><span aria-label="TechCrunch">2 hours ago</span></div>
</div>
<div class="newsitem">
  <a class="title" href="https://example.com/news2">Stock Market Reaches New High</a>
  <div class="snippet">Global markets surge as economic indicators improve.</div>
  <div class="source"><span aria-label="Reuters">5 hours ago</span></div>
</div>
</html>`

describe("Bing News engine", () => {
  test("engine config creates correctly", () => {
    const engine = makeBingNews(makeEngineConfig({ name: "bing-news", timeout: 5000, maxResults: 5 }))
    expect(engine.name).toBe("bing-news")
    expect(engine.config.maxResults).toBe(5)
    expect(engine.config.requiresKey).toBe(false)
  })

  test("parseBingNewsResults extracts news items", () => {
    const results = parseBingNewsResults(SAMPLE_HTML, 10)
    expect(results.length).toBe(2)
    expect(results[0].title).toBe("AI Breakthrough in 2026")
    expect(results[0].url).toBe("https://example.com/news1")
    expect(results[0].snippet).toContain("TechCrunch")
    expect(results[0].snippet).toContain("major breakthrough")
    expect(results[0].category).toBe("news")
    expect(results[1].title).toBe("Stock Market Reaches New High")
  })

  test("parseBingNewsResults respects maxResults", () => {
    expect(parseBingNewsResults(SAMPLE_HTML, 1).length).toBe(1)
  })

  test("parseBingNewsResults returns empty for empty HTML", () => {
    expect(parseBingNewsResults("", 10)).toEqual([])
  })

  test("parseBingNewsResults deduplicates by URL", () => {
    const html = `<div class="newsitem"><a class="title" href="https://ex.com/a">Dup</a><div class="snippet">S</div></div>
                  <div class="newsitem"><a class="title" href="https://ex.com/a">Dup Again</a><div class="snippet">S</div></div>`
    expect(parseBingNewsResults(html, 10).length).toBe(1)
  })
})
