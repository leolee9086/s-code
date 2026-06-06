import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import type { EngineStatus } from "../../src/search/engine"
import { RateLimitError, AccessDeniedError, EngineError, makeEngineConfig, makeSearchResult, makeEngineStatus } from "../../src/search/engine"
import { Executor, resetGlobalState, MAX_CONCURRENCY } from "../../src/search/executor"
import type { SearchEngine, SearchOptions } from "../../src/search/engine"

// ── Constants ──────────────────────────────────────

describe("MAX_CONCURRENCY", () => {
  test("has a reasonable default value", () => {
    expect(MAX_CONCURRENCY).toBeGreaterThan(0)
    expect(MAX_CONCURRENCY).toBeLessThanOrEqual(50)
  })
})

// ── ExecutorState ───────────────────────────────────

describe("ExecutorState", () => {
  test("starts with empty engine statuses", () => {
    const state = new Executor.ExecutorState()
    expect(state.engineStatuses.size).toBe(0)
  })
})

// ── Global State ────────────────────────────────────

describe("global engine state", () => {
  test("getGlobalState returns state with engineStatuses map", () => {
    const state = Executor.getGlobalState()
    expect(state.engineStatuses).toBeInstanceOf(Map)
  })

  test("resetGlobalState clears engine statuses", () => {
    resetGlobalState()
    const state = Executor.getGlobalState()
    expect(state.engineStatuses.size).toBe(0)
  })
})

// ── Engine Status Management ────────────────────────

