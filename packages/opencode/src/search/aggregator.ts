/**
 * 搜索结果聚合器
 *
 * 借鉴 SearXNG 的 ResultContainer 设计，实现去重、合并、评分、排序。
 */
import type { AggregatedResult, SearchResult } from "./engine"
import { makeAggregatedResult } from "./engine"

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.protocol = "https:"
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1)
    ;["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "source"]
      .forEach((p) => u.searchParams.delete(p))
    u.searchParams.sort()
    return u.toString()
  } catch { return url }
}

function levenshtein(a: string, b: string): number {
  const m = a.length; const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
    }
  }
  return dp[m][n]
}

function isSimilarTitle(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return true
  return levenshtein(a, b) / maxLen < 0.2
}

export function calculateScore(
  engines: readonly string[],
  positions: readonly number[],
  weights: Map<string, number>,
): number {
  let score = 0
  for (let i = 0; i < engines.length; i++) {
    score += (weights.get(engines[i]) ?? 1.0) / positions[i]
  }
  if (engines.length > 1) score *= 1 + (engines.length - 1) * 0.2
  return score
}

export interface AggregateContext {
  weights: Map<string, number>
  maxResults: number
}

export function aggregate(
  allResults: readonly SearchResult[],
  ctx: AggregateContext,
): AggregatedResult[] {
  // 阶段 1: URL 去重
  const urlMap = new Map<string, SearchResult[]>()
  for (const r of allResults) {
    const key = normalizeUrl(r.url)
    const group = urlMap.get(key) ?? []
    group.push(r)
    urlMap.set(key, group)
  }

  const mergedByUrl: AggregatedResult[] = []
  for (const [, group] of urlMap) mergedByUrl.push(mergeGroup(group))

  // 阶段 2: 相似标题合并
  const merged: AggregatedResult[] = []
  const used = new Set<number>()
  for (let i = 0; i < mergedByUrl.length; i++) {
    if (used.has(i)) continue
    used.add(i)
    const similarGroup: AggregatedResult[] = [mergedByUrl[i]]
    for (let j = i + 1; j < mergedByUrl.length; j++) {
      if (used.has(j)) continue
      if (isSimilarTitle(mergedByUrl[i].title, mergedByUrl[j].title)) {
        used.add(j)
        similarGroup.push(mergedByUrl[j])
      }
    }
    merged.push(similarGroup.length === 1 ? similarGroup[0] : mergeSimilar(similarGroup))
  }

  // 阶段 3: 评分 + 多样性排序
  for (const r of merged) r.score = calculateScore(r.engines, r.positions, ctx.weights)
  merged.sort((a, b) => b.score - a.score)

  return diversifyByDomain(merged, 3).slice(0, ctx.maxResults)
}

function mergeGroup(group: SearchResult[]): AggregatedResult {
  const first = group[0]
  const engines: string[] = []
  const positions: number[] = []
  let bestTitle = first.title
  let bestSnippet = first.snippet
  let bestDate = first.publishedDate

  for (const r of group) {
    engines.push(r.engine)
    positions.push(r.position)
    if (r.title.length > bestTitle.length) bestTitle = r.title
    if (r.snippet.length > bestSnippet.length) bestSnippet = r.snippet
    if (r.publishedDate && (!bestDate || r.publishedDate > bestDate)) bestDate = r.publishedDate
  }

  return makeAggregatedResult({
    title: bestTitle, url: first.url, snippet: bestSnippet,
    engines, positions, publishedDate: bestDate, category: first.category,
  })
}

function mergeSimilar(group: AggregatedResult[]): AggregatedResult {
  const first = group[0]
  return makeAggregatedResult({
    title: first.title,
    url: first.url,
    snippet: group.reduce((best, r) => r.snippet.length > best.length ? r.snippet : best, first.snippet),
    engines: [...new Set(group.flatMap((r) => r.engines))],
    positions: group.flatMap((r) => r.positions),
    publishedDate: group.reduce(
      (best, r) => r.publishedDate && (!best || r.publishedDate > best) ? r.publishedDate : best,
      first.publishedDate,
    ),
    category: first.category,
  })
}

function diversifyByDomain(results: AggregatedResult[], maxPerDomain: number): AggregatedResult[] {
  const domainCount = new Map<string, number>()
  const diversified: AggregatedResult[] = []
  const remaining: AggregatedResult[] = []

  for (const r of results) {
    try {
      const domain = new URL(r.url).hostname.replace(/^www\./, "")
      const count = domainCount.get(domain) ?? 0
      if (count < maxPerDomain) {
        domainCount.set(domain, count + 1)
        diversified.push(r)
      } else {
        remaining.push(r)
      }
    } catch { diversified.push(r) }
  }
  diversified.push(...remaining)
  return diversified
}

export function formatResults(results: AggregatedResult[], query: string): string {
  if (results.length === 0) return ""
  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   来源: ${r.engines.join(" + ")}\n   ${r.snippet ?? ""}`,
  )
  return [`搜索结果 "${query}"：`, ...lines].join("\n\n")
}

export * as Aggregator from "./aggregator"
