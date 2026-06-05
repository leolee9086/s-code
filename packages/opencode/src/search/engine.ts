/**
 * 搜索模块核心类型定义
 */
import { Data, Duration, Effect } from "effect"
import { HttpClient } from "effect/unstable/http"

// ── 搜索结果 ──────────────────────────────────────────

export interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly engine: string
  readonly position: number
  readonly publishedDate?: number
  readonly category?: string
}

export function makeSearchResult(data: SearchResult): SearchResult {
  return { ...data }
}

/** 聚合后的结果（去重合并后） */
export interface AggregatedResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly engines: readonly string[]
  readonly positions: readonly number[]
  score: number
  readonly publishedDate?: number
  readonly category?: string
}

export function makeAggregatedResult(data: {
  title: string
  url: string
  snippet: string
  engines: readonly string[]
  positions: readonly number[]
  score?: number
  publishedDate?: number
  category?: string
}): AggregatedResult {
  return { ...data, score: data.score ?? 0 }
}

// ── 引擎配置 ──────────────────────────────────────────

export interface EngineConfig {
  readonly name: string
  readonly weight: number
  readonly timeout: number // 毫秒
  readonly maxResults: number
  readonly requiresKey: boolean
  readonly priority: number
}

export function makeEngineConfig(data: {
  name: string
  weight?: number
  timeout?: number
  maxResults?: number
  requiresKey?: boolean
  priority?: number
}): EngineConfig {
  return {
    name: data.name,
    weight: data.weight ?? 1.0,
    timeout: data.timeout ?? Duration.toMillis(Duration.seconds(15)),
    maxResults: data.maxResults ?? 8,
    requiresKey: data.requiresKey ?? false,
    priority: data.priority ?? 0,
  }
}

// ── 引擎适配器接口 ────────────────────────────────────

export interface SearchEngine {
  readonly name: string
  readonly config: EngineConfig
  readonly search: (
    http: HttpClient.HttpClient,
    query: string,
    opts: SearchOptions,
  ) => Effect.Effect<readonly SearchResult[], unknown, never>
}

// ── 搜索选项 ──────────────────────────────────────────

export interface SearchOptions {
  readonly numResults: number
  readonly safesearch?: number
  readonly timeRange?: "day" | "week" | "month" | "year"
  readonly lang?: string
  readonly livecrawl?: boolean
}

export function makeSearchOptions(data?: {
  numResults?: number
  safesearch?: number
  timeRange?: "day" | "week" | "month" | "year"
  lang?: string
  livecrawl?: boolean
}): SearchOptions {
  return {
    numResults: data?.numResults ?? 8,
    safesearch: data?.safesearch,
    timeRange: data?.timeRange,
    lang: data?.lang,
    livecrawl: data?.livecrawl,
  }
}

// ── 错误类型 ──────────────────────────────────────────

export class EngineError extends Data.TaggedError("EngineError")<{
  engine: string
  message: string
  retryable: boolean
}> {}

export class CaptchaError extends Data.TaggedError("CaptchaError")<{
  engine: string
  message: string
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  engine: string
  retryAfter?: number
  message: string
}> {}

// ── 引擎健康状态 ──────────────────────────────────────

export interface EngineStatus {
  consecutiveFailures: number
  suspended: boolean
  suspendedUntil?: number
  lastError?: string
}

export function makeEngineStatus(): EngineStatus {
  return { consecutiveFailures: 0, suspended: false }
}

export * as SearchEngine from "./engine"
