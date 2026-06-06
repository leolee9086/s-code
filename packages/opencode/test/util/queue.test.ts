/**
 * AsyncQueue 和 work 并发工具测试
 */
import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("push before next returns immediately", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    expect(await q.next()).toBe(1)
  })

  test("next waits for push", async () => {
    const q = new AsyncQueue<number>()
    const promise = q.next()
    q.push(42)
    expect(await promise).toBe(42)
  })

  test("handles multiple items in order", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    expect(await q.next()).toBe(1)
    expect(await q.next()).toBe(2)
  })

  test("async iterator yields pushed values", async () => {
    const q = new AsyncQueue<number>()
    q.push(10)
    q.push(20)

    const results: number[] = []
    const iterator = q[Symbol.asyncIterator]()
    const r1 = await iterator.next()
    const r2 = await iterator.next()
    if (r1.value !== undefined) results.push(r1.value)
    if (r2.value !== undefined) results.push(r2.value)

    expect(results).toEqual([10, 20])
  })
})

describe("work", () => {
  test("processes all items with given concurrency", async () => {
    const processed: number[] = []
    const concurrency = 2
    await work(concurrency, [1, 2, 3, 4], async (item) => {
      processed.push(item)
    })
    expect(processed.sort()).toEqual([1, 2, 3, 4])
  })

  test("handles empty items", async () => {
    await work(2, [], async () => { /* noop */ })
  })
})
