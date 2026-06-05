import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_RETRIES = 3 // 最大重试次数

// 内存缓存：key = "format:url"，TTL 60 秒，避免同一 session 内重复抓取相同 URL
const CACHE_TTL = Duration.seconds(60)
const fetchCache = new Map<string, { data: string; mime: string; expires: number }>()

function cacheKey(format: string, url: string) {
  return `${format}:${url}`
}

function getFromCache(key: string): { data: string; mime: string } | undefined {
  const entry = fetchCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) {
    fetchCache.delete(key)
    return undefined
  }
  return { data: entry.data, mime: entry.mime }
}

function setCache(key: string, data: string, mime: string) {
  fetchCache.set(key, { data, mime, expires: Date.now() + Duration.toMillis(CACHE_TTL) })
  // 限制缓存大小，避免内存泄漏
  if (fetchCache.size > 200) {
    const oldest = fetchCache.keys().next().value
    if (oldest) fetchCache.delete(oldest)
  }
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

          // 检查缓存
          const ck = cacheKey(params.format, params.url)
          const cached = getFromCache(ck)
          if (cached) {
            yield* ctx.metadata({ title: `WebFetch ${params.url} (cached)`, metadata: { cached: true } })
            return { output: cached.data, title: `${params.url} (cached)`, metadata: {} }
          }

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const request = HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders(headers))

          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const response = yield* httpOk.execute(request).pipe(
            Effect.catchIf(
              (err) =>
                err.reason._tag === "StatusCodeError" &&
                err.reason.response.status === 403 &&
                err.reason.response.headers["cf-mitigated"] === "challenge",
              () =>
                httpOk.execute(
                  HttpClientRequest.get(params.url).pipe(
                    HttpClientRequest.setHeaders({ ...headers, "User-Agent": "opencode" }),
                  ),
                ),
            ),
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => Effect.die(new Error(`WebFetch timed out after ${timeout / 1000}s: ${params.url}`)),
            }),
          )

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error(`Response too large (exceeds 5MB limit): ${params.url}`)
          }

          const arrayBuffer = yield* response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error(`Response too large (exceeds 5MB limit): ${params.url}`)
          }

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(arrayBuffer)

          // Handle content based on requested format and actual content type
          let output: string
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                output = convertHTMLToMarkdown(content)
              } else {
                output = content
              }
              break

            case "text":
              if (contentType.includes("text/html")) {
                output = extractTextFromHTML(content)
              } else {
                output = content
              }
              break

            case "html":
              output = content
              break

            default:
              output = content
          }

          // 写入缓存
          setCache(ck, output, mime)

          return { output, title, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

/** 从 HTML 中提取纯文本，跳过脚本/样式并合并空白 */
function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  let lastWasNewline = false

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed", "nav", "footer"].includes(name)) {
        skipDepth++
      }
      // 块级元素前加换行
      if (skipDepth === 0 && ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote", "br"].includes(name)) {
        if (!lastWasNewline) text += "\n"
      }
    },
    ontext(input) {
      if (skipDepth === 0) {
        const trimmed = input.replace(/\s+/g, " ").trim()
        if (trimmed) {
          if (!lastWasNewline && text && !text.endsWith("\n") && !text.endsWith(" ")) text += " "
          text += trimmed
          lastWasNewline = false
        }
      }
    },
    onclosetag(name) {
      if (skipDepth > 0) {
        if (["script", "style", "noscript", "iframe", "object", "embed", "nav", "footer"].includes(name)) {
          skipDepth--
        }
        return
      }
      // 块级关闭后加换行
      if (["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote"].includes(name)) {
        if (!lastWasNewline) text += "\n"
        lastWasNewline = true
      }
    },
  })

  parser.write(html)
  parser.end()

  // 合并连续空行
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    linkStyle: "inlined",
    linkReferenceStyle: "full",
  })
  turndownService.remove(["script", "style", "meta", "link", "nav", "footer"])
  // 给表格前后补充空行确保 markdown 渲染正确
  turndownService.addRule("tableSpacing", {
    filter: "table",
    replacement(content) {
      return `\n\n${content}\n\n`
    },
  })
  return turndownService.turndown(html)
}
