/**
 * 搜索引擎压力测试基准（干净版）
 * 测试 Effect 内部链路，全部 mock，不需要外部端点。
 * 使用当前 MAX_CONCURRENCY=10 设置。
 */
import { Effect } from "effect"
import { Executor } from "../../src/search/executor"
import { Aggregator } from "../../src/search/aggregator"
import { makeEngineConfig, makeSearchResult } from "../../src/search/engine"
import type { SearchEngine } from "../../src/search/engine"

const ENGINE_COUNTS = [10, 30, 60, 100]
const ITERATIONS = 3

function mockEngine(name: string, latency: number, fail: number): SearchEngine {
  return {
    name, config: makeEngineConfig({ name, weight: 0.7, timeout: 5000, maxResults: 3 }),
    search: () => Effect.gen(function* () {
      if (latency > 0) yield* Effect.sleep(`${latency} millis`)
      if (Math.random() < fail) return yield* Effect.fail(new Error("fail"))
      return [makeSearchResult({ title: `${name}#1`, url: `https://${name}.x/r1`, snippet: "s", engine: name, position: 1 })]
    }),
  }
}

function mockEngines(n: number): SearchEngine[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i % 10
    return mockEngine(`e${i}`, t < 6 ? 50 : t < 9 ? 200 : 500, t < 6 ? 0.05 : t < 9 ? 0.1 : 0.2)
  })
}

async function main() {
  console.log("=== 搜索引擎压力基准 ===")
  console.log(`MAX_CONCURRENCY = ${(Executor as any).MAX_CONCURRENCY ?? 10}`)
  console.log("")

  for (const n of ENGINE_COUNTS) {
    let totalMs = 0, totalOk = 0, totalErr = 0
    for (let i = 0; i < ITERATIONS; i++) {
      const engines = mockEngines(n)
      const state = new Executor.ExecutorState()
      const t0 = performance.now()
      const r = await Effect.scoped(Effect.gen(function* () {
        return yield* Executor.executeAll(engines, null as any, "q", { numResults: 8 }, state)
      })).pipe(Effect.runPromise)
      totalMs += performance.now() - t0
      totalOk += r.results.length
      totalErr += r.errors.length
      process.stdout.write(".")
    }
    const avg = Math.round(totalMs / ITERATIONS)
    const sr = totalOk + totalErr > 0 ? Math.round(totalOk / (totalOk + totalErr) * 100) : 0
    console.log(`  ${String(n).padStart(3)} engines → avg ${avg}ms, success ${sr}%`)
  }
  console.log("\nDone.")
}

main().catch(console.error)
