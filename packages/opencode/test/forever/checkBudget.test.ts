import { describe, expect, test } from "bun:test"
import { checkBudget } from "../../src/forever/forever"
import type { ForeverConfigShape } from "../../src/forever/forever"

const baseState = { rounds: 0, costUsd: 0, startTime: Date.now(), lastActiveTime: Date.now() }

describe("checkBudget", () => {
  test("returns allowed when config is undefined", () => {
    expect(checkBudget(undefined, null)).toEqual({ allowed: true })
  })

  test("returns allowed when config.budget is undefined", () => {
    expect(checkBudget({} as ForeverConfigShape, baseState)).toEqual({ allowed: true })
  })

  test("returns allowed when budgetState is null", () => {
    expect(checkBudget({ budget: { max_rounds: 5 } }, null)).toEqual({ allowed: true })
  })

  describe("max_rounds", () => {
    test("returns allowed when rounds < max_rounds", () => {
      const result = checkBudget({ budget: { max_rounds: 5 } }, { ...baseState, rounds: 3 })
      expect(result).toEqual({ allowed: true })
    })

    test("returns denied when rounds >= max_rounds", () => {
      const result = checkBudget({ budget: { max_rounds: 5 } }, { ...baseState, rounds: 5 })
      expect(result).toEqual({ allowed: false, reason: "Max rounds (5) exceeded" })
    })

    test("returns denied when rounds exceed max_rounds", () => {
      const result = checkBudget({ budget: { max_rounds: 5 } }, { ...baseState, rounds: 7 })
      expect(result).toEqual({ allowed: false, reason: "Max rounds (5) exceeded" })
    })
  })

  describe("max_cost_usd", () => {
    test("returns allowed when cost < max", () => {
      const result = checkBudget({ budget: { max_cost_usd: 10 } }, { ...baseState, costUsd: 5 })
      expect(result).toEqual({ allowed: true })
    })

    test("returns denied when cost >= max", () => {
      const result = checkBudget({ budget: { max_cost_usd: 10 } }, { ...baseState, costUsd: 10 })
      expect(result).toEqual({ allowed: false, reason: "Max cost ($10) exceeded" })
    })
  })

  describe("max_duration_minutes", () => {
    test("returns allowed when within duration", () => {
      const result = checkBudget(
        { budget: { max_duration_minutes: 60 } },
        { ...baseState, startTime: Date.now() - 30 * 60 * 1000, lastActiveTime: Date.now() },
      )
      expect(result).toEqual({ allowed: true })
    })

    test("returns denied when duration exceeded", () => {
      const result = checkBudget(
        { budget: { max_duration_minutes: 10 } },
        { ...baseState, startTime: Date.now() - 20 * 60 * 1000, lastActiveTime: Date.now() - 20 * 60 * 1000 },
      )
      expect(result).toEqual({ allowed: false, reason: "Max duration (10min) exceeded" })
    })
  })

  describe("max_sleep_minutes", () => {
    test("returns allowed when lastActiveTime is recent", () => {
      const result = checkBudget(
        { budget: { max_sleep_minutes: 30 } },
        { ...baseState, startTime: Date.now() - 60 * 60 * 1000, lastActiveTime: Date.now() - 5 * 60 * 1000 },
      )
      expect(result).toEqual({ allowed: true })
    })

    test("returns denied when sleep exceeds max", () => {
      const result = checkBudget(
        { budget: { max_sleep_minutes: 10 } },
        { ...baseState, startTime: Date.now() - 60 * 60 * 1000, lastActiveTime: Date.now() - 30 * 60 * 1000 },
      )
      expect(result).toEqual({ allowed: false, reason: "Sleep timeout (10min) exceeded" })
    })

    test("falls back to startTime when lastActiveTime is 0", () => {
      // lastActiveTime 为 0 的场景——使用 startTime 作为回退
      const result = checkBudget(
        { budget: { max_sleep_minutes: 5 } },
        { rounds: 0, costUsd: 0, startTime: Date.now() - 20 * 60 * 1000, lastActiveTime: 0 },
      )
      expect(result).toEqual({ allowed: false, reason: "Sleep timeout (5min) exceeded" })
    })
  })

  describe("multiple constraints", () => {
    test("rounds triggered before duration", () => {
      const result = checkBudget(
        { budget: { max_rounds: 3, max_duration_minutes: 120 } },
        { ...baseState, rounds: 3, startTime: Date.now() - 10 * 60 * 1000, lastActiveTime: Date.now() },
      )
      expect(result).toEqual({ allowed: false, reason: "Max rounds (3) exceeded" })
    })

    test("duration triggered before sleep", () => {
      const result = checkBudget(
        { budget: { max_duration_minutes: 5, max_sleep_minutes: 30 } },
        { ...baseState, startTime: Date.now() - 10 * 60 * 1000, lastActiveTime: Date.now() - 2 * 60 * 1000 },
      )
      expect(result).toEqual({ allowed: false, reason: "Max duration (5min) exceeded" })
    })
  })
})
