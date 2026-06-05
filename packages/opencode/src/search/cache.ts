/**
 * 搜索结果缓存
 *
 * 借鉴 SearXNG 的 ExpireCache 设计，使用内存 Map + TTL 实现。
 * 缓存查询结果，避免短时间内重复搜索相同关键词。
 */
import type { SearchResult } from "./engine"

interface CacheEntry {
  results: readonly SearchResult[]
  expiresAt: number
}

export class ResultCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttl: number // 毫秒

  constructor(maxSize = 100, ttlMs = 60_000) {
    this.maxSize = maxSize
    this.ttl = ttlMs
  }

  /** 生成缓存键（查询 + 结果数） */
  static makeKey(query: string, numResults: number): string {
    return `${query}|${numResults}`
  }

  /** 获取缓存结果，过期条目自动删除 */
  get(key: string): readonly SearchResult[] | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.results
  }

  /** 写入缓存 */
  set(key: string, results: readonly SearchResult[]): void {
    // LRU 驱逐：缓存满时删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { results, expiresAt: Date.now() + this.ttl })
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear()
  }

  /** 当前缓存条目数 */
  get size(): number {
    return this.cache.size
  }
}

/** 全局搜索结果缓存实例 */
export const globalResultCache = new ResultCache(100, 60_000)

export * as SearchCache from "./cache"
