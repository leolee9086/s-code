/**
 * Arch Linux 包搜索引擎适配器
 *
 * 搜索 Arch Linux 官方仓库和 AUR 中的包。
 * API: https://archlinux.org/packages/search/json/?q=QUERY
 *
 * 参考 SearXNG: searx/engines/archlinux.py
 * 零风险：公开 JSON API，无需 key
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const API_URL = "https://archlinux.org/packages/search/json/"
const AUR_API_URL = "https://aur.archlinux.org/rpc.php"
const USER_AGENT = "opencode-search/1.0"

export function makeArchLinux(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchArchLinux(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchArchLinux(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    // 搜索官方仓库
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(numResults, 50)),
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

    return parseArchLinuxResults(raw, numResults)
  })
}

interface ArchPackage {
  pkgname?: string
  pkgbase?: string
  pkgver?: string
  pkgdesc?: string
  url?: string
  maintainer?: string
  arch?: string
  repo?: string
  last_update?: string
}

interface ArchResponse {
  result?: ArchPackage[]
}

function parseArchLinuxResults(raw: string, maxResults: number): SearchResult[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const data = parsed as ArchResponse
  const packages = data?.result
  if (!Array.isArray(packages)) return []

  const results: SearchResult[] = []
  let pos = 0

  for (const pkg of packages) {
    if (results.length >= maxResults) break
    if (!pkg.pkgname) continue

    const name = pkg.pkgname
    const version = pkg.pkgver || ""
    const description = pkg.pkgdesc || ""
    const repo = pkg.repo || "extra"
    const arch = pkg.arch || "x86_64"

    const parts: string[] = []
    if (version) parts.push(`v${version}`)
    if (repo) parts.push(repo)
    if (arch) parts.push(arch)

    const snippet = parts.length > 0
      ? `[${parts.join(" · ")}] ${description}`.trim()
      : description || "Arch Linux package"

    pos++
    results.push(
      makeSearchResult({
        title: `${name}${version ? ` v${version}` : ""}`,
        url: `https://archlinux.org/packages/${repo}/${arch}/${name}/`,
        snippet: snippet.slice(0, 300),
        engine: "archlinux",
        position: pos,
        publishedDate: pkg.last_update ? new Date(pkg.last_update).getTime() : undefined,
        category: "code",
      }),
    )
  }

  return results
}

export * as ArchLinuxEngine from "./archlinux"
