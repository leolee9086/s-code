/**
 * DuckDuckGo 搜索适配器
 *
 * 搜索策略优先级（由高到低）：
 * 1. HTML 端点解析（html.duckduckgo.com/html）——最稳定可靠，无需 token
 * 2. VQD/JSON API（links.duckduckgo.com/d.js）——数据结构化程度最高
 * 3. Lite 端点（lite.duckduckgo.com/lite）——HTML 最简单
 * 4. 正则表达式兜底提取
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

/** DuckDuckGo 搜索——多策略兜底 */
export function search(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number = 8,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    // 策略 1: HTML 端点（最稳定，无 VQD 依赖）
    const htmlResults = yield* searchHtml(http, query, numResults)
    if (htmlResults.length > 0) return htmlResults

    // 策略 2: VQD/JSON API（更好结构的数据）
    const vqd = yield* getVqd(http, query).pipe(
      Effect.retry(Schedule.recurs(1)),
    )
    if (vqd) {
      const jsonResults = yield* searchJson(http, query, vqd, numResults)
      if (jsonResults.length > 0) return jsonResults
    }

    // 策略 3: Lite 端点（最简单的 HTML）
    const liteResults = yield* searchLite(http, query, numResults)
    if (liteResults.length > 0) return liteResults

    return []
  })
}

/**
 * 获取 VQD token——DuckDuckGo 的反爬验证令牌
 * 从 HTML 首页中提取 vqd="..." 或 vqd=...& 或 vqd='...'
 */
function getVqd(http: HttpClient.HttpClient, query: string): Effect.Effect<string | undefined, unknown, never> {
  return Effect.gen(function* () {
    const response = yield* http
      .execute(
        HttpClientRequest.get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          }),
        ),
      )
      .pipe(Effect.timeout("15 seconds"))

    // 允许非 200 状态（DDG 可能返回 403/429 但仍然有内容）
    const status = response.status
    if (status < 200 || status >= 400) return undefined

    const html: string = yield* response.text

    // 尝试多种 vqd token 的提取模式
    const patterns = [
      /vqd\s*=\s*"([^"]+)"/,
      /vqd\s*=\s*'([^']+)'/,
      /vqd\s*=\s*([^&\s"'})]+)/,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) return match[1]
    }

    return undefined
  })
}

/**
 * 通过 JSON API 搜索（需要 VQD token）
 * URL: https://links.duckduckgo.com/d.js?q=...&kl=wt-wt&l=wt-wt&s=0&vqd=...&o=json&sp=0&ex=-1
 */
function searchJson(
  http: HttpClient.HttpClient,
  query: string,
  vqd: string,
  numResults: number,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    // DuckDuckGo 的分页偏移量：0, 20, 70, 120
    const searchPositions = ["0", "20", "70", "120"]
    const results: DuckDuckGoResult[] = []

    for (const s of searchPositions) {
      if (results.length >= numResults) break
      const page = yield* searchJsonPage(http, query, vqd, s)
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
 * 请求一页 JSON 格式的搜索结果
 */
function searchJsonPage(
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
      ex: "-1",
    })

    const response = yield* http
      .execute(
        HttpClientRequest.get(`${url}?${params.toString()}`).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            Accept: "application/json, text/plain, */*",
            Referer: "https://duckduckgo.com/",
          }),
        ),
      )
      .pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []

    const text: string = yield* response.text
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
 * 主方案：解析 DuckDuckGo 的公开 HTML 搜索结果页
 * URL: https://html.duckduckgo.com/html/?q=<query>
 */
function searchHtml(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          }),
        ),
      )
      .pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []

    const html: string = yield* response.text
    const results = parseHtmlResults(html, numResults)

    if (results.length === 0) {
      return fallbackExtract(html, numResults)
    }

    return results
  })
}

/**
 * 兜底方案：解析 DuckDuckGo Lite 搜索结果页
 * URL: https://lite.duckduckgo.com/lite/?q=<query>
 *
 * Lite 端点的 HTML 结构极其简单：
 * - 结果行在 <table> 中
 * - 每行第一个 <a> 是标题 + 链接
 * - 第二个 <a> 是摘要
 */
function searchLite(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
): Effect.Effect<DuckDuckGoResult[], unknown, never> {
  return Effect.gen(function* () {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          }),
        ),
      )
      .pipe(Effect.timeout("15 seconds"))

    if (response.status < 200 || response.status >= 400) return []

    const html: string = yield* response.text
    return parseLiteResults(html, numResults)
  })
}

/**
 * 解析 DuckDuckGo Lite 搜索结果
 * Lite 页面使用简单的表格布局：
 * <div class="result">
 *   <a href="...">标题</a>
 *   <span class="snippet">摘要</span>
 * </div>
 * 或者 <table><tr><td>...
 */
export function parseLiteResults(html: string, maxResults: number): DuckDuckGoResult[] {
  const results: DuckDuckGoResult[] = []
  const seen = new Set<string>()

  // 尝试表格模式（传统 lite 布局）
  const tableRegex = /<tr[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null
  while ((match = tableRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break
    const url = extractRedirectUrl(match[1])
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push({
      title: stripHtml(match[2]),
      url,
      snippet: stripHtml(match[3]),
    })
  }

  if (results.length > 0) return results

  // 尝试 div 模式（新版 lite 布局）
  const divRegex = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
  while ((match = divRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break
    const url = extractRedirectUrl(match[1])
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push({
      title: stripHtml(match[2]),
      url,
      snippet: stripHtml(match[3]),
    })
  }

  return results
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
