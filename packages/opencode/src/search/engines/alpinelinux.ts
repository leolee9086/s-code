/**
 * Alpine Linux 包搜索引擎适配器
 *
 * 搜索 Alpine Linux 仓库中的包。
 * URL: https://pkgs.alpinelinux.org/packages?name=QUERY
 *
 * 参考 SearXNG: searx/engines/alpinelinux.py
 * 零风险：公开 HTML 页面解析
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const BASE_URL = "https://pkgs.alpinelinux.org"
const USER_AGENT = "opencode-search/1.0"

export function makeAlpineLinux(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchAlpineLinux(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchAlpineLinux(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      name: query,
      branch: "edge",
      page: "1",
    })

    const response = yield* http.execute(
      HttpClientRequest.get(`${BASE_URL}/packages?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "text/html",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    if (!html) return []

    return parseAlpineLinuxResults(html, numResults)
  })
}

function parseAlpineLinuxResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  let pos = 0

  // 匹配包表格行
  const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<\/tr>/gi

  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break

    const href = match[1].trim()
    const name = match[2].trim()
    const version = match[3].trim()
    const repo = match[4].trim()
    const description = match[5].trim()

    if (!name) continue

    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`

    const parts: string[] = []
    if (version) parts.push(`v${version}`)
    if (repo) parts.push(repo)

    const snippet = parts.length > 0
      ? `[${parts.join(" · ")}] ${description}`.trim()
      : description || "Alpine Linux package"

    pos++
    results.push(
      makeSearchResult({
        title: `${name}${version ? ` v${version}` : ""}`,
        url,
        snippet: snippet.slice(0, 300),
        engine: "alpinelinux",
        position: pos,
        category: "code",
      }),
    )
  }

  // 备用模式：更宽松的匹配
  if (results.length === 0) {
    const fallbackRegex = /<a[^>]*href="\/packages\?name=([^&"]+)"[^>]*>([^<]+)<\/a>/gi
    while ((match = fallbackRegex.exec(html)) !== null) {
      if (results.length >= maxResults) break

      const packageName = match[1]
      const name = match[2].trim()

      if (!name || !packageName) continue

      pos++
      results.push(
        makeSearchResult({
          title: name,
          url: `${BASE_URL}/packages?name=${packageName}&branch=edge`,
          snippet: "Alpine Linux package",
          engine: "alpinelinux",
          position: pos,
          category: "code",
        }),
      )
    }
  }

  return results
}

export * as AlpineLinuxEngine from "./alpinelinux"
