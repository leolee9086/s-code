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

/**
 * 计算聚合评分
 *
 * 借鉴 SearXNG 的 calculate_score 算法，但增加了时效性衰减因子。
 *
 * 评分组成：
 * 1. 基础分 = Σ(weight / position) — 位置越前、引擎权重越高，得分越高
 * 2. 多样性加分 = 基础分 × (1 + (引擎数-1) × 0.2) — 多引擎一致结果加分
 * 3. 时效性衰减 = 分 × max(0.5, 1 - 天数/365) — 一年内线性衰减至 50%
 */
export function calculateScore(
  engines: readonly string[],
  positions: readonly number[],
  weights: Map<string, number>,
  publishedDate?: number,
): number {
  // 基础分：加权位置分
  let score = 0
  for (let i = 0; i < engines.length; i++) {
    score += (weights.get(engines[i]) ?? 1.0) / positions[i]
  }

  // 引擎多样性加分（多引擎一致 → 置信度高）
  if (engines.length > 1) score *= 1 + (engines.length - 1) * 0.2

  // 时效性加分（新结果额外加 10%，一年后衰减至 -10%）
  if (publishedDate) {
    const daysAgo = (Date.now() - publishedDate) / 86_400_000
    const recencyFactor = Math.max(0.5, 1 - daysAgo / 365)
    score *= recencyFactor
  }

  return score
}

export interface AggregateContext {
  weights: Map<string, number>
  maxResults: number
  /** 来自搜索引擎的拼写建议（如 "Did you mean: ..."） */
  suggestion?: string
}

export function aggregate(
  allResults: readonly SearchResult[],
  ctx: AggregateContext,
): AggregatedResult[] {
  // 从原始结果中提取拼写建议
  if (!ctx.suggestion) {
    for (const r of allResults) {
      if (r.suggestion) { ctx.suggestion = r.suggestion; break }
    }
  }

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

  // 阶段 3: 评分（含时效性衰减）+ 多样性排序
  for (const r of merged) {
    r.score = calculateScore(r.engines, r.positions, ctx.weights, r.publishedDate)
  }
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
  let suggestion: string | undefined

  for (const r of group) {
    engines.push(r.engine)
    positions.push(r.position)
    if (r.title.length > bestTitle.length) bestTitle = r.title
    if (r.snippet.length > bestSnippet.length) bestSnippet = r.snippet
    if (r.publishedDate && (!bestDate || r.publishedDate > bestDate)) bestDate = r.publishedDate
    if (r.suggestion && !suggestion) suggestion = r.suggestion
  }

  return makeAggregatedResult({
    title: bestTitle, url: first.url, snippet: bestSnippet,
    engines, positions, publishedDate: bestDate, category: first.category,
    suggestion,
  })
}

function mergeSimilar(group: AggregatedResult[]): AggregatedResult {
  const first = group[0]
  const suggestion = group.find((r) => r.suggestion)?.suggestion
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
    suggestion,
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

export function formatResults(results: AggregatedResult[], query: string, ctxSuggestion?: string): string {
  if (results.length === 0) return ""

  const lines = results.map(
    (r, i) =>
      `${i + 1}. ${r.title}\n` +
      `   URL: ${r.url}\n` +
      `   来源: ${r.engines.join(" + ")}\n` +
      `   ${r.snippet ?? ""}` +
      (r.publishedDate ? `\n   日期: ${new Date(r.publishedDate).toISOString().slice(0, 10)}` : ""),
  )

  const parts: string[] = [`搜索结果 "${query}"：`, ...lines]

  // 如果有拼写建议，追加在末尾
  const suggestion = results.find((r) => r.suggestion)?.suggestion ?? ctxSuggestion
  if (suggestion) {
    parts.push(`\n💡 您是不是想找: ${suggestion}`)
  }

  return parts.join("\n\n")
}

/** 格式化引擎健康状态报告 */
export function formatEngineStatusReport(statuses: Map<string, import("./engine").EngineStatus>): string {
  const lines: string[] = ["引擎健康状态报告："]
  for (const [name, s] of statuses) {
    const latency = s.metrics.successfulRequests > 0
      ? `${Math.round(s.metrics.avgLatency)}ms avg`
      : "no data"
    const successRate = s.metrics.totalRequests > 0
      ? `${Math.round((s.metrics.successfulRequests / s.metrics.totalRequests) * 100)}%`
      : "no data"
    lines.push(
      `  ${name}:` +
      ` ${s.suspended ? "🔴暂停中" : "🟢正常"}` +
      ` 成功率=${successRate}` +
      ` 延迟=${latency}` +
      ` 连续失败=${s.consecutiveFailures}` +
      (s.lastError ? ` 上次错误="${s.lastError}"` : ""),
    )
  }
  return lines.join("\n")
}

export * as Aggregator from "./aggregator"
