/**
 * Void Linux 包搜索引擎适配器
 *
 * 搜索 Void Linux 仓库中的包。
 * API: https://x-bp.org/api/v1/query?property=name&value=QUERY
 *
 * 参考 SearXNG: searx/engines/voidlinux.py
 * 零风险：公开 JSON API，无需 key
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const API_URL = "https://x-bp.org/api/v1/query"
const USER_AGENT = "opencode-search/1.0"

export function makeVoidLinux(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchVoidLinux(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchVoidLinux(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      property: "name",
      value: query,
    })

    const response = yield* http.execute(
      HttpClientRequest.get(`${API_URL}?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const raw: string = yield* response.text
    if (!raw) return []

    return parseVoidLinuxResults(raw, numResults)
  })
}

interface VoidPackage {
  name?: string
  version?: string
  short_desc?: string
  homepage?: string
  arch?: string
  repository?: string
}

interface VoidResponse {
  data?: VoidPackage[]
}

function parseVoidLinuxResults(raw: string, maxResults: number): SearchResult[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const data = parsed as VoidResponse
  const packages = data?.data
  if (!Array.isArray(packages)) return []

  const results: SearchResult[] = []
  let pos = 0

  for (const pkg of packages) {
    if (results.length >= maxResults) break
    if (!pkg.name) continue

    const name = pkg.name
    const version = pkg.version || ""
    const description = pkg.short_desc || ""
    const arch = pkg.arch || "x86_64"
    const repository = pkg.repository || "main"

    const parts: string[] = []
    if (version) parts.push(`v${version}`)
    if (arch) parts.push(arch)
    if (repository) parts.push(repository)

    const snippet = parts.length > 0
      ? `[${parts.join(" · ")}] ${description}`.trim()
      : description || "Void Linux package"

    pos++
    results.push(
      makeSearchResult({
        title: `${name}${version ? ` v${version}` : ""}`,
        url: `https://voidlinux.org/packages/?arch=${arch}&repository=${repository}&name=${name}`,
        snippet: snippet.slice(0, 300),
        engine: "voidlinux",
        position: pos,
        category: "code",
      }),
    )
  }

  return results
}

export * as VoidLinuxEngine from "./voidlinux"
