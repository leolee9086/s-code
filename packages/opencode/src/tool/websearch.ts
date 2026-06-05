import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Search } from "@/search"

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
})

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
): Effect.Effect<{ output: string | undefined; engines: readonly string[] }> {
  return Effect.gen(function* () {
    const engines = Search.Selector.selectEngines({
      brave: !!process.env.BRAVE_API_KEY,
      xiaohongshu: true,
      zhihu: true,
      exa: flags.exa,
      parallel: flags.parallel,
    })
    if (engines.length === 0) return { output: undefined, engines: [] }

    const numResults = params.numResults || 8
    const cacheKey = Search.Cache.ResultCache.makeKey(params.query, numResults)

    // 检查缓存
    const cached = Search.Cache.globalResultCache.get(cacheKey)
    if (cached && cached.length > 0) {
      const engineNames = [...new Set(cached.map(r => r.engine))]
      const aggregated = Search.Aggregator.aggregate(cached, {
        weights: new Map(engines.map(e => [e.name, e.config.weight])),
        maxResults: numResults,
      })
      const output = Search.Aggregator.formatResults(aggregated, params.query)
      return { output, engines: engineNames }
    }

    // 使用全局引擎健康状态（跨调用持久化）
    const state = Search.Executor.getGlobalState()
    const opts = Search.Engine.makeSearchOptions({ numResults })
    const execResult = yield* Search.Executor.executeAll(engines, http, params.query, opts, state)

    // 缓存成功结果
    if (execResult.results.length > 0) {
      Search.Cache.globalResultCache.set(cacheKey, execResult.results)
    }

    const weights = new Map(engines.map(e => [e.name, e.config.weight]))
    const aggregated = Search.Aggregator.aggregate(execResult.results, {
      weights,
      maxResults: numResults,
    })

    const engineNames = [...new Set(execResult.results.map(r => r.engine))]
    const output = aggregated.length > 0
      ? Search.Aggregator.formatResults(aggregated, params.query)
      : undefined

    return { output, engines: engineNames }
  })
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "duckduckgo") {
    // DuckDuckGo → 多引擎聚合模式（DuckDuckGo + Brave 等并行搜索）
    return Effect.gen(function* () {
      const result = yield* callMultiEngine(http, params, { exa: false, parallel: false })
      return { output: result.output, engines: result.engines }
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
    ).pipe(Effect.map((output) => ({ output, engines: ["parallel"] as readonly string[] })))
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
  ).pipe(Effect.map((output) => ({ output, engines: ["exa"] as readonly string[] })))
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
              provider,
            },
          })

          // 验证提供商是否真的可用（DuckDuckGo 始终可用，无需 key）
          if (!providerAvailable(provider)) {
            const hint = provider === "exa"
              ? "EXA_API_KEY 环境变量未设置。"
              : "PARALLEL_API_KEY 环境变量未设置。"
            return {
              output: `网络搜索 (${provider}) 不可用：${hint} `
                + "请配置环境变量，或切换到内置的 "
                + "DuckDuckGo 搜索（无需 API key）。"
                + "作为备用，可以直接使用 webfetch 工具获取指定 URL 的内容。",
              title: "网络搜索不可用",
              metadata: { provider, available: false, engines: [] as readonly string[] },
            }
          }

          const { output, engines } = yield* callProvider(http, provider, params, ctx)

          return {
            output: output ?? "未找到搜索结果。请尝试其他查询词。",
            title: `${title}: ${params.query}`,
            metadata: { provider, available: true, engines },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
