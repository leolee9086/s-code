/**
 * 持久化缓存层（SQLite 后端）
 *
 * 作为内存缓存（ResultCache）的第二级冷层，进程重启不丢失。
 * 用于缓存搜索引擎结果，减少重复执行相同查询。
 *
 * 层级结构：
 *   ResultCache（热层，秒级 TTL）→ PersistentCache（冷层，分级 TTL）→ 搜索引擎
 */
import { Database } from "bun:sqlite"
import type { SearchResult } from "./engine"
import { makeSearchResult } from "./engine"
import { globalResultCache } from "./cache"

// ── Schema ────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS search_cache (
  key      TEXT PRIMARY KEY,
  results  TEXT NOT NULL,         -- JSON 序列化的 SearchResult[]
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_search_cache_expires
  ON search_cache(expires_at);
`

const CLEANUP_QUERY = `DELETE FROM search_cache WHERE expires_at < unixepoch()`

// ── 持久化缓存 ────────────────────────────────────────

export class PersistentCacheStore {
  private db: Database
  private ttlMs: number
  private maxEntries: number
  private insertStmt: ReturnType<Database["prepare"]>
  private getStmt: ReturnType<Database["prepare"]>
  private deleteStmt: ReturnType<Database["prepare"]>
  private countStmt: ReturnType<Database["prepare"]>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  /** 缓存统计 */
  hits = 0
  misses = 0

  constructor(dbPath: string, ttlMs = 300_000, maxEntries = 500) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.db = new Database(dbPath)
    this.db.exec(SCHEMA)

    // 预编译 SQL 语句
    this.insertStmt = this.db.prepare(
      "INSERT OR REPLACE INTO search_cache (key, results, expires_at) VALUES ($key, $results, $expires_at)",
    )
    this.getStmt = this.db.prepare(
      "SELECT results FROM search_cache WHERE key = $key AND expires_at > unixepoch()",
    )
    this.deleteStmt = this.db.prepare(
      "DELETE FROM search_cache WHERE key = $key",
    )
    this.countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM search_cache",
    )

    // 启动定期清理（每分钟清理过期条目）
    this.cleanupTimer = setInterval(() => {
      try { this.db.run(CLEANUP_QUERY) } catch {}
    }, 60_000)

    // 启动时清理一次
    try { this.db.run(CLEANUP_QUERY) } catch {}
  }

  /** 获取缓存结果 */
  get(key: string): readonly SearchResult[] | undefined {
    const row = this.getStmt.get({ $key: key }) as { results: string } | undefined
    if (!row) {
      this.misses++
      return undefined
    }
    this.hits++
    return deserializeResults(row.results)
  }

  /** 写入缓存 */
  set(key: string, results: readonly SearchResult[]): void {
    const expiresAt = Math.floor((Date.now() + this.ttlMs) / 1000)

    // LRU 驱逐：超过上限时删除最旧的条目
    this.enforceMaxEntries()

    this.insertStmt.run({
      $key: key,
      $results: serializeResults(results),
      $expires_at: expiresAt,
    })
  }

  /** 删除条目 */
  delete(key: string): void {
    this.deleteStmt.run({ $key: key })
  }

  /** 清空全部缓存 */
  clear(): void {
    this.db.exec("DELETE FROM search_cache")
    this.hits = 0
    this.misses = 0
  }

  /** 当前条目数 */
  get size(): number {
    const row = this.countStmt.get() as { count: number }
    return row?.count ?? 0
  }

  /** 命中率 */
  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.db.close()
  }

  private enforceMaxEntries(): void {
    const row = this.countStmt.get() as { count: number }
    if (row && row.count >= this.maxEntries) {
      // 删除最早的 10% 条目
      this.db.run(
        `DELETE FROM search_cache WHERE rowid IN (
          SELECT rowid FROM search_cache ORDER BY created_at ASC LIMIT ?
        )`,
        [Math.max(10, Math.floor(this.maxEntries * 0.1))],
      )
    }
  }
}

// ── 序列化工具 ────────────────────────────────────────

function serializeResults(results: readonly SearchResult[]): string {
  return JSON.stringify(results.map((r) => ({
    t: r.title,
    u: r.url,
    s: r.snippet,
    e: r.engine,
    p: r.position,
    d: r.publishedDate,
    c: r.category,
    sg: r.suggestion,
  })))
}

function deserializeResults(raw: string): SearchResult[] {
  try {
    const data = JSON.parse(raw) as Array<{
      t: string; u: string; s: string; e: string; p: number
      d?: number; c?: string; sg?: string
    }>
    return data.map((item) =>
      makeSearchResult({
        title: item.t,
        url: item.u,
        snippet: item.s,
        engine: item.e,
        position: item.p,
        publishedDate: item.d,
        category: item.c,
        suggestion: item.sg,
      }),
    )
  } catch {
    return []
  }
}

// ── 集成：双层缓存查询 ────────────────────────────────

let _persistentCache: PersistentCacheStore | null = null

/**
 * 初始化持久化缓存（在应用启动时调用）
 * 缓存文件放在 OS 临时目录，进程重启后仍在
 */
export function initPersistentCache(dbPath?: string): PersistentCacheStore {
  if (_persistentCache) return _persistentCache
  const path = dbPath || `${process.env.TEMP || "/tmp"}/opencode-search-cache.sqlite`
  _persistentCache = new PersistentCacheStore(path)
  return _persistentCache
}

/** 全局持久化缓存实例（懒初始化） */
export function getPersistentCache(): PersistentCacheStore {
  if (!_persistentCache) initPersistentCache()
  return _persistentCache!
}

/** 全局持久化缓存引用，供 getWithFallback/setWithFallback 使用 */
export const persistentCache: PersistentCacheStore | undefined =
  typeof process !== "undefined" && process.env.NODE_ENV !== "test"
    ? (initPersistentCache(), _persistentCache!)
    : undefined

/**
 * 双层缓存查询（内存 → SQLite）
 *
 * 调用方式：
 *   1. 先查内存缓存（热层）
 *   2. 未命中则查 SQLite（冷层）
 *   3. 均未命中则执行引擎
 *   4. 结果同时写入两层
 */
export function getWithFallback(
  key: string,
  memoryCache: typeof globalResultCache,
  persistentCache?: PersistentCacheStore,
): readonly SearchResult[] | undefined {
  // 1. 查热层
  const hot = memoryCache.get(key)
  if (hot) return hot

  // 2. 查冷层
  if (persistentCache) {
    const cold = persistentCache.get(key)
    if (cold) {
      // 回填热层
      memoryCache.set(key, cold)
      return cold
    }
  }

  return undefined
}

export function setWithFallback(
  key: string,
  results: readonly SearchResult[],
  memoryCache: typeof globalResultCache,
  persistentCache?: PersistentCacheStore,
): void {
  memoryCache.set(key, results)
  if (persistentCache) persistentCache.set(key, results)
}

export * as PersistentCache from "./persistent-cache"
