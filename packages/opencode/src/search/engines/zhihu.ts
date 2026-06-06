/**
 * 知乎直连搜索引擎适配器
 *
 * 直接搜索知乎平台上的问题和内容。
 * URL: https://www.zhihu.com/search?q=QUERY
 *
 * 相比 site-scoped 的 DuckDuckGo 间接搜索，直连方式能获取更丰富的信息
 *（标题、摘要、回答数、赞同数等）。
 *
 * 零风险：公开 HTML 页面解析
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const BASE_URL = "https://www.zhihu.com"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export function makeZhihu(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchZhihu(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchZhihu(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      q: query,
      type: "content",
    })

    const response = yield* http.execute(
      HttpClientRequest.get(`${BASE_URL}/search?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: `${BASE_URL}/`,
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    if (!html) return []

    return parseZhihuResults(html, numResults)
  })
}

export function parseZhihuResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  let pos = 0

  // 尝试多种匹配模式

  // 模式 1：搜索结果的通用结构
  const pattern1 = /<a[^>]*class="[^"]*[Ee]ntry[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*class="[^"]*[Rr]ich[Cc]ontent[^"]*"[^>]*>([\s\S]*?)<\/p>/gi

  let match: RegExpExecArray | null
  while ((match = pattern1.exec(html)) !== null) {
    if (results.length >= maxResults) break

    let href = match[1].trim()
    const title = match[2].replace(/<[^>]+>/g, "").trim()
    const snippet = match[3]?.replace(/<[^>]+>/g, "").trim() || ""

    if (!title || !href) continue

    // 处理相对 URL
    if (href.startsWith("/")) href = `${BASE_URL}${href}`
    else if (!href.startsWith("http")) href = `${BASE_URL}/${href}`

    pos++
    results.push(
      makeSearchResult({
        title,
        url: href,
        snippet: snippet || "知乎内容",
        engine: "zhihu",
        position: pos,
        category: "social",
      }),
    )
  }

  // 模式 2：搜索结果卡片（知乎新版页面）
  const pattern2 = /<div[^>]*class="[^"]*[Ss]earch[_-][Rr]esult[_-][Ii]tem[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*[Rr]ich[Ww]ord[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi

  if (results.length === 0) {
    while ((match = pattern2.exec(html)) !== null) {
      if (results.length >= maxResults) break

      let href = match[1].trim()
      const title = match[2].replace(/<[^>]+>/g, "").trim()

      if (!title || !href) continue
      if (href.startsWith("/")) href = `${BASE_URL}${href}`
      else if (!href.startsWith("http")) href = `${BASE_URL}/${href}`

      pos++
      results.push(
        makeSearchResult({
          title,
          url: href,
          snippet: "知乎回答",
          engine: "zhihu",
          position: pos,
          category: "social",
        }),
      )
    }
  }

  // 模式 3：兜底——任何带知乎链接和标题的 a 标签
  const pattern3 = /<a[^>]*href="(\/question\/[^"]*|\/answer\/[^"]*|\/people\/[^"]*|\/p\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

  if (results.length === 0) {
    while ((match = pattern3.exec(html)) !== null) {
      if (results.length >= maxResults) break

      let href = match[1].trim()
      const title = match[2].replace(/<[^>]+>/g, "").trim()

      if (!title) continue
      href = `${BASE_URL}${href}`

      pos++
      results.push(
        makeSearchResult({
          title,
          url: href,
          snippet: "知乎内容",
          engine: "zhihu",
          position: pos,
          category: "social",
        }),
      )
    }
  }

  return results
}

export * as ZhihuEngine from "./zhihu"
