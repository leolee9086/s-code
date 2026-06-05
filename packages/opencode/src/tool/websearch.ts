import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import * as DuckDuckGo from "./duckduckgo"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
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

  // 默认使用 DuckDuckGo（免费、零配置）
  return "duckduckgo"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  if (provider === "duckduckgo") return "DuckDuckGo Web Search"
  return "Web Search"
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

/** 格式化 DuckDuckGo 结果为统一文本 */
function formatDuckDuckGoResults(results: DuckDuckGo.DuckDuckGoResult[], query: string): string {
  if (results.length === 0) return ""

  const lines = results.map(
    (r, i) =>
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet ?? ""}`,
  )
  return [`DuckDuckGo search results for "${query}":`, ...lines].join("\n\n")
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "duckduckgo") {
    return Effect.gen(function* () {
      const results = yield* DuckDuckGo.search(http, params.query, params.numResults || 8)
      if (results.length === 0) return undefined
      return formatDuckDuckGoResults(results, params.query)
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
              provider,
            },
          })

          // 验证提供商是否真的可用（DuckDuckGo 始终可用，无需 key）
          if (!providerAvailable(provider)) {
            const hint = provider === "exa"
              ? "EXA_API_KEY environment variable is not set."
              : "PARALLEL_API_KEY environment variable is not set."
            return {
              output: `Web search (${provider}) is not available: ${hint} `
                + "Configure it in your environment, or switch to the built-in "
                + "DuckDuckGo search which works without any API key. "
                + "As a fallback, use the webfetch tool to fetch specific URLs directly.",
              title: "Web Search Unavailable",
              metadata: { provider, available: false },
            }
          }

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider, available: true },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
