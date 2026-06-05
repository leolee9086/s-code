/**
 * Discourse 论坛搜索引擎适配器
 *
 * 搜索 Discourse 论坛平台上的帖子。
 * API: https://meta.discourse.org/search.json?q=QUERY
 *
 * 参考 SearXNG: searx/engines/discourse.py
 * 零风险：公开 JSON API，无需 key
 * 搜索主流 Discourse 实例
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const DISCOURSE_INSTANCES = [
  "https://meta.discourse.org",
  "https://forums.linuxcnc.org",
]
const USER_AGENT = "opencode-search/1.0"
const API_PATH = "/search.json"

export function makeDiscourse(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchDiscourse(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchDiscourse(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const results: SearchResult[] = []
    const perInstance = Math.ceil(numResults / DISCOURSE_INSTANCES.length)

    for (const instance of DISCOURSE_INSTANCES) {
      if (results.length >= numResults) break

      const params = new URLSearchParams({
        q: query,
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

        const instanceResults = parseDiscourseResults(raw, instance, perInstance)
        results.push(...instanceResults)
      } catch {
        continue
      }
    }

    return results.slice(0, numResults)
  })
}

interface DiscourseTopic {
  id?: number
  title?: string
  slug?: string
  fancy_title?: string
  posts_count?: number
  views?: number
  like_count?: number
  last_posted_at?: string
  created_at?: string
}

interface DiscourseSearchResponse {
  topics?: DiscourseTopic[]
}

function parseDiscourseResults(raw: string, instance: string, maxResults: number): SearchResult[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const data = parsed as DiscourseSearchResponse
  const topics = data?.topics
  if (!Array.isArray(topics)) return []

  const results: SearchResult[] = []
  let pos = 0

  for (const topic of topics) {
    if (results.length >= maxResults) break
    if (!topic.title || !topic.id) continue

    const title = topic.title
    const slug = topic.slug || ""
    const url = `${instance}/t/${slug}/${topic.id}`
    const posts = topic.posts_count ?? 0
    const views = topic.views ?? 0
    const likes = topic.like_count ?? 0

    const parts: string[] = []
    if (posts > 1) parts.push(`${posts} posts`)
    if (views > 0) parts.push(`${formatViews(views)} views`)
    if (likes > 0) parts.push(`${likes} likes`)

    const snippet = parts.length > 0
      ? `[${parts.join(" · ")}] Discourse topic`
      : "Discourse topic"

    pos++
    results.push(
      makeSearchResult({
        title,
        url,
        snippet: snippet.slice(0, 300),
        engine: "discourse",
        position: pos,
        publishedDate: topic.last_posted_at ? new Date(topic.last_posted_at).getTime() : undefined,
        category: "social",
      }),
    )
  }

  return results
}

function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`
  return String(views)
}

export * as DiscourseEngine from "./discourse"
