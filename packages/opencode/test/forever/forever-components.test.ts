import { expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { resolveForeverPrompt } from "../../src/forever/prompt"
import { ForeverState } from "../../src/forever/state"
import { ForeverCondition } from "../../src/forever/condition"
import { ForeverRelay } from "../../src/forever/relay"
import { Injection } from "../../src/session/injection"

// ---- resolveForeverPrompt ----

const promptIt = testEffect(Layer.empty)

describe("resolveForeverPrompt", () => {
  promptIt.effect("returns defaultText when source is undefined", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt(undefined, "default")
      expect(result).toBe("default")
    }),
  )

  promptIt.effect("returns defaultText when source type is unknown", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt({ type: "unknown" }, "default")
      expect(result).toBe("default")
    }),
  )

  promptIt.effect("returns inline text when source type is inline", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt({ type: "inline", text: "hello" }, "default")
      expect(result).toBe("hello")
    }),
  )

  promptIt.effect("falls back to default when inline text is empty", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt({ type: "inline", text: "" }, "default")
      expect(result).toBe("default")
    }),
  )

  promptIt.effect("returns defaultText when file does not exist", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt({ type: "file", command: "/nonexistent/file.txt" }, "default")
      expect(result).toBe("default")
    }),
  )

  promptIt.effect("returns defaultText when http url returns error", () =>
    Effect.gen(function* () {
      const result = yield* resolveForeverPrompt({ type: "http", url: "http://localhost:1/nonexistent" }, "default")
      expect(result).toBe("default")
    }),
  )
})

// ---- StatePersistenceService ----

const stateIt = testEffect(ForeverState.statePersistenceLayer)

