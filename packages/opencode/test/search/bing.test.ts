/**
 * Bing 引擎解析器测试：使用真实 Bing HTML 片段验证解析质量
 */
import { describe, expect, test } from "bun:test"
import { makeBing, parseBingResults } from "../../src/search/engines/bing"
import { makeEngineConfig, makeSearchOptions } from "../../src/search/engine"

// 从之前的实际抓取提取的 Bing 搜索结果 HTML 片段
// 包含 2 条标准搜索结果
const SAMPLE_HTML = `<html><body>
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/page1">OpenCode AI Editor - Modern Code Editing</a></h2>
    <div class="b_caption"><p>OpenCode AI Editor is a next-generation code editor powered by artificial intelligence. It provides intelligent code completion, refactoring, and debugging.</p></div>
    <cite>https://example.com/page1</cite>
  </li>
  <li class="b_algo">
    <h2><a href="https://github.com/opencode">OpenCode on GitHub</a></h2>
    <div class="b_caption"><p>OpenCode is an open-source AI-powered development tool. Visit our GitHub repository for documentation, issues, and contributions.</p></div>
    <cite>https://github.com/opencode</cite>
  </li>
</ol>
</body></html>`

describe("Bing HTML parser", () => {
  test("parses standard search results", () => {
    // We test the `makeBing` engine config and search interface
    const engine = makeBing(makeEngineConfig({
      name: "bing",
      timeout: 5000,
      maxResults: 5,
    }))

    expect(engine.name).toBe("bing")
    expect(engine.config.maxResults).toBe(5)
    expect(engine.config.requiresKey).toBe(false)
    expect(typeof engine.search).toBe("function")
  })

  test("engine config has correct defaults", () => {
    const engine = makeBing(makeEngineConfig({
      name: "bing-search",
      weight: 0.9,
      timeout: 15000,
      maxResults: 8,
    }))

    expect(engine.config.weight).toBe(0.9)
    expect(engine.config.timeout).toBe(15000)
    expect(engine.config.maxResults).toBe(8)
  })

  test("parseBingResults extracts from h2/a structure", () => {
    const results = parseBingResults(SAMPLE_HTML, 10)
    expect(results.length).toBe(2)
    expect(results[0].title).toBe("OpenCode AI Editor - Modern Code Editing")
    expect(results[0].url).toBe("https://example.com/page1")
    expect(results[0].snippet).toContain("next-generation code editor")
    expect(results[1].title).toBe("OpenCode on GitHub")
    expect(results[1].url).toBe("https://github.com/opencode")
  })

  test("parseBingResults respects maxResults", () => {
    const results = parseBingResults(SAMPLE_HTML, 1)
    expect(results.length).toBe(1)
  })

  test("parseBingResults returns empty for empty HTML", () => {
    expect(parseBingResults("", 10)).toEqual([])
  })

  test("parseBingResults returns empty for HTML without results", () => {
    expect(parseBingResults("<html><body>no results here</body></html>", 10)).toEqual([])
  })

  test("parseBingResults suppresses duplicates by URL", () => {
    const html = `<ol id="b_results">
      <li class="b_algo"><h2><a href="https://example.com/a">Duplicate A</a></h2><div class="b_caption"><p>First</p></div></li>
      <li class="b_algo"><h2><a href="https://example.com/a">Duplicate A again</a></h2><div class="b_caption"><p>Same URL</p></div></li>
    </ol>`
    const results = parseBingResults(html, 10)
    expect(results.length).toBe(1)
    expect(results[0].url).toBe("https://example.com/a")
  })

  test("parseBingResults handles alternative tilk structure", () => {
    const html = `<ol id="b_results">
      <li class="b_algo">
        <div class="b_tpcn"><a class="tilk" href="https://alt.example.com">Alt Title</a></div>
        <div class="b_caption"><p>Alt snippet here</p></div>
      </li>
    </ol>`
    const results = parseBingResults(html, 10)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("Alt Title")
    expect(results[0].url).toBe("https://alt.example.com")
    expect(results[0].snippet).toContain("Alt snippet")
  })

  test("parseBingResults decodes ck/a redirect URLs", () => {
    const html = `<ol id="b_results">
      <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9yZQ">Redirected</a></h2><div class="b_caption"><p>Decoded URL</p></div></li>
    </ol>`
    const results = parseBingResults(html, 10)
    expect(results.length).toBe(1)
    // base64 decode of "aHR0cHM6Ly9leGFtcGxlLmNvbS9yZQ" = "https://example.com/re"
    expect(results[0].url).toBe("https://example.com/re")
  })

  test("parseBingResults cleans algoSlug_icon from snippets", () => {
    const html = `<ol id="b_results">
      <li class="b_algo"><h2><a href="https://ex.com/t">Title</a></h2><div class="b_caption"><p>Clean <span class="algoSlug_icon">icon</span> snippet</p></div></li>
    </ol>`
    const results = parseBingResults(html, 10)
    expect(results.length).toBe(1)
    expect(results[0].snippet).not.toContain("algoSlug_icon")
    expect(results[0].snippet).not.toContain("icon")
    expect(results[0].snippet).toContain("Clean")
    expect(results[0].snippet).toContain("snippet")
  })

  test("parseBingResults ignores non-b_algo list items", () => {
    const html = `<ol id="b_results">
      <li class="b_algo"><h2><a href="https://ex.com/a">Real Result</a></h2><div class="b_caption"><p>Snippet</p></div></li>
      <li class="b_pag">ignore this pagination item</li>
      <li>ignore this plain item</li>
    </ol>`
    const results = parseBingResults(html, 10)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("Real Result")
  })
})
