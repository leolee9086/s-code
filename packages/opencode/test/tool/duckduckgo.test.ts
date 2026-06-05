import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import {
  parseHtmlResults,
  fallbackExtract,
  extractRedirectUrl,
  stripHtml,
  parseLiteResults,
  search,
} from "../../src/tool/duckduckgo"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer))

describe("DuckDuckGo URL extraction", () => {
  test("extracts real URL from uddg redirect", () => {
    // DuckDuckGo 使用 //duckduckgo.com/l/?uddg=<url> 格式的重定向
    const result = extractRedirectUrl(
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc123",
    )
    expect(result).toBe("https://example.com/page")
  })

  test("passes through direct http URL", () => {
    const result = extractRedirectUrl("https://example.com")
    expect(result).toBe("https://example.com")
  })

  test("handles protocol-relative URL", () => {
    const result = extractRedirectUrl("//example.com")
    expect(result).toBe("https://example.com")
  })

  test("returns empty string for empty href", () => {
    const result = extractRedirectUrl("")
    expect(result).toBe("")
  })
})

describe("DuckDuckGo HTML parsing - main parser", () => {
  const sampleHtml = `
<html>
<body>
  <div class="results">
    <div class="result results_links_deep">
      <div class="result__body">
        <h2 class="result__title">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">
            <b>Example</b> Page One
          </a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">
          This is the first <b>result</b> snippet
        </a>
      </div>
    </div>
    <div class="result results_links_deep">
      <div class="result__body">
        <h2 class="result__title">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">
            Second Result Title
          </a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">
          Second result description text
        </a>
      </div>
    </div>
    <div class="result results_links_deep">
      <div class="result__body">
        <h2 class="result__title">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage3">
            Third Result
          </a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage3">
          Third snippet
        </a>
      </div>
    </div>
  </div>
</body>
</html>`

  test("parses multiple results from HTML", () => {
    const results = parseHtmlResults(sampleHtml, 10)

    expect(results.length).toBe(3)
    expect(results[0].title).toBe("Example Page One")
    expect(results[0].url).toBe("https://example.org/page1")
    expect(results[0].snippet).toBe("This is the first result snippet")

    expect(results[1].title).toBe("Second Result Title")
    expect(results[1].url).toBe("https://example.org/page2")
    expect(results[1].snippet).toBe("Second result description text")
  })

  test("respects maxResults limit", () => {
    const results = parseHtmlResults(sampleHtml, 2)
    expect(results.length).toBe(2)
  })
})

describe("DuckDuckGo fallback parser", () => {
  const sampleHtml = `
<html>
<body>
  <div class="results">
    <div class="nrn-result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">
        Fallback Page One
      </a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">
        Fallback snippet text
      </a>
    </div>
    <div class="nrn-result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">
        Fallback Page Two
      </a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">
        Second fallback snippet
      </a>
    </div>
  </div>
</body>
</html>`

  test("fallback parser extracts results via regex", () => {
    const results = fallbackExtract(sampleHtml, 5)

    expect(results.length).toBe(2)
    expect(results[0].title).toBe("Fallback Page One")
    expect(results[0].url).toBe("https://example.org/page1")
    expect(results[0].snippet).toBe("Fallback snippet text")
  })
})

describe("DuckDuckGo VQD extraction", () => {
  // 真实 DuckDuckGo 页面中的 vqd 模式：通常出现在 <script> 块中
  test("extracts vqd from script context (vqd=\"...\" pattern)", () => {
    // 模拟 DuckDuckGo 首页中的 JavaScript
    const html = `<html><head><script>
      var vqd = "abc123def456";
      DDG.page = DDG.page || {};
      DDG.page.extra = { vqd: { vqd: "abc123def456" } };
    </script></head><body>test</body></html>`

    const match = html.match(/vqd\s*=\s*"([^"]+)"/)
    expect(match?.[1]).toBe("abc123def456")
  })

  test("extracts vqd from URL param (vqd=...& pattern)", () => {
    const inline = `var vqd=some_token_value&more=stuff`
    const match = inline.match(/vqd=([^&\s"]+)/)
    expect(match?.[1]).toBe("some_token_value")
  })
})

describe("DuckDuckGo Lite parser", () => {
  test("parses table-based lite results", () => {
    const html = `<html>
<body>
  <table>
    <tr>
      <td><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">Page One</a></td>
      <td class="snippet">First result snippet text</td>
    </tr>
    <tr>
      <td><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">Page Two</a></td>
      <td class="snippet">Second result snippet</td>
    </tr>
  </table>
</body>
</html>`
    const results = parseLiteResults(html, 10)
    expect(results.length).toBe(2)
    expect(results[0].title).toBe("Page One")
    expect(results[0].url).toBe("https://example.org/page1")
    expect(results[0].snippet).toBe("First result snippet text")
    expect(results[1].title).toBe("Page Two")
    expect(results[1].url).toBe("https://example.org/page2")
    expect(results[1].snippet).toBe("Second result snippet")
  })

  test("parses div-based lite results", () => {
    const html = `<html>
<body>
  <div class="result">
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage1">Div Page One</a>
    <span class="snippet">Div snippet text</span>
  </div>
  <div class="result">
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage2">Div Page Two</a>
    <span class="snippet">Div snippet two</span>
  </div>
</body>
</html>`
    const results = parseLiteResults(html, 10)
    expect(results.length).toBe(2)
    expect(results[0].title).toBe("Div Page One")
    expect(results[0].url).toBe("https://example.org/page1")
    expect(results[0].snippet).toBe("Div snippet text")
  })

  test("deduplicates by URL", () => {
    const html = `<html>
<body>
  <div class="result">
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsame">Same URL</a>
    <span class="snippet">First snippet</span>
  </div>
  <div class="result">
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsame">Same URL</a>
    <span class="snippet">Second snippet</span>
  </div>
</body>
</html>`
    const results = parseLiteResults(html, 10)
    expect(results.length).toBe(1)
  })

  test("respects maxResults limit", () => {
    const html = `<html>
<body>
  <div class="result"><a href="https://example.org/1">One</a><span class="snippet">Snippet 1</span></div>
  <div class="result"><a href="https://example.org/2">Two</a><span class="snippet">Snippet 2</span></div>
  <div class="result"><a href="https://example.org/3">Three</a><span class="snippet">Snippet 3</span></div>
</body>
</html>`
    const results = parseLiteResults(html, 2)
    expect(results.length).toBe(2)
  })
})

describe("DuckDuckGo stripHtml utility", () => {
  test("removes HTML tags", () => {
    const input = "<b>Hello</b> <i>World</i>"
    const result = stripHtml(input)
    expect(result).toBe("Hello World")
  })

  test("replaces &quot; with double quote", () => {
    const input = 'He said &quot;hello&quot;'
    const result = stripHtml(input)
    expect(result).toBe('He said "hello"')
  })

  test("returns empty string for empty input", () => {
    const result = stripHtml("")
    expect(result).toBe("")
  })
})

// 集成测试需要外部网络访问 DuckDuckGo
// 如果运行环境能够访问外网，取消 skip 即可验证搜索功能
describe.skip("DuckDuckGo search integration", () => {
  it.live("fetches results from DuckDuckGo HTML endpoint", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const results = yield* search(http, "test query", 3)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].title).toBeTruthy()
      expect(results[0].url).toMatch(/^https?:\/\//)
    }),
  )

  it.live("returns at most requested number of results", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const results = yield* search(http, "nodejs javascript", 5)
      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(5)
    }),
  )
})
