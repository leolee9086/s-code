/**
 * 并发搜索执行器
 *
 * 每个引擎在独立 Effect 中运行，使用 Effect.forEach 的 concurrency 实现并行。
 * 借鉴 SearXNG 的多线程并发 + 熔断器模式。
 */
import { Duration, Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import type { EngineStatus, SearchEngine, SearchOptions, SearchResult } from "./engine"
import { EngineError, makeEngineStatus } from "./engine"

/** 执行器状态（可变，追踪引擎健康） */
export class ExecutorState {
  readonly engineStatuses = new Map<string, EngineStatus>()
}

/** 全局引擎健康状态（跨工具调用持久化）
 * 借鉴 SearXNG 的引擎暂停机制：连续失败后自动暂停，暂停时间指数增长。
 * 模块级单例确保引擎健康在多次搜索间持续追踪。
 */
const globalEngineStatuses = new Map<string, EngineStatus>()

/** 获取全局引擎健康状态，供生产流程使用 */
export function getGlobalState(): ExecutorState {
  return { engineStatuses: globalEngineStatuses }
}

/** 重置全局引擎健康状态（仅测试用） */
export function resetGlobalState(): void {
  globalEngineStatuses.clear()
}

export interface ExecuteResult {
  results: readonly SearchResult[]
  errors: readonly EngineError[]
}

type EngineOutcome =
  | { _tag: "success"; results: readonly SearchResult[] }
  | { _tag: "error"; error: EngineError }

/**
 * 并发执行多个搜索引擎
 *
 * 引擎健康检查（熔断器）：
 * - 连续失败 3 次 → 暂停 5 分钟
 * - 超时引擎自动跳过
 * - 错误不会级联到其他引擎
 */
export function executeAll(
  engines: readonly SearchEngine[],
  http: HttpClient.HttpClient,
  query: string,
  opts: SearchOptions,
  state: ExecutorState,
): Effect.Effect<ExecuteResult, never, never> {
  return Effect.gen(function* () {
    // 过滤暂停中的引擎（熔断器恢复检测）
    const active = engines.filter((e) => {
      const status = state.engineStatuses.get(e.name)
      if (!status?.suspended) return true
      if (status.suspendedUntil && Date.now() > status.suspendedUntil) {
        status.suspended = false
        status.consecutiveFailures = 0
        return true
      }
      return false
    })

    if (active.length === 0) return { results: [], errors: [] }

    const outcomes = yield* Effect.forEach(
      active,
      (engine) => executeEngineSafely(engine, http, query, opts, state),
      { concurrency: "unbounded" },
    )

    const allResults: SearchResult[] = []
    const allErrors: EngineError[] = []
    for (const o of outcomes) {
      if (o._tag === "success") allResults.push(...o.results)
      else allErrors.push(o.error)
    }

    return { results: allResults, errors: allErrors }
  })
}

/**
 * 安全地执行单个引擎搜索，捕获所有错误和缺陷
 *
 * 使用 Effect.gen + try/catch 模式：
 * - 引擎只执行一次，成功则重置健康状态
 * - 任何错误或缺陷都记入引擎健康状态（熔断器计数）
 * - 错误不会传播到外部，始终返回 EngineOutcome
 */
function executeEngineSafely(
  engine: SearchEngine,
  http: HttpClient.HttpClient,
  query: string,
  opts: SearchOptions,
  state: ExecutorState,
): Effect.Effect<EngineOutcome, never, never> {
  return (Effect.gen(function* () {
    const results = yield* engine.search(http, query, opts).pipe(
      Effect.timeout(engine.config.timeout),
    )
    const status = getOrCreateStatus(state, engine.name)
    status.consecutiveFailures = 0
    return { _tag: "success", results } as EngineOutcome
  }) as Effect.Effect<EngineOutcome, unknown, never>).pipe(
    Effect.catch((error) => {
      const msg = error instanceof Error ? error.message : String(error)
      const engineErr = new EngineError({ engine: engine.name, message: msg, retryable: true })
      updateEngineStatus(state, engine.name, engineErr)
      return Effect.succeed<EngineOutcome>({ _tag: "error", error: engineErr })
    }),
    Effect.catchDefect((defect) => {
      const engineErr = new EngineError({ engine: engine.name, message: String(defect), retryable: false })
      updateEngineStatus(state, engine.name, engineErr)
      return Effect.succeed<EngineOutcome>({ _tag: "error", error: engineErr })
    }),
  )
}

function getOrCreateStatus(state: ExecutorState, name: string): EngineStatus {
  let status = state.engineStatuses.get(name)
  if (!status) {
    status = makeEngineStatus()
    state.engineStatuses.set(name, status)
  }
  return status
}

function updateEngineStatus(state: ExecutorState, engineName: string, _err: EngineError): void {
  const status = getOrCreateStatus(state, engineName)
  status.consecutiveFailures++
  status.lastError = _err.message
  if (status.consecutiveFailures >= 3) {
    status.suspended = true
    status.suspendedUntil = Date.now() + Duration.toMillis(Duration.minutes(5))
  }
}

export * as Executor from "./executor"
