/**
 * DuckDuckGo 搜索适配器
 *
 * 使用 DuckDuckGo 的公开 JSON API（需先获取 vqd token）：
 * 1. GET https://duckduckgo.com/?q=<query>  → 提取 vqd token
 * 2. GET https://links.duckduckgo.com/d.js   → 返回 JSON 格式的搜索结果
 *
 * 参考：https://github.com/deedy5/duckduckgo_search（Python SDK 的相同流程）
 */

import { Effect, Schedule } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"

export interface DuckDuckGoResult {
  title: string
  url: string
  snippet: string
}

const REGEX_STRIP_TAGS = /<[^>]*>/g

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

/** DuckDuckGo 搜索——使用 JSON API 获取结构化结果 */
export function search(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number = 8,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    // 1. 获取 VQD token——DuckDuckGo 用于验证的令牌
    // 如果首次失败，重试最多 2 次（DuckDuckGo 偶尔会限制首次请求）
    const vqd = yield* getVqd(http, query).pipe(
      Effect.retry(Schedule.recurs(2)),
    )
    if (!vqd) {
      // VQD 获取失败，回退到 HTML 解析
      const fallback = yield* searchHtml(http, query, numResults)
      return fallback
    }

    // 2. 用 VQD token 请求 JSON 搜索结果
    // DuckDuckGo 的分页偏移量：0, 20, 70, 120
    const searchPositions = ["0", "20", "70", "120"]
    const results: DuckDuckGoResult[] = []
    for (const s of searchPositions) {
      if (results.length >= numResults) break
      const page = yield* searchPage(http, query, vqd, s)
      for (const row of page) {
        if (results.length >= numResults) break
        if (row.url && !results.some((r) => r.url === row.url)) {
          results.push(row)
        }
      }
    }

    return results.slice(0, numResults)
  })
}

/**
 * 获取 VQD token——DuckDuckGo 的反爬验证令牌
 * 从 HTML 首页中提取 vqd="..." 或 vqd=...& 或 vqd='...'
 */
