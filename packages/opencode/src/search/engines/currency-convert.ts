/**
 * 货币转换搜索引擎适配器
 *
 * 搜索货币转换信息。
 * API: https://api.exchangerate-api.com/v4/latest/USD
 *
 * 参考 SearXNG: searx/engines/currency_convert.py
 * 零风险：公开 API，无需 key
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const API_URL = "https://api.exchangerate-api.com/v4/latest/USD"
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
    const response = yield* http.execute(
      HttpClientRequest.get(API_URL).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (response.status < 200 || response.status >= 400) return []
    const raw: string = yield* response.text
    if (!raw) return []

    return parseCurrencyConvertResults(raw, query, numResults)
  })
}

interface CurrencyData {
  rates?: Record<string, number>
  date?: string
  base?: string
}

function parseCurrencyConvertResults(raw: string, query: string, maxResults: number): SearchResult[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }

  const data = parsed as CurrencyData
  if (!data.rates) return []

  // Parse query for currency conversion pattern
  // Examples: "100 USD to EUR", "USD/EUR", "100 usd in eur"
  const queryLower = query.toLowerCase()
  const results: SearchResult[] = []
  let pos = 0

  // Try to extract amount and currencies from query
  const amountMatch = queryLower.match(/(\d+(?:\.\d+)?)\s*([a-z]{3})\s*(?:to|in|=\s*)\s*([a-z]{3})/i)
  const pairMatch = queryLower.match(/([a-z]{3})\s*(?:\/|to|in)\s*([a-z]{3})/i)

  if (amountMatch) {
    const amount = parseFloat(amountMatch[1])
    const fromCurrency = amountMatch[2].toUpperCase()
    const toCurrency = amountMatch[3].toUpperCase()

    // If base is USD and we're converting from USD
    if (data.base === fromCurrency && data.rates[toCurrency]) {
      const rate = data.rates[toCurrency]
      const result = amount * rate

      pos++
      results.push(
        makeSearchResult({
          title: `${amount} ${fromCurrency} = ${result.toFixed(2)} ${toCurrency}`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          snippet: `Exchange rate: 1 ${fromCurrency} = ${rate} ${toCurrency}. Data from ${data.date || 'unknown'}.`,
          engine: "currency-convert",
          position: pos,
          category: "other",
        }),
      )
    }
  } else if (pairMatch) {
    const fromCurrency = pairMatch[1].toUpperCase()
    const toCurrency = pairMatch[2].toUpperCase()

    if (data.rates[toCurrency]) {
      const rate = data.rates[toCurrency]

      pos++
      results.push(
        makeSearchResult({
          title: `${fromCurrency}/${toCurrency} Exchange Rate`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          snippet: `1 ${fromCurrency} = ${rate} ${toCurrency}. Data from ${data.date || 'unknown'}.`,
          engine: "currency-convert",
          position: pos,
          category: "other",
        }),
      )
    }
  }

  // If no specific conversion found, provide general currency info
  if (results.length === 0 && data.rates) {
    const topCurrencies = ["EUR", "GBP", "JPY", "CNY", "CAD", "AUD"]
    const availableCurrencies = topCurrencies.filter(c => data.rates[c])

    if (availableCurrencies.length > 0) {
      const snippets = availableCurrencies.map(c => `${c}: ${data.rates[c]}`).join(", ")

      pos++
      results.push(
        makeSearchResult({
          title: `USD Exchange Rates (${data.date || 'latest'})`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          snippet: `USD rates: ${snippets}`,
          engine: "currency-convert",
          position: pos,
          category: "other",
        }),
      )
    }
  }

  return results
}

export * as CurrencyConvertEngine from "./currency-convert"