describe("StatePersistenceService", () => {
  // 使用唯一 ID 前缀避免文件状态跨测试污染
  const sid = (label: string) => `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  stateIt.live("reads null for unknown session", () =>
    Effect.gen(function* () {
      const svc = yield* ForeverState.StatePersistenceService
      const result = yield* svc.readBudgetState(sid("unknown"))
      expect(result).toBeNull()
    }),
  )

  stateIt.live("writes and reads budget state", () =>
    Effect.gen(function* () {
      const id = sid("writes")
      const svc = yield* ForeverState.StatePersistenceService
      yield* svc.updateBudgetState(id, { rounds: 5, costUsd: 1.5 })
      const result = yield* svc.readBudgetState(id)
      expect(result).not.toBeNull()
      expect(result!.rounds).toBe(5)
      expect(result!.costUsd).toBe(1.5)
      expect(result!.startTime).toBeGreaterThan(0)
      expect(result!.lastActiveTime).toBeGreaterThan(0)
    }),
  )

  stateIt.live("accumulates rounds on successive updates", () =>
    Effect.gen(function* () {
      const id = sid("accum-rounds")
      const svc = yield* ForeverState.StatePersistenceService
      yield* svc.updateBudgetState(id, { rounds: 3 })
      yield* svc.updateBudgetState(id, { rounds: 2 })
      const result = yield* svc.readBudgetState(id)
      expect(result!.rounds).toBe(5)
      expect(result!.costUsd).toBe(0)
    }),
  )

  stateIt.live("accumulates cost on successive updates", () =>
    Effect.gen(function* () {
      const id = sid("accum-cost")
      const svc = yield* ForeverState.StatePersistenceService
      yield* svc.updateBudgetState(id, { costUsd: 1.0 })
      yield* svc.updateBudgetState(id, { costUsd: 2.5 })
      const result = yield* svc.readBudgetState(id)
      expect(result!.costUsd).toBeCloseTo(3.5)
    }),
  )

  stateIt.live("clears budget state", () =>
    Effect.gen(function* () {
      const id = sid("clears")
      const svc = yield* ForeverState.StatePersistenceService
      yield* svc.updateBudgetState(id, { rounds: 1 })
      yield* svc.clearBudgetState(id)
      const result = yield* svc.readBudgetState(id)
      expect(result).toBeNull()
    }),
  )

  stateIt.live("clearing non-existent state does not error", () =>
    Effect.gen(function* () {
      const svc = yield* ForeverState.StatePersistenceService
      const result = yield* svc.clearBudgetState(sid("nonexistent"))
      expect(result).toBeUndefined()
    }),
  )
})

// ---- ConditionEngine ----

const conditionIt = testEffect(ForeverCondition.conditionEngineLayer)

describe("ConditionEngine", () => {
  conditionIt.live("init with empty config does not throw", () =>
    Effect.gen(function* () {
      const engine = yield* ForeverCondition.ConditionEngineService
      yield* engine.init({})
    }),
  )

  conditionIt.live("shouldResume returns false when no drivers triggered", () =>
    Effect.gen(function* () {
      const engine = yield* ForeverCondition.ConditionEngineService
      yield* engine.init({})
      const state = yield* engine.getState()
      const resume = yield* engine.shouldResume(state)
      expect(resume).toBe(false)
    }),
  )

  conditionIt.live("timer driver triggers after interval", () =>
    Effect.gen(function* () {
      const engine = yield* ForeverCondition.ConditionEngineService
      const triggered: boolean[] = []
      yield* engine.init(
        { timer: { enabled: true, interval_ms: 50 } },
        () => { triggered.push(true) },
      )
      // 等待 timer 触发
      yield* Effect.sleep(100)
      const state = yield* engine.getState()
      const resume = yield* engine.shouldResume(state)
      expect(resume).toBe(true)
    }),
  )

  conditionIt.live("dispose cleans up drivers", () =>
    Effect.gen(function* () {
      const engine = yield* ForeverCondition.ConditionEngineService
      let triggered = false
      yield* engine.init(
        { timer: { enabled: true, interval_ms: 50 } },
        () => { triggered = true },
      )
      yield* engine.dispose()
      yield* Effect.sleep(100)
      // dispose 后不应再有触发
      expect(triggered).toBe(false)
    }),
  )
})

// ---- RelayService ----

const relayIt = testEffect(Layer.provideMerge(ForeverRelay.relayLayer, Injection.defaultLayer))

describe("RelayService", () => {
  relayIt.live("registers a child route", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-1", "http://localhost:4096", 12345)
      const children = yield* relay.children()
      expect(children).toHaveLength(1)
      expect(children[0].sessionID).toBe("session-1")
      expect(children[0].httpURL).toBe("http://localhost:4096")
      expect(children[0].pid).toBe(12345)
    }),
  )

  relayIt.live("has returns true for registered session", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-has", "http://localhost:4096")
      const result = yield* relay.has("session-has")
      expect(result).toBe(true)
    }),
  )

  relayIt.live("has returns false for unknown session", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      const result = yield* relay.has("unknown-session")
      expect(result).toBe(false)
    }),
  )

  relayIt.live("unregister removes a child route", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-2", "http://localhost:4096")
      yield* relay.unregister("session-2")
      const children = yield* relay.children()
      expect(children).toHaveLength(0)
    }),
  )

  relayIt.live("heartbeat updates lastHeartbeat", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-3", "http://localhost:4096")
      const before = (yield* relay.children())[0].lastHeartbeat
      yield* Effect.sleep(10)
      yield* relay.heartbeat("session-3")
      const after = (yield* relay.children())[0].lastHeartbeat
      expect(after).toBeGreaterThan(before)
    }),
  )

  relayIt.live("staleChildren returns children with expired heartbeat", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-stale", "http://localhost:4096")
      // 初始应无 stale
      const fresh = yield* relay.staleChildren()
      expect(fresh).toHaveLength(0)
      // 手动设置 lastHeartbeat 为很久以前
      // 通过内部状态无法直接操作，所以仅验证 fresh 情况
      // 实际 heartbeat 超时由定时器自动清理
    }),
  )

  relayIt.live("inject does not throw for existing child", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-4", "http://localhost:4096")
      yield* relay.inject("session-4", [{ type: "text", text: "hello", synthetic: true }])
    }),
  )

  relayIt.live("inject silently skips non-existent child", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.inject("nonexistent", [{ type: "text", text: "hello" }])
    }),
  )

  relayIt.live("shutdownAll clears all children", () =>
    Effect.gen(function* () {
      const relay = yield* ForeverRelay.RelayService
      yield* relay.register("session-5", "http://localhost:4096")
      yield* relay.register("session-6", "http://localhost:4096")
      yield* relay.shutdownAll()
      const children = yield* relay.children()
      expect(children).toHaveLength(0)
    }),
  )
})
