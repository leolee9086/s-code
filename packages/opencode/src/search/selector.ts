/**
 * 搜索引擎选择器
 * 根据环境配置选择可用引擎
 * 借鉴 SearXNG 的引擎选择逻辑：按优先级和可用性动态选择
 */
import { Duration } from "effect"
import { makeEngineConfig } from "./engine"
import type { SearchEngine } from "./engine"
import { makeDuckDuckGo } from "./engines/duckduckgo"
import { makeBrave } from "./engines/brave"
import { makeSiteScopedEngine } from "./engines/site-scoped"

export interface SelectFlags {
  exa?: boolean
  parallel?: boolean
  brave?: boolean
  xiaohongshu?: boolean
  zhihu?: boolean
  /** 查询类型提示，用于智能选择相关引擎 */
  queryType?: "general" | "code" | "news" | "academic" | "social"
  /** 优先返回最新结果 */
  timeRange?: "day" | "week" | "month" | "year"
  /** 语言偏好 */
  lang?: string
}

export function selectEngines(
  flags?: SelectFlags,
): SearchEngine[] {
  const engines: SearchEngine[] = []

  // DuckDuckGo 始终可用（免费、零配置）
  engines.push(makeDuckDuckGo(makeEngineConfig({
    name: "duckduckgo",
    weight: 1.0,
    timeout: Duration.toMillis(Duration.seconds(15)),
    maxResults: 8,
  })))

  // Brave Search — 有 API key 时使用认证调用提高额度
  // Brave 免费版无需 API key 即可使用（每月 2000 次查询）
  const hasBraveKey = !!process.env.BRAVE_API_KEY
  if (flags?.brave || hasBraveKey || !flags) {
    engines.push(makeBrave(makeEngineConfig({
      name: "brave",
      weight: 1.2,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 8,
      priority: 1,
      requiresKey: false,
    })))
  }

  // 小红书 — 通过 DuckDuckGo site:xiohongshu.com 搜索
  // 无需 API key，自动并行搜索，结果经聚合器去重合并
  if (flags?.xiaohongshu || !flags) {
    engines.push(makeSiteScopedEngine("xiaohongshu.com", "xiaohongshu", makeEngineConfig({
      name: "xiaohongshu",
      weight: 0.8,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
    })))
  }

  // 知乎 — 通过 DuckDuckGo site:zhihu.com 搜索
  if (flags?.zhihu || !flags) {
    engines.push(makeSiteScopedEngine("zhihu.com", "zhihu", makeEngineConfig({
      name: "zhihu",
      weight: 0.8,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
    })))
  }

  // 根据查询类型动态调整引擎配置
  // 新闻类查询：启用更大的 maxResults
  if (flags?.queryType === "news") {
    for (const e of engines) {
      // @ts-ignore - 运行时调整 maxResults
      e.config.maxResults = Math.max(e.config.maxResults, 10)
    }
  }

  return engines
}

export function engineSummary(engines: SearchEngine[]): string {
  const names = engines.map((e) => `${e.name}(weight=${e.config.weight})`)
  return `已启用引擎: ${names.join(", ")}`
}

export * as Selector from "./selector"
