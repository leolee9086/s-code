/**
 * Lemmy 去中心化社交搜索引擎适配器
 *
 * 搜索 Lemmy 联邦宇宙中的帖子（Reddit 替代方案）。
 * API: https://lemmy.ml/api/v3/search?q=QUERY&type=Posts
 *
 * 参考 SearXNG: searx/engines/lemmy.py
 * 零风险：公开 JSON API，无需 key
 * 仅搜索主流实例（lemmy.ml、lemmy.world、lemdro.id）
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const LEMMY_INSTANCES = [
  "https://lemmy.world",
  "https://lemmy.ml",
  "https://lemdro.id",
]
const USER_AGENT = "opencode-search/1.0"
const API_PATH = "/api/v3/search"

export function makeLemmy(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchLemmy(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchLemmy(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const results: SearchResult[] = []
    const perInstance = Math.ceil(numResults / LEMMY_INSTANCES.length)

    for (const instance of LEMMY_INSTANCES) {
      if (results.length >= numResults) break

      const params = new URLSearchParams({
        q: query,
        type_name: "Posts",
        sort: "New",
        limit: String(Math.min(perInstance, 20)),
      })

      try {
        const response = yield* http.execute(
          HttpClientRequest.get(`${instance}${API_PATH}?${params.toString()}`).pipe(
            HttpClientRequest.setHeaders({
              "User-Agent": USER_AGENT,
              Accept: "application/json",
            }),
          ),
        ).pipe(Effect.timeout(timeout))

        if (response.status < 200 || response.status >= 400) continue
        const raw: string = yield* response.text
        if (!raw) continue

        const instanceResults = parseLemmyResults(raw, instance, perInstance)
        results.push(...instanceResults)
      } catch {
        // 单个实例失败不影响其他实例
        continue
      }
    }

    return results.slice(0, numResults)
  })
}

interface LemmyPost {
  id?: number
  name?: string
  body?: string
  url?: string
  published?: string
  creator_name?: string
  community_name?: string
  score?: number
  num_comments?: number
}

interface LemmyComment {
  comment?: {
    id?: number
    content?: string
    published?: string
    creator_name?: string
    post_name?: string
    post_id?: number
    community_name?: string
  }
}

interface LemmySearchResponse {
  posts?: LemmyPost[]
  comments?: LemmyComment[]
}

function parseLemmyResults(raw: string, instance: string, maxResults: number): SearchResult[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const data = parsed as LemmySearchResponse
  const results: SearchResult[] = []
  let pos = 0

  // Parse posts
  if (Array.isArray(data?.posts)) {
    for (const post of data.posts) {
      if (results.length >= maxResults) break
      if (!post.name) continue

      const title = post.name
      const community = post.community_name || ""
      const author = post.creator_name || ""
      const score = post.score ?? 0
      const comments = post.num_comments ?? 0
      const url = post.url || `${instance}/post/${post.id || ""}`

      const parts: string[] = []
      if (community) parts.push(`c/${community}`)
      if (author) parts.push(`u/${author}`)
      if (score > 0) parts.push(`${score} pts`)
      if (comments > 0) parts.push(`${comments} comments`)

      const snippet = parts.length > 0
        ? `[${parts.join(" · ")}] ${(post.body || "").slice(0, 200)}`.trim()
        : post.body?.slice(0, 300) || "Lemmy post"

      pos++
      results.push(
        makeSearchResult({
          title,
          url,
          snippet: snippet.slice(0, 300),
          engine: "lemmy",
          position: pos,
          publishedDate: post.published ? new Date(post.published).getTime() : undefined,
          category: "social",
        }),
      )
    }
  }

  return results
}

export * as LemmyEngine from "./lemmy"
