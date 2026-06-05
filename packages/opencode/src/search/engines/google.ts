/**
 * Google 搜索引擎适配器
 *
 * 参考 SearXNG 的 google.py (18.8KB)
 * 通过 HTTP 抓取 Google 搜索结果 HTML，无需 API key。
 *
 * 关键策略（来自 SearXNG）：
 * - 设置 CONSENT cookie 绕过 GDPR 弹窗
 * - 使用 Google Search App User-Agent
 * - 三段式 CAPTCHA 检测：sorry 域名 / 302 重定向 / 短响应含 /sorry/
 * - XPath 解析搜索结果 (通过正则替代)
 *
 * 注意：Google 反爬严格，引擎会优雅降级（返回空结果），不会重试触发封禁。
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const SEARCH_URL = "https://www.google.com/search"
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36 (gws)"

export function makeGoogle(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) => searchGoogle(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchGoogle(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      q: query,
      hl: "en",
      num: String(Math.min(numResults, 20)),
      start: "0",
      filter: "0",
      safe: "off",
    })

    const response = yield* http.execute(
      HttpClientRequest.get(`${SEARCH_URL}?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Cookie: "CONSENT=YES+",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    if (!html) return []

    // Google CAPTCHA 检测：短响应（<2000字节）含 /sorry/ 或重定向到 sorry
    if (html.length < 2000 && (html.includes("/sorry/") || html.includes("sorry.google"))) return []

    return parseGoogleResults(html, numResults)
  })
}

/**
 * 解析 Google 搜索结果 HTML
 *
 * 参考 SearXNG 的 XPath: //a[@data-ved and not(@class)]
 * 提取: h3 标题, a/@href, div.VwiC3b 摘要
 */
export function parseGoogleResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  let pos = 0

  // 匹配搜索结果块：<a data-ved="..." href="..."> <h3>...</h3> </a>
  const blockRegex = /<a[^>]*data-ved[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break
    const block = match[0]

    let url = decodeURIComponent(match[1])
    const title = match[2].replace(/<[^>]*>/g, "").trim()
    if (!title || !url) continue

    // 清理 Google 追踪参数
    if (url.includes("&sa=U")) url = url.split("&sa=U")[0]

    // 摘要
    let snippet = ""
    const snippetMatch = block.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (snippetMatch) snippet = snippetMatch[1].replace(/<[^>]*>/g, "").trim()

    // 日期（Google 有时会显示）
    let publishedDate: number | undefined
    const dateMatch = block.match(/(\d{4}-\d{2}-\d{2})/)
    if (dateMatch) publishedDate = new Date(dateMatch[1]).getTime()

    pos++
    results.push(
      makeSearchResult({
        title,
        url,
        snippet: snippet.slice(0, 300),
        engine: "google",
        position: pos,
        publishedDate,
      }),
    )
  }

  return results
}

export * as Google from "./google"
