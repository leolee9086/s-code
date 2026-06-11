import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Search } from "@/search"
import { getGlobalRateLimiter } from "@/search/rate-limiter"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "网络搜索查询词" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "返回的搜索结果数量（默认 8）",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "实时爬取模式 - 'fallback'：缓存内容不可用时作为后备使用实时爬取，'preferred'：优先实时爬取（默认 'fallback'）",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "搜索类型 - 'auto'：均衡搜索（默认），'fast'：快速结果，'deep'：深度搜索",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "为 LLM 优化的上下文字符数上限（默认 10000）",
  }),
  timeRange: Schema.optional(Schema.Literals(["day", "week", "month", "year"])).annotate({
    description: "时间范围过滤：'day'（一天内）、'week'（一周内）、'month'（一月内）、'year'（一年内）",
  }),
  lang: Schema.optional(Schema.String).annotate({
    description: "语言偏好（如 'zh-CN'、'en'、'ja'），用于获取特定语言的结果",
  }),
  queryType: Schema.optional(Schema.Literals(["general", "news", "video", "academic", "code", "shopping"])).annotate({
    description: "查询类型 - 'general'（默认，通用搜索）、'news'（新闻搜索，启用新闻和微信引擎）、'video'（视频搜索，启用 Bilibili 引擎）、'academic'（学术搜索，启用 Arxiv/Semantic Scholar/Wikipedia）、'code'（代码搜索，启用 GitHub）、'shopping'（购物比价，启用 SMZDM/京东/淘宝等引擎）",
  }),
  platforms: Schema.optional(Schema.String).annotate({
    description: "（仅 queryType='shopping' 时生效）指定购物平台，逗号分隔。可选值: smzdm, jd, taobao, tmall, pdd, suning, gome, vip, 1688, dangdang, kaola, amazon-cn, amazon-us, ebay。示例: 'jd,taobao,pdd'",
  }),
})

/** 格式化速率限制器状态文本（供元数据使用） */
function formatRateLimiterStatus(): string | undefined {
  const status = getGlobalRateLimiter().getStatus()
  const entries = Object.entries(status)
  if (entries.length === 0) return undefined
  return entries.map(([e, s]) => `${e}:${Math.round(s.lastCallAgo / 1000)}s前/间隔${s.interval}ms`).join(" ")
}

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel", "duckduckgo"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

/** 检查提供商是否有实际可用的 API key */
function providerAvailable(provider: WebSearchProvider): boolean {
  if (provider === "parallel") return !!process.env.PARALLEL_API_KEY
  if (provider === "exa") return !!process.env.EXA_API_KEY
  if (provider === "duckduckgo") return true // DuckDuckGo 无需 API key，始终可用
  return false
}

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel" || override === "duckduckgo") return override

  // 显式启用标志优先：即使没有 API key，也优先使用指定提供商（availability 由 providerAvailable 检查）
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  // 默认使用 DuckDuckGo（免费、零配置），将触发多引擎聚合模式
  return "duckduckgo"
}

