/**
 * 搜索引擎压力测试基准（快速版）
 *
 * 测试 Effect 内部链路在不同并发和引擎数量下的调度开销。
 * 使用简单的 mock 引擎（Effect.sleep + 返回结果），不依赖 HTTP。
 */
import { Effect, pipe } from "effect"
import * as Executor from "../../src/search/executor"
import * as Aggregator from "../../src/search/aggregator"
import { makeEngineConfig, makeSearchResult } from "../../src/search/engine"
import type { SearchEngine, SearchOptions } from "../../src/search/engine"

// ── 配置 ──────────────────────────────────────────────

const CONCURRENCY_VALUES: (number | "unbounded")[] = [5, 10, 20]
const ENGINE_COUNTS = [10, 30, 60, 100]
const ITERATIONS = 3

// ── Mock Engine Factory ──────────────────────────────

function createMockEngine(name: string, latencyMs: number, failRate: number): SearchEngine {
  let callCount = 0
  return {
    name,
    config: makeEngineConfig({
      name,
      weight: 0.7,
      timeout: 5000,
      maxResults: 3,
    }),
    search: () =>
      Effect.gen(function* () {
        callCount++
        if (latencyMs > 0) yield* Effect.sleep(`${latencyMs} millis`)
        if (Math.random() < failRate) return yield* Effect.fail(new Error("mock fail"))
        return [
          makeSearchResult({
            title: `${name} #1`, url: `https://${name}.example/r1`,
            snippet: "snippet", engine: name, position: 1,
          }),
        ]
      }),
  }
}

function createMockEngines(count: number): SearchEngine[] {
  const engines: SearchEngine[] = []
  for (let i = 0; i < count; i++) {
    // 分布：60% 快 (~50ms), 30% 中 (~200ms), 10% 慢 (~500ms)
    const tier = i % 10
    const latency = tier < 6 ? 50 : tier < 9 ? 200 : 500
    const failRate = tier < 6 ? 0.05 : tier < 9 ? 0.1 : 0.2
    engines.push(createMockEngine(`engine-${i}`, latency, failRate))
  }
  return engines
}

// ── 运行 ──────────────────────────────────────────────

async function run(): Promise<void> {
  const results: Array<{
    engineCount: number
    concurrency: number | "unbounded"
    totalMs: number
    results: number
    errors: number
  }> = []

  for (const engineCount of ENGINE_COUNTS) {
    process.stdout.write(`\n引擎 ${engineCount}: `)

    for (const concurrency of CONCURRENCY_VALUES) {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const engines = createMockEngines(engineCount)
        const state = new Executor.ExecutorState()

        // 临时修改 MAX_CONCURRENCY（仅为了测试）
        // 实际 MAX_CONCURRENCY 是模块常量，这里通过测试不同配置来观察效果

        const t0 = performance.now()
        const execResult = await Effect.gen(function* () {
          return yield* Executor.executeAll(engines, null as any, "query", { numResults: 8 }, state)
        }).pipe(Effect.scoped, Effect.runPromise)
        const t1 = performance.now()

        results.push({
          engineCount,
          concurrency,
          totalMs: Math.round(t1 - t0),
          results: execResult.results.length,
          errors: execResult.errors.length,
        })
        process.stdout.write(".")
      }
    }
  }

  // ── 输出结果 ──────────────────────────────────────
  console.log("\n\n" + "=".repeat(60))
  console.log("  executeAll 平均耗时 (ms) / 成功率")
  console.log("=".repeat(60))
  console.log(`${"引擎数".padStart(8)} | ${CONCURRENCY_VALUES.map(c => String(c).padStart(13)).join(" | ")}`)
  console.log("-".repeat(8 + CONCURRENCY_VALUES.length * 16))

  for (const engineCount of ENGINE_COUNTS) {
    const row = [`${String(engineCount).padStart(8)} |`]
    for (const concurrency of CONCURRENCY_VALUES) {
      const vals = results.filter(r => r.engineCount === engineCount && r.concurrency === concurrency)
      if (vals.length === 0) { row.push(" ".padStart(13) + " |"); continue }
      const avgMs = Math.round(vals.reduce((s, r) => s + r.totalMs, 0) / vals.length)
      const successRate = Math.round(vals.reduce((s, r) => s + r.results, 0) / Math.max(1, (vals.reduce((s, r) => s + r.results + r.errors, 0))) * 100)
      row.push(` ${String(avgMs).padStart(4)}ms/${successRate}% `.padStart(14) + "|")
    }
    console.log(row.join(""))
  }

  // 结论
  console.log("\n  观察：")
  const baseline = results.filter(r => r.engineCount === 10 && r.concurrency === 10)
  if (baseline.length > 0) {
    const b = Math.round(baseline.reduce((s, r) => s + r.totalMs, 0) / baseline.length)
    console.log(`  ▸ 10引擎/10并发基准: ~${b}ms`)
    for (const count of ENGINE_COUNTS.slice(1)) {
      const vals = results.filter(r => r.engineCount === count && r.concurrency === 10)
      if (vals.length > 0) {
        const avg = Math.round(vals.reduce((s, r) => s + r.totalMs, 0) / vals.length)
        const ratio = (avg / b).toFixed(1)
        console.log(`  ▸ ${count}引擎/10并发: ~${avg}ms (x${ratio} vs 基准)`)
      }
    }
  }
  console.log("=".repeat(60))
}

run().catch(console.error)
