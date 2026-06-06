/**
 * 持久化缓存测试
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { PersistentCacheStore } from "../../src/search/persistent-cache"
import { makeSearchResult } from "../../src/search/engine"
import { unlinkSync, existsSync } from "fs"
import { join } from "path"

const TEST_DB = join(import.meta.dir, "../../.test-cache.sqlite")

describe("PersistentCacheStore", () => {
  let cache: PersistentCacheStore

  beforeAll(() => {
    // 清理之前的测试数据库
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    cache = new PersistentCacheStore(TEST_DB, 60_000)
  })

  afterAll(() => {
    try { cache.close() } catch {}
    try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) } catch {}
  })

  test("stores and retrieves results", () => {
    const key = "test-key"
    const results = [
      makeSearchResult({ title: "Test", url: "https://example.com", snippet: "Snippet", engine: "ddg", position: 1 }),
    ]
    cache.set(key, results)
    const retrieved = cache.get(key)
    expect(retrieved).toBeDefined()
    expect(retrieved!.length).toBe(1)
    expect(retrieved![0].title).toBe("Test")
    expect(retrieved![0].url).toBe("https://example.com")
  })

  test("returns undefined for missing key", () => {
    expect(cache.get("nonexistent")).toBeUndefined()
  })

  test("handles empty results array", () => {
    cache.set("empty", [])
    const retrieved = cache.get("empty")
    expect(retrieved).toBeDefined()
    expect(retrieved!.length).toBe(0)
  })

  test("deletes entries", () => {
    cache.set("delete-me", [
      makeSearchResult({ title: "Delete Test", url: "https://ex.com", snippet: "", engine: "test", position: 1 }),
    ])
    expect(cache.get("delete-me")).toBeDefined()
    cache.delete("delete-me")
    expect(cache.get("delete-me")).toBeUndefined()
  })

  test("persists across instances", () => {
    cache.set("persist-test", [
      makeSearchResult({ title: "Persist", url: "https://ex.com", snippet: "", engine: "test", position: 1 }),
    ])
    cache.close()

    // 打开新实例读取
    const cache2 = new PersistentCacheStore(TEST_DB, 60_000)
    const retrieved = cache2.get("persist-test")
    expect(retrieved).toBeDefined()
    expect(retrieved![0].title).toBe("Persist")
    cache2.close()
  })

  test("tracks hit and miss counts", () => {
    const c = new PersistentCacheStore(`:memory:`, 60_000)
    expect(c.hits).toBe(0)
    expect(c.misses).toBe(0)

    c.get("no-exist")
    expect(c.misses).toBe(1)

    c.set("exists", [makeSearchResult({ title: "A", url: "https://a.com", snippet: "", engine: "t", position: 1 })])
    c.get("exists")
    expect(c.hits).toBe(1)
    expect(c.misses).toBe(1)

    c.close()
  })

  test("clear removes all entries", () => {
    const c = new PersistentCacheStore(`:memory:`, 60_000)
    c.set("k1", [makeSearchResult({ title: "A", url: "https://a.com", snippet: "", engine: "t", position: 1 })])
    c.set("k2", [makeSearchResult({ title: "B", url: "https://b.com", snippet: "", engine: "t", position: 1 })])
    expect(c.size).toBe(2)
    c.clear()
    expect(c.size).toBe(0)
    expect(c.get("k1")).toBeUndefined()
    c.close()
  })
})