export function webSearchProviderLabel(provider: unknown) {
  if (typeof provider === "string" && provider.includes("+")) {
    return `多引擎搜索 (${provider})`
  }
  if (provider === "parallel") return "Parallel 网络搜索"
  if (provider === "exa") return "Exa 网络搜索"
  if (provider === "duckduckgo") return "DuckDuckGo 网络搜索"
  return "网络搜索"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

function parallelAuthHeaders() {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

/**
 * 多引擎搜索模式
 *
 * 借鉴 SearXNG 的元搜索引擎架构：
 * 1. 结果缓存命中直接返回（避免重复搜索相同关键词）
 * 2. 并发执行多个搜索引擎
 * 3. 结果去重合并（URL 规范化 + 标题相似度）
 * 4. 加权评分（位置 × 引擎权重）
 * 5. 域名多样性保证
 * 6. 引擎健康状态跨调用持久化（熔断器）
 */
function callMultiEngine(
  http: HttpClient.HttpClient,
  params: Schema.Schema.Type<typeof Parameters>,
  flags: { exa: boolean; parallel: boolean },
): Effect.Effect<{ output: string | undefined; engines: readonly string[]; engineStatus?: string; rateLimitInfo?: string }> {
  return Effect.gen(function* () {
    // 自动检测查询意图（覆盖 queryType），用户显式指定的优先
    const intent = Search.QueryIntent.detectQueryIntent(params.query ?? "")
    const effectiveQueryType = params.queryType || intent.queryType || "general"

    const engines = Search.Selector.selectEngines({
      brave: !!process.env.BRAVE_API_KEY,
      bilibili: true,
      exa: flags.exa,
      parallel: flags.parallel,
      timeRange: params.timeRange,
      lang: params.lang,
      queryType: effectiveQueryType,
    })
    if (engines.length === 0) return { output: undefined, engines: [] }

    // 如果指定了 platforms 参数，只保留匹配的购物引擎
    const shoppingEngines = new Set([
      "smzdm", "jd", "taobao", "tmall", "pdd", "suning", "gome",
      "vip", "1688", "dangdang", "kaola", "amazon-cn", "amazon-us", "ebay",
    ])
    const selectedPlatforms = params.platforms
      ?.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean)
    const filteredEngines = (selectedPlatforms && selectedPlatforms.length > 0 && effectiveQueryType === "shopping")
      ? engines.filter((e) => !shoppingEngines.has(e.name) || selectedPlatforms.includes(e.name))
      : engines
    if (filteredEngines.length === 0) return { output: undefined, engines: [] }

    const numResults = params.numResults || 8
    const cacheKey = Search.Cache.ResultCache.makeKey(`${params.query}|t:${params.timeRange ?? "any"}|l:${params.lang ?? "any"}|q:${effectiveQueryType}`, { numResults })

    // 检查缓存（内存热层 → SQLite 冷层 → 搜索引擎）
    const cached = Search.PersistentCache.getWithFallback(cacheKey, Search.Cache.globalResultCache, Search.PersistentCache.persistentCache)
    if (cached && cached.length > 0) {
      const engineNames = [...new Set(cached.map(r => r.engine))]
      const aggregated = Search.Aggregator.aggregate(cached, {
        weights: new Map(filteredEngines.map(e => [e.name, e.config.weight])),
        maxResults: numResults,
      }, params.query)
      const output = effectiveQueryType === "shopping" && aggregated.some(r => r.category === "shopping")
        ? Search.PriceCompare.formatShoppingReport(aggregated, params.query)
        : Search.Aggregator.formatResults(aggregated, params.query)
      return { output, engines: engineNames }
    }

    // 使用全局引擎健康状态（跨调用持久化）
    const state = Search.Executor.getGlobalState()
    const opts = Search.Engine.makeSearchOptions({
      numResults,
      timeRange: params.timeRange,
      lang: params.lang,
    })
    const execResult = yield* Search.Executor.executeAll(filteredEngines, http, params.query, opts, state)

    // 缓存成功结果（写入内存 + SQLite 双层）
    if (execResult.results.length > 0) {
      Search.PersistentCache.setWithFallback(cacheKey, execResult.results, Search.Cache.globalResultCache, Search.PersistentCache.persistentCache)
    }

    const weights = new Map(filteredEngines.map(e => [e.name, e.config.weight]))
    const aggregated = Search.Aggregator.aggregate(execResult.results, {
      weights,
      maxResults: numResults,
    }, params.query)

    const engineNames = [...new Set(execResult.results.map(r => r.engine))]
    const output = aggregated.length > 0
      ? (effectiveQueryType === "shopping" && aggregated.some(r => r.category === "shopping")
        ? Search.PriceCompare.formatShoppingReport(aggregated, params.query)
        : Search.Aggregator.formatResults(aggregated, params.query))
      : undefined

    // 生成引擎健康状态报告（用于调试）
    const engineStatus = Search.Aggregator.formatEngineStatusReport(state.engineStatuses)

    // 速率限制器状态
    const rateLimitInfo = formatRateLimiterStatus()

    return { output, engines: engineNames, engineStatus, rateLimitInfo }
  })
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
): Effect.Effect<{ output: string | undefined; engines: readonly string[]; metadata?: Record<string, unknown> }> {
  if (provider === "duckduckgo") {
    // DuckDuckGo → 多引擎聚合模式（DuckDuckGo + Brave 等并行搜索）
    return Effect.gen(function* () {
      const result = yield* callMultiEngine(http, params, { exa: false, parallel: false })
      return {
        output: result.output,
        engines: result.engines,
        metadata: {
          ...(result.engineStatus ? { engineStatus: result.engineStatus } : {}),
          ...(result.rateLimitInfo ? { rateLimitInfo: result.rateLimitInfo } : {}),
        },
      }
    })
  }

  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.query,
        search_queries: [params.query],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    ).pipe(
      Effect.map((output) => ({ output, engines: ["parallel"] as readonly string[] })),
      Effect.catch((err: unknown) =>
        Effect.succeed({
          output: `Parallel 搜索失败: ${err instanceof Error ? err.message : String(err)}`,
          engines: [] as readonly string[],
        }),
      ),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  ).pipe(
    Effect.map((output) => ({ output, engines: ["exa"] as readonly string[] })),
    Effect.catch((err: unknown) =>
      Effect.succeed({
        output: `Exa 搜索失败: ${err instanceof Error ? err.message : String(err)}`,
        engines: [] as readonly string[],
      }),
    ),
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          const title = webSearchProviderLabel(provider)
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider } })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              queryType: params.queryType,
              provider,
            },
          })

          if (!providerAvailable(provider)) {
            return {
              output: `网络搜索 (${provider}) 不可用。请配置环境变量或使用 webfetch 工具直接获取指定 URL 的内容。`,
              title: "网络搜索不可用",
              metadata: { provider, available: false, engines: [] as readonly string[] },
            }
          }

          const result = yield* callProvider(http, provider, params, ctx).pipe(
            Effect.catch((err: unknown) =>
              Effect.succeed({
                output: `搜索请求失败: ${err instanceof Error ? err.message : String(err)}。请检查网络连接后重试。`,
                engines: [] as readonly string[],
                metadata: {} as Record<string, unknown>,
              }),
            ),
          )

          return {
            output: result.output ?? "未找到搜索结果。请尝试其他查询词。",
            title: `${title}: ${params.query}`,
            metadata: { provider, available: true, engines: result.engines, ...(result.metadata ?? {}) },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
