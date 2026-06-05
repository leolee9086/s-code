import { describe, expect, test } from "bun:test"
import {
  makeSearchResult,
  makeAggregatedResult,
  makeEngineConfig,
  makeSearchOptions,
  makeEngineMetrics,
  makeEngineStatus,
  EngineError,
  CaptchaError,
  RateLimitError,
  AccessDeniedError,
  TimeoutError,
} from "../../src/search/engine"

// ── makeSearchResult ────────────────────────────────

describe("makeSearchResult", () => {
  test("creates result with all required fields", () => {
    const r = makeSearchResult({
      title: "Test",
      url: "https://example.com",
      snippet: "A snippet",
      engine: "duckduckgo",
      position: 1,
    })
    expect(r.title).toBe("Test")
    expect(r.url).toBe("https://example.com")
    expect(r.snippet).toBe("A snippet")
    expect(r.engine).toBe("duckduckgo")
    expect(r.position).toBe(1)
  })

  test("preserves optional fields", () => {
    const r = makeSearchResult({
      title: "Test",
      url: "https://example.com",
      snippet: "Snippet",
      engine: "brave",
      position: 2,
      publishedDate: 123456789,
      category: "general",
      suggestion: "corrected query",
    })
    expect(r.publishedDate).toBe(123456789)
    expect(r.category).toBe("general")
    expect(r.suggestion).toBe("corrected query")
  })
})

// ── makeAggregatedResult ────────────────────────────

describe("makeAggregatedResult", () => {
  test("creates aggregated result with defaults", () => {
    const r = makeAggregatedResult({
      title: "Test",
      url: "https://example.com",
      snippet: "Snippet",
      engines: ["duckduckgo"],
      positions: [1],
    })
    expect(r.score).toBe(0)
    expect(r.engines).toEqual(["duckduckgo"])
  })

  test("preserves score when provided", () => {
    const r = makeAggregatedResult({
      title: "Test",
      url: "https://example.com",
      snippet: "Snippet",
      engines: ["brave"],
      positions: [1],
      score: 2.5,
    })
    expect(r.score).toBe(2.5)
  })
})

// ── makeEngineConfig ────────────────────────────────

describe("makeEngineConfig", () => {
  test("uses defaults for optional fields", () => {
    const cfg = makeEngineConfig({ name: "test" })
    expect(cfg.name).toBe("test")
    expect(cfg.weight).toBe(1.0)
    expect(cfg.timeout).toBeGreaterThan(0)
    expect(cfg.maxResults).toBe(8)
    expect(cfg.requiresKey).toBe(false)
    expect(cfg.priority).toBe(0)
  })

  test("preserves provided values", () => {
    const cfg = makeEngineConfig({ name: "brave", weight: 2.0, maxResults: 10, priority: 1 })
    expect(cfg.weight).toBe(2.0)
    expect(cfg.maxResults).toBe(10)
    expect(cfg.priority).toBe(1)
  })
})

// ── makeSearchOptions ───────────────────────────────

describe("makeSearchOptions", () => {
  test("uses defaults for optional fields", () => {
    const opts = makeSearchOptions()
    expect(opts.numResults).toBe(8)
    expect(opts.safesearch).toBeUndefined()
    expect(opts.timeRange).toBeUndefined()
    expect(opts.lang).toBeUndefined()
    expect(opts.livecrawl).toBeUndefined()
  })

  test("preserves provided options", () => {
    const opts = makeSearchOptions({ numResults: 5, timeRange: "week", lang: "zh-CN" })
    expect(opts.numResults).toBe(5)
    expect(opts.timeRange).toBe("week")
    expect(opts.lang).toBe("zh-CN")
  })
})

// ── makeEngineMetrics / makeEngineStatus ────────────

describe("makeEngineMetrics", () => {
  test("starts at zero", () => {
    const m = makeEngineMetrics()
    expect(m.totalRequests).toBe(0)
    expect(m.successfulRequests).toBe(0)
    expect(m.avgLatency).toBe(0)
    expect(m.totalLatency).toBe(0)
  })
})

describe("makeEngineStatus", () => {
  test("starts healthy", () => {
    const s = makeEngineStatus()
    expect(s.consecutiveFailures).toBe(0)
    expect(s.totalFailures).toBe(0)
    expect(s.suspended).toBe(false)
    expect(s.lastError).toBeUndefined()
  })
})

// ── Error types ─────────────────────────────────────

describe("search error types", () => {
  test("EngineError has required fields", () => {
    const err = new EngineError({ engine: "ddg", message: "timeout", retryable: true })
    expect(err.engine).toBe("ddg")
    expect(err.message).toBe("timeout")
    expect(err.retryable).toBe(true)
    expect(err).toBeInstanceOf(Error)
  })

  test("CaptchaError has engine and message", () => {
    const err = new CaptchaError({ engine: "ddg", message: "captcha required" })
    expect(err.engine).toBe("ddg")
    expect(err.message).toBe("captcha required")
  })

  test("RateLimitError has optional retryAfter", () => {
    const err = new RateLimitError({ engine: "ddg", message: "rate limited", retryAfter: 60 })
    expect(err.retryAfter).toBe(60)
  })

  test("AccessDeniedError for permanent bans", () => {
    const err = new AccessDeniedError({ engine: "brave", message: "403 forbidden" })
    expect(err.engine).toBe("brave")
  })

  test("TimeoutError for engine timeout", () => {
    const err = new TimeoutError({ engine: "ddg", message: "request timed out" })
    expect(err.engine).toBe("ddg")
  })
})
