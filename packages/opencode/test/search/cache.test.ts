import { afterEach, describe, expect, test } from "bun:test"
import { ResultCache } from "../../src/search/cache"
import { makeSearchResult } from "../../src/search/engine"

// ── ResultCache ─────────────────────────────────────

describe("ResultCache", () => {
  let cache: ResultCache

  afterEach(() => {
    cache.clear()
  })

  test("stores and retrieves results", () => {
    cache = new ResultCache(10, 60_000)
    const key = ResultCache.makeKey("test query", 5)
    const results = [
      makeSearchResult({ title: "Test", url: "https://example.com", snippet: "Snippet", engine: "ddg", position: 1 }),
    ]

    cache.set(key, results)
    const retrieved = cache.get(key)
    expect(retrieved).toEqual(results)
  })

  test("returns undefined for missing key", () => {
    cache = new ResultCache(10, 60_000)
    expect(cache.get("nonexistent")).toBeUndefined()
  })

  test("entry set with past TTL is expired on get", () => {
    // Create cache with 0 TTL — expiresAt = Date.now() + 0
    // The entry is considered expired immediately since expiresAt is in the past by the time get() runs
    cache = new ResultCache(10, -1) // negative TTL → expiresAt is before now
    const key = "expired-instantly"
    cache.set(key, [])
    expect(cache.get(key)).toBeUndefined()
  })

  test("makeKey generates consistent keys", () => {
    expect(ResultCache.makeKey("hello", 8)).toBe("hello|8")
    expect(ResultCache.makeKey("hello", 8)).toBe(ResultCache.makeKey("hello", 8))
    expect(ResultCache.makeKey("hello", 5)).not.toBe(ResultCache.makeKey("hello", 8))
    expect(ResultCache.makeKey("foo", 8)).not.toBe(ResultCache.makeKey("bar", 8))
  })

  test("evicts oldest entry when full (LRU)", () => {
    cache = new ResultCache(2, 60_000) // max 2 entries
    cache.set("key1", [{ title: "A", url: "https://a.com", snippet: "", engine: "ddg", position: 1 }])
    cache.set("key2", [{ title: "B", url: "https://b.com", snippet: "", engine: "ddg", position: 1 }])
    cache.set("key3", [{ title: "C", url: "https://c.com", snippet: "", engine: "ddg", position: 1 }])

    expect(cache.get("key1")).toBeUndefined() // evicted
    expect(cache.get("key2")).toBeDefined()
    expect(cache.get("key3")).toBeDefined()
  })

  test("tracks cache size", () => {
    cache = new ResultCache(100, 60_000)
    expect(cache.size).toBe(0)
    cache.set("k1", [])
    expect(cache.size).toBe(1)
    cache.set("k2", [])
    expect(cache.size).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  test("clear removes all entries", () => {
    cache = new ResultCache(100, 60_000)
    cache.set("k1", [])
    cache.set("k2", [])
    cache.set("k3", [])
    expect(cache.size).toBe(3)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get("k1")).toBeUndefined()
  })
})
