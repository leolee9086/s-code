/**
 * 查询意图检测
 *
 * 根据查询文本自动推断搜索意图，动态选择最适合的引擎组。
 * 不需要调用方手动指定 queryType。
 */
import type { SearchEngine } from "./engine"

// ── 意图类型 ──────────────────────────────────────────

export interface QueryIntent {
  queryType?: "general" | "code" | "news" | "academic" | "social" | "video"
  isTranslation?: boolean
  isCurrency?: boolean
  isWeather?: boolean
  isUrlLookup?: boolean
}

// ── 检测规则 ──────────────────────────────────────────

// 编程语言名称（用于代码类检测）
const LANG_NAMES = [
  "rust", "python", "typescript", "javascript", "go", "golang",
  "java", "cplusplus", "csharp", "ruby", "swift", "kotlin", "scala",
  "php", "perl", "lua", "haskell", "elixir", "clojure",
  "dart", "flutter", "react", "vue", "angular", "node",
  "deno", "bun", "nextjs", "nuxt", "svelte",
]

const LANG_PATTERN = new RegExp(`\\b(${LANG_NAMES.join("|")})\\b`, "i")

// 货币代码
const CURRENCY_PATTERN = /\b([A-Z]{3})\s+(?:to|in|=>)\s+([A-Z]{3})\b/i

// 天气关键词
const WEATHER_PATTERN = /\b(weather|temperature|forecast|°[cf]|humidity|wind|rain|snow)\b/i

// 翻译关键词
const TRANSLATION_PATTERN = /\b(translate|meaning|definition|dictionary|duden|dictzone)\b/i

// URL 模式
const URL_PATTERN = /^https?:\/\//i

// 视频关键词
const VIDEO_PATTERN = /\b(watch|video|episode|trailer|clip)\b/i

// 新闻关键词  
const NEWS_PATTERN = /\b(news|latest|breaking|update|today|报道|新闻|最新)\b/i

// 学术关键词
const ACADEMIC_PATTERN = /\b(paper|thesis|doi|arxiv|semantic scholar|citation|reference|research|journal|proceedings)\b/i

// 代码/技术关键词
const CODE_KEYWORDS = [
  "\\bhow to\\b", "\\bwhat is\\b", "\\binstall\\b", "\\bnpm\\b", "\\bpip\\b",
  "\\bcargo\\b", "\\bgit\\b", "\\bapi\\b", "\\brest\\b", "\\bgraphql\\b",
  "\\bsql\\b", "\\bquery\\b", "\\bfunction\\b", "\\bclass\\b", "\\binterface\\b",
  "\\btype\\b", "\\berror\\b", "\\bbug\\b", "\\bdebug\\b", "\\bcompile\\b",
  "\\bsort\\b", "\\barray\\b", "\\blist\\b", "\\bmap\\b", "\\bfilter\\b",
  "\\breduce\\b", "\\balgorithm\\b", "\\btutorial\\b", "\\bguide\\b",
  "\\bdocumentation\\b", "\\bdocs\\b", "\\bdocker\\b", "\\bdeploy\\b",
  "\\bserver\\b", "\\bclient\\b", "\\bfrontend\\b", "\\bbackend\\b",
  "\\bfullstack\\b", "\\bleetcode\\b", "\\bcoding\\b",
]

const CODE_PATTERN = new RegExp(
  CODE_KEYWORDS.concat([LANG_PATTERN.source]).join("|"), "i",
)

// ── 意图检测 ──────────────────────────────────────────

/**
 * 检测查询意图，返回建议的 queryType 和额外标记。
 * 规则优先级从高到低，匹配即返回。
 */
export function detectQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim()
  if (!trimmed) return {}

  // 1. URL → 通用搜索（让 site-scoped 处理）
  if (URL_PATTERN.test(trimmed)) {
    return { queryType: "general" }
  }

  // 2. 货币转换
  if (CURRENCY_PATTERN.test(trimmed)) {
    return { queryType: "general", isCurrency: true }
  }

  // 3. 天气
  if (WEATHER_PATTERN.test(trimmed)) {
    return { queryType: "general", isWeather: true }
  }

  // 4. 翻译
  if (TRANSLATION_PATTERN.test(trimmed)) {
    return { queryType: "general", isTranslation: true }
  }

  // 5. 代码/技术
  if (CODE_PATTERN.test(trimmed) || LANG_PATTERN.test(trimmed)) {
    return { queryType: "code" }
  }

  // 6. 学术
  if (ACADEMIC_PATTERN.test(trimmed)) {
    return { queryType: "academic" }
  }

  // 7. 新闻
  if (NEWS_PATTERN.test(trimmed)) {
    return { queryType: "news" }
  }

  // 8. 视频
  if (VIDEO_PATTERN.test(trimmed)) {
    return { queryType: "video" }
  }

  // 默认：通用
  return { queryType: "general" }
}

/**
 * 基于检测到的意图，返回建议的额外 flag 标记。
 * 这些标记可与 selectEngines 的 flags 参数合并。
 */
export function intentToFlags(intent: QueryIntent): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  if (intent.isCurrency) flags.currency = true
  if (intent.isWeather) flags.weather = true
  if (intent.isTranslation) flags.translation = true
  return flags
}

export * as QueryIntent from "./query-intent"
