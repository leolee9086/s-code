/**
 * DuckDuckGo 搜索引擎适配器
 *
 * 借鉴 SearXNG 的 DDG 引擎实现
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
const DDG_HTML_URL = "https://html.duckduckgo.com/html/"
const REGEX_STRIP_TAGS = /<[^>]*>/g

const vqdCache = new Map<string, { vqd: string; expires: number }>()

export function makeDuckDuckGo(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) => searchWithFallback(http, query, opts.numResults || config.maxResults),
  }
}

function searchWithFallback(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const htmlResults = yield* searchHtmlPost(http, query, numResults).pipe(
      Effect.catchIf(() => true, () => Effect.succeed([] as readonly SearchResult[])),
    )
    if (htmlResults.length > 0) return htmlResults

    const jsonResults = yield* searchJsonApi(http, query, numResults).pipe(
      Effect.catchIf(() => true, () => Effect.succeed([] as readonly SearchResult[])),
    )
    if (jsonResults.length > 0) return jsonResults

    return yield* searchLite(http, query, numResults).pipe(
      Effect.catchIf(() => true, () => Effect.succeed([] as readonly SearchResult[])),
    )
  })
}

function searchHtmlPost(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const formData = new URLSearchParams({ q: query, b: "", kl: "wt-wt" })
    const response = yield* http.execute(
      HttpClientRequest.post(DDG_HTML_URL).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          Referer: "https://html.duckduckgo.com/",
        }),
        HttpClientRequest.bodyText(formData.toString()),
      ),
    ).pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    if (html.includes('id="challenge-form"')) return []

    const vqdMatch = html.match(/<input[^>]*name=["']vqd["'][^>]*value=["']([^"']+)["']/i)
    if (vqdMatch?.[1]) vqdCache.set(`${query}//${USER_AGENT}`, { vqd: vqdMatch[1], expires: Date.now() + 3600_000 })
    return parseHtmlResults(html, numResults)
  })
}

function searchJsonApi(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const response = yield* http.execute(
      HttpClientRequest.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        }),
      ),
    ).pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    const vqd = html.match(/vqd\s*=\s*["']([^"']+)["']/)?.[1]
    if (!vqd) return []

    const jsonUrl = new URL("https://links.duckduckgo.com/d.js")
    jsonUrl.searchParams.set("q", query); jsonUrl.searchParams.set("vqd", vqd)
    jsonUrl.searchParams.set("kl", "wt-wt"); jsonUrl.searchParams.set("l", "wt-wt")
    jsonUrl.searchParams.set("o", "json"); jsonUrl.searchParams.set("sp", "0"); jsonUrl.searchParams.set("ex", "-1")

    const jsonResponse = yield* http.execute(
      HttpClientRequest.get(jsonUrl.toString()).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*",
          Referer: "https://duckduckgo.com/",
        }),
      ),
    ).pipe(Effect.timeout("15 seconds"))

    if (jsonResponse.status < 200 || jsonResponse.status >= 400) return []
    const text: string = yield* jsonResponse.text
    let data: any
    try { data = JSON.parse(text) } catch { return [] }

    const results: SearchResult[] = []
    let pos = 0
    for (const row of (data?.results ?? [])) {
      if (results.length >= numResults) break
      const href = row.u; const title = stripHtml(row.t ?? "")
      if (!href || !title) continue
      pos++
      results.push(makeSearchResult({ title, url: extractUrl(href), snippet: stripHtml(row.a ?? ""), engine: "duckduckgo", position: pos }))
    }
    return results
  })
}

function searchLite(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    const response = yield* http.execute(
      HttpClientRequest.get(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        }),
      ),
    ).pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []
    const html: string = yield* response.text
    return parseLiteResults(html, numResults)
  })
}

function stripHtml(text: string): string {
  return text.replace(REGEX_STRIP_TAGS, "").replace(/&quot;/g, '"').trim()
}

function extractUrl(href: string): string {
  if (!href) return ""
  const uddgMatch = href.match(/[?&]uddg=([^&]+)/)
  if (uddgMatch) { try { return decodeURIComponent(uddgMatch[1]) } catch { } }
  if (href.startsWith("http://") || href.startsWith("https://")) return href
  if (href.startsWith("//")) return `https:${href}`
  return href
}

function parseHtmlResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  let current: Partial<{ title: string; url: string; snippet: string }> = {}
  let inResult = false, depth = 0, inTitle = false, inSnippet = false, textBuf = "", pos = 0

  const parser = new Parser({
    onopentag(name, attrs) {
      const cls = attrs.class ?? ""
      if (name === "div") {
        const classes = cls.split(/\s+/)
        if (classes.includes("result") && !classes.includes("results") && !inResult) {
          current = {}; inResult = true; depth = 1; return
        }
        if (inResult) depth++; return
      }
      if (!inResult) return
      if (name === "a" && cls === "result__a") { inTitle = true; textBuf = ""; current.url = extractUrl(attrs.href ?? "") }
      if (name === "a" && cls === "result__snippet") { inSnippet = true; textBuf = "" }
    },
    ontext(text) { if (inTitle || inSnippet) textBuf += text },
    onclosetag(name) {
      if (!inResult) return
      if (name === "div") {
        depth--; if (depth <= 0) {
          if (current.title && current.url) {
            pos++; results.push(makeSearchResult({ title: current.title, url: current.url, snippet: current.snippet ?? "", engine: "duckduckgo", position: pos }))
            if (results.length >= maxResults) { parser.reset(); return }
          }
          current = {}; inResult = false
        }
        return
      }
      if (name === "a") {
        if (inTitle) { current.title = (current.title ?? "") + textBuf.trim(); inTitle = false }
        if (inSnippet) { current.snippet = (current.snippet ?? "") + textBuf.trim(); inSnippet = false }
        textBuf = ""
      }
    },
  })

  parser.write(html); parser.end()
  if (inResult && current.title && current.url && results.length < maxResults) {
    pos++; results.push(makeSearchResult({ title: current.title, url: current.url, snippet: current.snippet ?? "", engine: "duckduckgo", position: pos }))
  }
  return results
}

function parseLiteResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>(); let pos = 0
  const tableRegex = /<tr[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null
  while ((m = tableRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break
    const url = extractUrl(m[1]); if (!url || seen.has(url)) continue; seen.add(url); pos++
    results.push(makeSearchResult({ title: stripHtml(m[2]), url, snippet: stripHtml(m[3]), engine: "duckduckgo", position: pos }))
  }
  if (results.length > 0) return results
  const divRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
  while ((m = divRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break
    const url = extractUrl(m[1]); if (!url || seen.has(url)) continue; seen.add(url); pos++
    results.push(makeSearchResult({ title: stripHtml(m[2]), url, snippet: stripHtml(m[3]), engine: "duckduckgo", position: pos }))
  }
  return results
}

export * as DuckDuckGoEngine from "./duckduckgo"
