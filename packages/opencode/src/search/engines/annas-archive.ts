/**
 * Anna's Archive 图书搜索引擎适配器
 *
 * 搜索 Anna's Archive 上的免费图书资源。
 * URL: https://annas-archive.gl/search?q=QUERY
 *
 * 参考 SearXNG: searx/engines/annas_archive.py
 * 零风险：公开 HTML 页面解析
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const BASE_URL = "https://annas-archive.gl"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export function makeAnnasArchive(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchAnnasArchive(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchAnnasArchive(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const params = new URLSearchParams({ q: query, page: "1" })

    const response = yield* http.execute(
      HttpClientRequest.get(`${BASE_URL}/search?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "text/html",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    if (!html) return []

    return parseAnnasArchiveResults(html, numResults)
  })
}

export function parseAnnasArchiveResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  let pos = 0

  // 匹配 js-aarecord-list-outer 中的结果项
  const itemRegex = /<div[^>]*class="[^"]*flex[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?<a[^>]*class="[^"]*js-vim-focus[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div[^>]*class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\/div>)?[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<\/div>/gi

  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break

    let href = match[1].trim()
    const title = match[2].replace(/<[^>]+>/g, "").trim()
    const content = match[3] ? match[3].replace(/<[^>]+>/g, "").trim() : ""

    if (!title || !href) continue
    if (href.startsWith("/")) href = `${BASE_URL}${href}`

    pos++
    results.push(
      makeSearchResult({
        title,
        url: href,
        snippet: content || "Anna's Archive book",
        engine: "annas-archive",
        position: pos,
        category: "general",
      }),
    )
  }

  return results
}

export * as AnnasArchiveEngine from "./annas-archive"