describe("engine health tracking", () => {
  test("healthy engine succeeds and resets failures", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "test-engine",
      config: makeEngineConfig({ name: "test-engine", timeout: 5000 }),
      search: () => Effect.succeed([
        makeSearchResult({ title: "Test", url: "https://example.com", snippet: "Snippet", engine: "test", position: 1 }),
      ]),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "test query", { numResults: 8 }, state)
      expect(result.results.length).toBe(1)
      expect(result.errors.length).toBe(0)

      const status = state.engineStatuses.get("test-engine")
      expect(status).toBeDefined()
      expect(status!.consecutiveFailures).toBe(0)
      expect(status!.suspended).toBe(false)
      expect(status!.metrics.totalRequests).toBe(1)
      expect(status!.metrics.successfulRequests).toBe(1)
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("rate limited engine is suspended with retry-after", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "rate-limited",
      config: makeEngineConfig({ name: "rate-limited", timeout: 5000 }),
      search: () => Effect.fail(new RateLimitError({ engine: "rate-limited", message: "too many requests", retryAfter: 30 })),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
      expect(result.errors.length).toBe(1)

      const status = state.engineStatuses.get("rate-limited")
      expect(status).toBeDefined()
      expect(status!.suspended).toBe(true)
      expect(status!.suspendedUntil).toBeGreaterThan(Date.now())
      expect(status!.lastSuspensionReason).toContain("rate-limited")
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("access denied engine is permanently suspended", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "blocked",
      config: makeEngineConfig({ name: "blocked", timeout: 5000 }),
      search: () => Effect.fail(new AccessDeniedError({ engine: "blocked", message: "403 forbidden" })),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)

      const status = state.engineStatuses.get("blocked")
      expect(status).toBeDefined()
      expect(status!.suspended).toBe(true)
      expect(status!.lastSuspensionReason).toBe("access-denied")
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("suspended engine is filtered out", () => {
    resetGlobalState()
    const state = new Executor.ExecutorState()

    // Pre-mark an engine as suspended
    const status = makeEngineStatus()
    status.suspended = true
    status.suspendedUntil = Date.now() + Duration.toMillis(Duration.hours(1))
    state.engineStatuses.set("sleeping-engine", status)

    const engine: SearchEngine = {
      name: "sleeping-engine",
      config: makeEngineConfig({ name: "sleeping-engine", timeout: 5000 }),
      search: () => Effect.succeed([makeSearchResult({ title: "Should not run", url: "https://example.com", snippet: "", engine: "sleeping", position: 1 })]),
    }

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0) // engine was filtered out
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("engine with expired suspension is re-activated", () => {
    resetGlobalState()
    const state = new Executor.ExecutorState()

    // Engine was suspended but suspension has expired
    const status = makeEngineStatus()
    status.suspended = true
    status.suspendedUntil = Date.now() - 1000 // expired 1 second ago
    status.consecutiveFailures = 3
    state.engineStatuses.set("recovered-engine", status)

    const engine: SearchEngine = {
      name: "recovered-engine",
      config: makeEngineConfig({ name: "recovered-engine", timeout: 5000 }),
      search: () => Effect.succeed([makeSearchResult({ title: "Recovered", url: "https://example.com", snippet: "", engine: "recovered", position: 1 })]),
    }

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(1) // engine was re-activated

      const s = state.engineStatuses.get("recovered-engine")
      expect(s!.suspended).toBe(false) // should be unsuspended
      expect(s!.consecutiveFailures).toBe(0) // should be reset
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("no engines available returns empty result", () => {
    resetGlobalState()
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
      expect(result.errors.length).toBe(0)
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("all engines suspended returns empty", () => {
    resetGlobalState()
    const state = new Executor.ExecutorState()

    const status = makeEngineStatus()
    status.suspended = true
    status.suspendedUntil = Date.now() + Duration.toMillis(Duration.days(1))
    state.engineStatuses.set("suspended-1", status)

    const engine: SearchEngine = {
      name: "suspended-1",
      config: makeEngineConfig({ name: "suspended-1", timeout: 5000 }),
      search: () => Effect.succeed([]),
    }

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("generic error triggers exponential backoff", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "faulty",
      config: makeEngineConfig({ name: "faulty", timeout: 5000 }),
      search: () => Effect.fail(new Error("unexpected failure")),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
      expect(result.errors.length).toBe(1)

      const status = state.engineStatuses.get("faulty")
      expect(status).toBeDefined()
      expect(status!.consecutiveFailures).toBe(1)
      expect(status!.suspended).toBe(true)
      expect(status!.totalFailures).toBe(1)
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("timeout triggers suspension with backoff", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "slow-engine",
      config: makeEngineConfig({ name: "slow-engine", timeout: 10 }), // 10ms timeout
      search: () => Effect.sleep("5 seconds").pipe(Effect.andThen(Effect.succeed([]))),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
      expect(result.errors.length).toBe(1)

      const status = state.engineStatuses.get("slow-engine")
      expect(status).toBeDefined()
      expect(status!.suspended).toBe(true)
      expect(status!.consecutiveFailures).toBe(1)
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("sequential failures escalate backoff duration", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "escalating",
      config: makeEngineConfig({ name: "escalating", timeout: 5000 }),
      search: () => Effect.fail(new Error("persistent failure")),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      // First failure → 1 min backoff
      yield* Executor.executeAll([engine], {} as any, "q", { numResults: 8 }, state)
      let status = state.engineStatuses.get("escalating")!
      expect(status.consecutiveFailures).toBe(1)
      expect(status.lastSuspensionReason).toContain("1min")

      // Second failure → 5 min backoff
      // Clear suspension for next call
      status.suspended = false
      yield* Executor.executeAll([engine], {} as any, "q", { numResults: 8 }, state)
      status = state.engineStatuses.get("escalating")!
      expect(status.consecutiveFailures).toBe(2)
      expect(status.lastSuspensionReason).toContain("5min")

      // Third failure → 15 min backoff
      status.suspended = false
      yield* Executor.executeAll([engine], {} as any, "q", { numResults: 8 }, state)
      status = state.engineStatuses.get("escalating")!
      expect(status.consecutiveFailures).toBe(3)
      expect(status.lastSuspensionReason).toContain("15min")
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("engine defect is caught by catchDefect handler", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "defective",
      config: makeEngineConfig({ name: "defective", timeout: 5000 }),
      search: () => Effect.die("unexpected internal error"),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      const result = yield* Executor.executeAll([engine], {} as any, "query", { numResults: 8 }, state)
      expect(result.results.length).toBe(0)
      expect(result.errors.length).toBe(1)

      const status = state.engineStatuses.get("defective")
      expect(status).toBeDefined()
      expect(status!.suspended).toBe(true)
      expect(status!.lastError).toContain("defect")
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("backoff jitter produces varied suspension durations", () => {
    resetGlobalState()
    const createFailingEngine = (name: string): SearchEngine => ({
      name,
      config: makeEngineConfig({ name, timeout: 5000 }),
      search: () => Effect.fail(new Error("fail")),
    })
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      // Run 5 failures and collect all suspension reasons
      const reasons: string[] = []
      for (let i = 0; i < 5; i++) {
        yield* Executor.executeAll(
          [createFailingEngine(`jitter-test`)],
          {} as any, "q", { numResults: 8 }, state,
        )
        const status = state.engineStatuses.get("jitter-test")!
        reasons.push(status.lastSuspensionReason || "")
        status.suspended = false // allow next call
      }

      // All reasons should contain "jitter="
      for (const r of reasons) expect(r).toContain("jitter=")

      // Extract jitter factors and verify they vary
      const jitterFactors = reasons
        .map((r) => r.match(/jitter=([\d.]+)/)?.[1])
        .filter(Boolean)
        .map(Number)

      // With 5 samples, at least 2 should be different (99.9% probability)
      const uniqueFactors = new Set(jitterFactors)
      expect(uniqueFactors.size).toBeGreaterThan(1)

      // All jitter factors should be within [0.8, 1.2]
      for (const f of jitterFactors) {
        expect(f).toBeGreaterThanOrEqual(0.8)
        expect(f).toBeLessThanOrEqual(1.2)
      }
    }).pipe(Effect.scoped, Effect.runPromise)
  })

  test("backoff clamps at 60 minutes max", () => {
    resetGlobalState()
    const engine: SearchEngine = {
      name: "clamp-test",
      config: makeEngineConfig({ name: "clamp-test", timeout: 5000 }),
      // Simulate a defect that continues to fail
      search: () => Effect.die("fatal"),
    }
    const state = new Executor.ExecutorState()

    return Effect.gen(function* () {
      // Fail many times to reach max backoff
      for (let i = 0; i < 10; i++) {
        yield* Executor.executeAll([engine], {} as any, "q", { numResults: 8 }, state)
        const status = state.engineStatuses.get("clamp-test")!
        status.suspended = false
      }

      const status = state.engineStatuses.get("clamp-test")!
      expect(status.consecutiveFailures).toBe(10)
      // Even with many failures, the max backoff is still reasonable
      // (jitter may push it slightly above but should be clamped near 15-60 min)
      const maxDurationMs = (status.suspendedUntil || 0) - Date.now()
      const maxDurationMin = maxDurationMs / 60_000
      expect(maxDurationMin).toBeLessThanOrEqual(65) // 60min + jitter margin
    }).pipe(Effect.scoped, Effect.runPromise)
  })
})
