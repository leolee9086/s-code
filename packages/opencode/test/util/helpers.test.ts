/**
 * 小工具函数测试（defer、lazy、iife、signal、token、withTimeout）
 */
import { describe, expect, test } from "bun:test"
import { defer } from "../../src/util/defer"
import { lazy } from "../../src/util/lazy"
import { iife } from "../../src/util/iife"
import { signal } from "../../src/util/signal"
import { estimate } from "../../src/util/token"
import { withTimeout } from "../../src/util/timeout"

describe("defer", () => {
  test("calls fn on dispose", () => {
    let called = false
    const d = defer(() => { called = true })
    d[Symbol.dispose]()
    expect(called).toBe(true)
  })

  test("calls fn on asyncDispose", async () => {
    let called = false
    const d = defer(() => { called = true })
    await d[Symbol.asyncDispose]()
    expect(called).toBe(true)
  })
})

describe("lazy", () => {
  test("computes value on first call", () => {
    let count = 0
    const fn = lazy(() => { count++; return 42 })
    expect(fn.loaded()).toBe(false)
    expect(fn()).toBe(42)
    expect(count).toBe(1)
    expect(fn.loaded()).toBe(true)
  })

  test("caches value on subsequent calls", () => {
    let count = 0
    const fn = lazy(() => { count++; return Math.random() })
    const first = fn()
    const second = fn()
    expect(first).toBe(second)
    expect(count).toBe(1)
  })

  test("reset clears cached value", () => {
    let count = 0
    const fn = lazy(() => { count++; return count })
    expect(fn()).toBe(1)
    fn.reset()
    expect(fn.loaded()).toBe(false)
    expect(fn()).toBe(2)
  })
})

describe("iife", () => {
  test("calls function and returns result", () => {
    expect(iife(() => 42)).toBe(42)
    expect(iife(() => "hello")).toBe("hello")
  })
})

describe("signal", () => {
  test("trigger resolves wait promise", async () => {
    const s = signal()
    let resolved = false
    s.wait().then(() => { resolved = true })
    await Promise.resolve() // let the microtask queue run
    expect(resolved).toBe(false)
    s.trigger()
    await Promise.resolve()
    expect(resolved).toBe(true)
  })
})

describe("token estimate", () => {
  test("estimates tokens from text length", () => {
    expect(estimate("")).toBe(0)
    expect(estimate("hello")).toBe(1)  // 5 / 4 = 1.25 → rounded 1
    expect(estimate("hello world")).toBe(3)  // 11 / 4 = 2.75 → rounded 3
    expect(estimate("a".repeat(100))).toBe(25)  // 100 / 4 = 25
  })
})

describe("withTimeout", () => {
  test("resolves when promise resolves before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000)
    expect(result).toBe("ok")
  })

  test("rejects when promise takes too long", async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 50000)), 10)).rejects.toThrow(
      "Operation timed out after 10ms",
    )
  }, 5000)
})