function getVqd(http: HttpClient.HttpClient, query: string): Effect.Effect<string | undefined, unknown, never> {
  return Effect.gen(function* () {
    const request = HttpClientRequest.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`).pipe(
      HttpClientRequest.setHeaders({
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }),
    )

    const response = yield* HttpClient.filterStatusOk(http).execute(request).pipe(
      Effect.timeout("15 seconds"),
    )

    const html: string = yield* response.text

    // 尝试多种 vqd token 的提取模式
    // DuckDuckGo HTML 中通常形如: var vqd = "abc123" 或 vqd="abc123"
    // 也检查 URL 参数中的 vqd（某些版本在重定向 URL 中携带）
    const patterns = [
      /vqd\s*=\s*"([^"]+)"/,
      /vqd\s*=\s*'([^']+)'/,
      /vqd\s*=\s*([^&\s"'})]+)/,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        return match[1]
      }
    }

    return undefined
  })
}

/**
 * 请求一页 JSON 格式的搜索结果
 * URL: https://links.duckduckgo.com/d.js?q=...&kl=wt-wt&l=wt-wt&s=0&vqd=...&o=json&sp=0&ex=-1
 */
function searchPage(
  http: HttpClient.HttpClient,
  query: string,
  vqd: string,
  s: string,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    const url = "https://links.duckduckgo.com/d.js"
    const params = new URLSearchParams({
      q: query,
      kl: "wt-wt",
      l: "wt-wt",
      s,
      df: "",
      vqd,
      o: "json",
      sp: "0",
      ex: "-1", // moderate safesearch
    })


    const request = HttpClientRequest.get(`${url}?${params.toString()}`).pipe(
      HttpClientRequest.setHeaders({
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        Referer: "https://duckduckgo.com/",
      }),
    )

    const response = yield* HttpClient.filterStatusOk(http).execute(request).pipe(
      Effect.timeout("15 seconds"),
    )

    const text: string = yield* response.text

    // 尝试解析 JSON
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return []
    }

    const pageData: any[] = data?.results ?? []
    const results: DuckDuckGoResult[] = []
    const seen = new Set<string>()

    for (const row of pageData) {
      const href: string | undefined = row.u
      if (!href || seen.has(href)) continue
      seen.add(href)

      const title = stripHtml(row.t ?? "")
      const body = stripHtml(row.a ?? "")
      if (!title) continue

      results.push({
        title,
        url: normalizeUrl(href),
        snippet: body,
      })
    }

    return results
  })
}

/**
 * 回退方案：解析 DuckDuckGo 的公开 HTML 页面
 * 当 VQD token 获取失败时使用
 */
function searchHtml(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeaders({
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }),
    )

    const response = yield* HttpClient.filterStatusOk(http).execute(request).pipe(
      Effect.timeout("15 seconds"),
    )

    const html: string = yield* response.text
    const results = parseHtmlResults(html, numResults)

    if (results.length === 0) {
      const fallback = fallbackExtract(html, numResults)
      return fallback
    }

    return results
  })
}

/**
 * 主 HTML 解析器——通过 htmlparser2 追踪 div.result 嵌套
 */
export function parseHtmlResults(html: string, maxResults: number): DuckDuckGoResult[] {
  const results: DuckDuckGoResult[] = []
  let current: Partial<DuckDuckGoResult> = {}
  let inResult = false
  let depth = 0
  let inTitle = false
  let inSnippet = false
  let textBuf = ""

  const parser = new Parser({
    onopentag(name, attrs) {
      const cls = attrs.class ?? ""

      if (name === "div") {
        const classes = cls.split(/\s+/)
        if (classes.includes("result") && !classes.includes("results") && !inResult) {
          current = {}
          inResult = true
          depth = 1
          return
        }
        if (inResult) depth++
        return
      }

      if (!inResult) return

      if (name === "a" && cls === "result__a") {
        inTitle = true
        textBuf = ""
        current.url = extractRedirectUrl(attrs.href ?? "")
      }
      if (name === "a" && cls === "result__snippet") {
        inSnippet = true
        textBuf = ""
      }
    },

    ontext(text) {
      if (inTitle || inSnippet) textBuf += text
    },

    onclosetag(name) {
      if (!inResult) return

      if (name === "div") {
        depth--
        if (depth <= 0) {
          if (current.title && current.url && !results.some((r) => r.url === current.url)) {
            results.push(current as DuckDuckGoResult)
          }
          current = {}
          inResult = false
        }
        return
      }

      if (name === "a") {
        if (inTitle) {
          current.title = (current.title ?? "") + textBuf.trim()
          inTitle = false
        }
        if (inSnippet) {
          current.snippet = (current.snippet ?? "") + textBuf.trim()
          inSnippet = false
        }
        textBuf = ""
      }
    },
  })

  parser.write(html)
  parser.end()

  if (inResult && current.title && current.url && !results.some((r) => r.url === current.url)) {
    results.push(current as DuckDuckGoResult)
  }

  return results.slice(0, maxResults)
}

/** 回退解析器——通过正则匹配 result__a / result__snippet */
export function fallbackExtract(html: string, maxResults: number): DuckDuckGoResult[] {
  const results: DuckDuckGoResult[] = []

  const titleRegex = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRegex = /<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  const titles: Array<{ url: string; title: string }> = []
  let match: RegExpExecArray | null
  while ((match = titleRegex.exec(html)) !== null) {
    const url = extractRedirectUrl(match[1])
    const title = stripHtml(match[2])
    if (title && url) titles.push({ title, url })
  }

  const snippets: string[] = []
  while ((match = snippetRegex.exec(html)) !== null) {
    const snippet = stripHtml(match[1])
    if (snippet) snippets.push(snippet)
  }

  const count = Math.min(titles.length, maxResults)
  for (let i = 0; i < count; i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? "",
    })
  }

  return results
}

/** 从 DuckDuckGo 重定向 URL 中提取真实 URL */
export function extractRedirectUrl(href: string): string {
  if (!href) return ""
  const uddgMatch = href.match(/[?&]uddg=([^&]+)/)
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1])
    } catch {
      // fall through
    }
  }
  if (href.startsWith("http://") || href.startsWith("https://")) return href
  if (href.startsWith("//")) return `https:${href}`
  return href
}

/** 去除 HTML 标签 */
export function stripHtml(text: string): string {
  return text.replace(REGEX_STRIP_TAGS, "").replace(/&quot;/g, '"').trim()
}

/** 规范化 URL */
function normalizeUrl(url: string): string {
  return unquote(url).replace(/ /g, "+")
}

/** 简单的 URL unquote（私有实现，避免 import url 模块） */
function unquote(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\+/g, " "))
  } catch {
    return url
  }
}

export * as DuckDuckGo from "./duckduckgo"
