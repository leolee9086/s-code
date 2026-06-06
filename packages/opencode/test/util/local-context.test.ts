/**
 * LocalContext 工具测试
 */
import { describe, expect, test } from "bun:test"
import { create, NotFound } from "../../src/util/local-context"

describe("LocalContext", () => {
  test("provide sets value and use retrieves it", () => {
    const ctx = create<string>("test")
    ctx.provide("hello", () => {
      expect(ctx.use()).toBe("hello")
    })
  })

  test("use throws NotFound outside provide", () => {
    const ctx = create<string>("test-outside")
    expect(() => ctx.use()).toThrow(NotFound)
  })

  test("use throws with correct name in error", () => {
    const ctx = create<string>("my-context")
    try {
      ctx.use()
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(NotFound)
      expect((e as NotFound).name).toBe("my-context")
    }
  })

  test("nested provide overrides value", () => {
    const ctx = create<string>("nested")
    ctx.provide("outer", () => {
      expect(ctx.use()).toBe("outer")
      ctx.provide("inner", () => {
        expect(ctx.use()).toBe("inner")
      })
      expect(ctx.use()).toBe("outer")
    })
  })

  test("async provide works across microtasks", async () => {
    const ctx = create<string>("async")
    const result = await ctx.provide("async-value", async () => {
      await Promise.resolve()
      return ctx.use()
    })
    expect(result).toBe("async-value")
  })
})
