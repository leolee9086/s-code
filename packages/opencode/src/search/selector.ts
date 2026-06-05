/**
 * 搜索引擎选择器
 * 根据环境配置选择可用引擎
 * 借鉴 SearXNG 的引擎选择逻辑：按优先级和可用性动态选择
 */
import { Duration } from "effect"
import { makeEngineConfig } from "./engine"
import type { SearchEngine } from "./engine"
import { makeDuckDuckGo } from "./engines/duckduckgo"
import { makeBrave } from "./engines/brave"
import { makeBing } from "./engines/bing"
import { makeBingNews } from "./engines/bing-news"
import { makeSiteScopedEngine } from "./engines/site-scoped"
import { makeBilibili } from "./engines/bilibili"
import { makeSogouWeChat } from "./engines/sogou-wechat"
import { makeBaidu } from "./engines/baidu"
import { makeWikipedia } from "./engines/wikipedia"
import { makeArxiv } from "./engines/arxiv"
import { makeSemanticScholar } from "./engines/semantic-scholar"
import { makeGitHub } from "./engines/github"
import { makeUnsplash, makePixabay, makePubMed, makeHackerNews, makeDockerHub, makeNpm } from "./engines/open-api"
import { makeBingImages } from "./engines/bing-images"
import { makeSogou } from "./engines/sogou"
import { make360Search } from "./engines/360search"
import { makeGoogle } from "./engines/google"
import { makeYandex } from "./engines/yandex"

/**
 * 站点限定搜索引擎配置
 * 通过 DuckDuckGo/Bing 的 site: 语法搜索，零风险（不直接请求目标站点）
 * 只要目标站点被搜索引擎索引即可工作
 */
const SITE_SCOPED_ENGINES = [
  // 中文社交/内容平台
  { domain: "weibo.com", name: "weibo", label: "微博" },
  { domain: "tieba.baidu.com", name: "tieba", label: "百度贴吧" },
  { domain: "douban.com", name: "douban", label: "豆瓣" },
  { domain: "toutiao.com", name: "toutiao", label: "今日头条" },
  { domain: "baijiahao.baidu.com", name: "baijiahao", label: "百家号" },
  { domain: "huxiu.com", name: "huxiu", label: "虎嗅" },
  { domain: "36kr.com", name: "36kr", label: "36氪" },
  { domain: "jianshu.com", name: "jianshu", label: "简书" },
  { domain: "zhuanlan.zhihu.com", name: "zhihu-column", label: "知乎专栏" },
  // 技术社区
  { domain: "csdn.net", name: "csdn", label: "CSDN" },
  { domain: "oschina.net", name: "oschina", label: "开源中国" },
  // 新闻门户
  { domain: "163.com", name: "163", label: "网易" },
  { domain: "sohu.com", name: "sohu", label: "搜狐" },
  { domain: "qq.com", name: "qq", label: "腾讯新闻" },
] as const

export interface SelectFlags {
  exa?: boolean
  parallel?: boolean
  brave?: boolean
  xiaohongshu?: boolean
  zhihu?: boolean
  bilibili?: boolean
  /** 站点限定搜索：启用特定平台，空数组 = 禁用全部，不传 = 使用默认列表 */
  siteScoped?: readonly string[]
  /** 查询类型提示，用于智能选择相关引擎 */
  queryType?: "general" | "code" | "news" | "academic" | "social" | "video"
  /** 优先返回最新结果 */
  timeRange?: "day" | "week" | "month" | "year"
  /** 语言偏好 */
  lang?: string
}

/**
 * 判断是否应该包含某个站点限定引擎
 * - 未设置任何 flags：默认全部包含
 * - 设置了 siteScoped 数组：只包含数组中的引擎
 * - 设置了其他 flags 但未设置 siteScoped：不包含通用站点引擎
 */
