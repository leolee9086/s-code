/**
 * 货币转换搜索引擎适配器
 *
 * 使用 DuckDuckGo 的货币转换 API。
 * API: https://duckduckgo.com/js/spice/currency/1/USD/CNY
 *
 * 参考 SearXNG: searx/engines/currency_convert.py
 * 零风险：公开 API，无需 key
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const BASE_URL = "https://duckduckgo.com/js/spice/currency"
const USER_AGENT = "opencode-search/1.0"

export function makeCurrencyConvert(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchCurrencyConvert(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchCurrencyConvert(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    // 解析查询: "100 USD to CNY" 或 "USD to CNY"
    const match = query.match(/^(\d+\.?\d*)\s*([A-Z]{3})\s+to\s+([A-Z]{3})$/i)
    if (!match) {
      // 尝试简单格式: "USD CNY"
      const simpleMatch = query.match(/^([A-Z]{3})\s+([A-Z]{3})$/i)
      if (!simpleMatch) return []

      const from = simpleMatch[1].toUpperCase()
      const to = simpleMatch[2].toUpperCase()

      const response = yield* http.execute(
        HttpClientRequest.get(`${BASE_URL}/1/${from}/${to}`).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          }),
        ),
      ).pipe(Effect.timeout(timeout))

      if (response.status < 200 || response.status >= 400) return []
      const raw: string = yield* response.text
      if (!raw) return []

      return parseCurrencyResults(raw, `1 ${from}`, from, to)
    }

    const amount = parseFloat(match[1])
    const from = match[2].toUpperCase()
    const to = match[3].toUpperCase()

    const response = yield* http.execute(
      HttpClientRequest.get(`${BASE_URL}/1/${from}/${to}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const raw: string = yield* response.text
    if (!raw) return []

    return parseCurrencyResults(raw, `${amount} ${from}`, from, to, amount)
  })
}

interface CurrencyData {
  to?: Array<{ mid?: number; fq?: string }>
}

function parseCurrencyResults(
  raw: string,
  query: string,
  from: string,
  to: string,
  amount: number = 1,
): SearchResult[] {
  // DuckDuckGo 返回 JSONP，需要提取 JSON 部分
  const jsonMatch = raw.match(/\n(.+)\n/)
  if (!jsonMatch) return []

  let parsed: unknown
  try { parsed = JSON.parse(jsonMatch[1]) } catch { return [] }

  const data = parsed as CurrencyData
  const rate = data.to?.[0]?.mid
  if (!rate) return []

  const result = amount * rate
  const answer = `${query} = ${result.toFixed(2)} ${to} (1 ${from} : ${rate.toFixed(4)} ${to})`

  return [
    makeSearchResult({
      title: `${from} to ${to} Exchange Rate`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(`${from}+to+${to}`)}`,
      snippet: answer,
      engine: "currency-convert",
      position: 1,
      category: "general",
    }),
  ]
}

export * as CurrencyConvertEngine from "./currency-convert"