function shouldIncludeSiteScoped(name: string, flags?: SelectFlags): boolean {
  if (!flags) return true // 无 flags = 默认全部
  if (flags.siteScoped) return flags.siteScoped.includes(name) // 显式指定
  // 有 flags 但没设 siteScoped：如果设了独立 flag (xiaohongshu/zhihu) 则按独立 flag，否则默认全开
  if (flags.xiaohongshu !== undefined || flags.zhihu !== undefined) {
    return false // 使用独立 flag 控制，不走自动全开
  }
  return true // 没涉及站点控制 → 默认全开
}

export function selectEngines(
  flags?: SelectFlags,
): SearchEngine[] {
  const engines: SearchEngine[] = []

  // DuckDuckGo 始终可用（免费、零配置）
  engines.push(makeDuckDuckGo(makeEngineConfig({
    name: "duckduckgo",
    weight: 1.0,
    timeout: Duration.toMillis(Duration.seconds(15)),
    maxResults: 8,
  })))

  // Bing 搜索 — 无需 API key，通过 HTML 解析实现
  // 在 DuckDuckGo 不可用时作为可靠备用
  engines.push(makeBing(makeEngineConfig({
    name: "bing",
    weight: 0.9,
    timeout: Duration.toMillis(Duration.seconds(15)),
    maxResults: 8,
    priority: 1,
    requiresKey: false,
  })))

  // Brave Search — 有 API key 时使用认证调用提高额度
  // Brave 免费版无需 API key 即可使用（每月 2000 次查询）
  const hasBraveKey = !!process.env.BRAVE_API_KEY
  if (flags?.brave || hasBraveKey || !flags) {
    engines.push(makeBrave(makeEngineConfig({
      name: "brave",
      weight: 1.2,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 8,
      priority: 1,
      requiresKey: false,
    })))
  }

  // ── 站点限定搜索引擎（通过 DDG/Bing site: 语法） ──────────
  // 这些引擎不直接请求目标站点，零风险，仅依赖搜索引擎索引

  // 小红书 — 独立 flag 兼容
  if (flags?.xiaohongshu || shouldIncludeSiteScoped("xiaohongshu", flags)) {
    engines.push(makeSiteScopedEngine("xiaohongshu.com", "xiaohongshu", makeEngineConfig({
      name: "xiaohongshu",
      weight: 0.8,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
    })))
  }

  // 知乎 — 独立 flag 兼容
  if (flags?.zhihu || shouldIncludeSiteScoped("zhihu", flags)) {
    engines.push(makeSiteScopedEngine("zhihu.com", "zhihu", makeEngineConfig({
      name: "zhihu",
      weight: 0.8,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
    })))
  }

  // 通用站点限定引擎列表
  for (const site of SITE_SCOPED_ENGINES) {
    if (shouldIncludeSiteScoped(site.name, flags)) {
      engines.push(makeSiteScopedEngine(site.domain, site.name, makeEngineConfig({
        name: site.name,
        weight: 0.8,
        timeout: Duration.toMillis(Duration.seconds(15)),
        maxResults: 5,
        priority: 0,
      })))
    }
  }

  // Bilibili 视频搜索 — 调用 Bilibili 内部 JSON API
  // 无需 API key，通过随机 buvid3 cookie 绕过基础反爬
  if (flags?.bilibili || !flags || flags?.queryType === "video") {
    engines.push(makeBilibili(makeEngineConfig({
      name: "bilibili",
      weight: 1.0,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
    })))
  }

  // 搜狗微信 — 微信公众号文章搜索
  if (!flags || flags?.queryType === "news" || flags?.queryType === "social") {
    engines.push(makeSogouWeChat(makeEngineConfig({
      name: "sogou-wechat",
      weight: 0.9,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // 百度搜索 — 中文网页搜索
  // 使用百度 JSON API (https://www.baidu.com/s?tn=json)
  if (!flags || flags?.lang?.startsWith("zh")) {
    engines.push(makeBaidu(makeEngineConfig({
      name: "baidu",
      weight: 0.9,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 8,
      priority: 1,
      requiresKey: false,
    })))
  }

  // Google 搜索 — 全球最大搜索引擎（HTTP HTML 解析）
  // 参考 SearXNG google.py，含 CAPTCHA 检测 + CONSENT cookie
  if (!flags) {
    engines.push(makeGoogle(makeEngineConfig({
      name: "google",
      weight: 1.3,
      timeout: Duration.toMillis(Duration.seconds(20)),
      maxResults: 8,
      priority: 2,
      requiresKey: false,
    })))
  }

  // Yandex 搜索 — 俄语区主要搜索引擎
  if (!flags) {
    engines.push(makeYandex(makeEngineConfig({
      name: "yandex",
      weight: 0.7,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // 搜狗搜索 — 中文网页搜索（SearXNG sogou.py 参考）
  if (!flags) {
    engines.push(makeSogou(makeEngineConfig({
      name: "sogou",
      weight: 0.8,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // 360搜索 — 中文网页搜索
  if (!flags) {
    engines.push(make360Search(makeEngineConfig({
      name: "360search",
      weight: 0.7,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // Bing Images — 图片搜索
  if (!flags) {
    engines.push(makeBingImages(makeEngineConfig({
      name: "bing-images",
      weight: 0.9,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // 学术类查询：Arxiv + Semantic Scholar
  if (!flags || flags?.queryType === "academic") {
    engines.push(makeArxiv(makeEngineConfig({
      name: "arxiv",
      weight: 1.0,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 1,
      requiresKey: false,
    })))
    engines.push(makeSemanticScholar(makeEngineConfig({
      name: "semantic-scholar",
      weight: 1.1,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 1,
      requiresKey: false,
    })))
  }

  // 代码类查询：GitHub
  if (!flags || flags?.queryType === "code") {
    engines.push(makeGitHub(makeEngineConfig({
      name: "github",
      weight: 1.0,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 1,
      requiresKey: !!process.env.GITHUB_TOKEN,
    })))
  }

  // 百科类查询：Wikipedia
  if (!flags || flags?.queryType === "academic") {
    engines.push(makeWikipedia(makeEngineConfig({
      name: "wikipedia",
      weight: 0.9,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 5,
      priority: 0,
      requiresKey: false,
    })))
  }

  // 开放 API 引擎族（图片、新闻、代码）
  if (!flags) {
    // 图片
    engines.push(makeUnsplash(makeEngineConfig({ name: "unsplash", weight: 0.7, timeout: 10000, maxResults: 4, requiresKey: false })))
    // 新闻
    engines.push(makeHackerNews(makeEngineConfig({ name: "hackernews", weight: 0.8, timeout: 10000, maxResults: 5, requiresKey: false })))
    // 学术
    engines.push(makePubMed(makeEngineConfig({ name: "pubmed", weight: 0.8, timeout: 10000, maxResults: 5, requiresKey: false })))
    // 代码仓库
    engines.push(makeNpm(makeEngineConfig({ name: "npm", weight: 0.7, timeout: 10000, maxResults: 5, requiresKey: false })))
    engines.push(makeDockerHub(makeEngineConfig({ name: "dockerhub", weight: 0.6, timeout: 10000, maxResults: 5, requiresKey: false })))
  }

  // 新闻类查询：添加 Bing News 专用引擎 + 增大 maxResults
  if (flags?.queryType === "news") {
    engines.push(makeBingNews(makeEngineConfig({
      name: "bing-news",
      weight: 1.1,
      timeout: Duration.toMillis(Duration.seconds(15)),
      maxResults: 10,
      priority: 2,
      requiresKey: false,
    })))
    for (const e of engines) {
      // @ts-ignore - 运行时调整 maxResults
      e.config.maxResults = Math.max(e.config.maxResults, 10)
    }
  }

  return engines
}

export function engineSummary(engines: SearchEngine[]): string {
  const names = engines.map((e) => `${e.name}(weight=${e.config.weight})`)
  return `已启用引擎: ${names.join(", ")}`
}

export * as Selector from "./selector"
