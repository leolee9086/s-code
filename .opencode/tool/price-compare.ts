/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"

// ── 类型 ────────────────────────────────────────────────

interface PriceItem {
  title: string
  url: string
  source: string
  price?: number
  snippet: string
}

// ── 常量 ────────────────────────────────────────────────

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
const DDG_HTML_URL = "https://html.duckduckgo.com/html/"

// 平台配置
const PLATFORMS: Record<string, { domain: string; name: string }> = {
  smzdm: { domain: "smzdm.com", name: "什么值得买" },
  jd: { domain: "jd.com", name: "京东" },
  taobao: { domain: "taobao.com", name: "淘宝" },
  tmall: { domain: "tmall.com", name: "天猫" },
  pdd: { domain: "pinduoduo.com", name: "拼多多" },
  suning: { domain: "suning.com", name: "苏宁易购" },
  gome: { domain: "gome.com.cn", name: "国美" },
  "amazon-cn": { domain: "amazon.cn", name: "亚马逊中国" },
  "amazon-us": { domain: "amazon.com", name: "Amazon.com" },
  vip: { domain: "vip.com", name: "唯品会" },
  "1688": { domain: "1688.com", name: "阿里巴巴1688" },
}

// 默认搜索平台（快速、常用的中国平台）
const DEFAULT_PLATFORMS = ["smzdm", "jd", "taobao", "pdd"]

// ── 工具定义 ────────────────────────────────────────────

export const priceCompare = tool({
  description: `跨平台商品比价工具。

通过多个电商平台搜索指定商品并对比价格，返回格式化比价报告，
包含最低价、最高价、价差分析和购买推荐。

支持的平台：
- smzdm: 什么值得买（优惠信息聚合）
- jd: 京东
- taobao: 淘宝
- tmall: 天猫
- pdd: 拼多多
- suning: 苏宁易购
- gome: 国美
- vip: 唯品会
- 1688: 阿里巴巴1688（批发）
- amazon-cn: 亚马逊中国
- amazon-us: Amazon.com（美国）

示例：
- 搜索 iPhone: query="iPhone 16 Pro Max"
- 指定平台: query="戴森吸尘器" platforms="smzdm,jd"
- 海淘比价: query="AirPods Pro" platforms="smzdm,amazon-us"
`,
  args: {
    query: tool.schema
      .string()
      .describe("商品名称或关键词"),
    platforms: tool.schema
      .string()
      .optional()
      .default("smzdm,jd,taobao,pdd")
      .describe("要搜索的平台列表，逗号分隔。可选值: smzdm, jd, taobao, tmall, pdd, suning, gome, amazon-cn, amazon-us"),
    maxPerSource: tool.schema
      .number()
      .optional()
      .default(5)
      .describe("每个平台最大结果数（默认 5）"),
  },

  async execute(args: Record<string, unknown>, _ctx: ToolContext) {
    const query = args.query as string
    const platformsArg = (args.platforms as string) || DEFAULT_PLATFORMS.join(",")
    const maxPerSource = Math.min(Math.max((args.maxPerSource as number) || 5, 1), 10)

    if (!query || !query.trim()) {
      return "请提供商品名称。用法: query=\"商品名称\" platforms=\"smzdm,jd\""
    }

    const selected = platformsArg.split(",").map((s) => s.trim()).filter(Boolean)
    const lines: string[] = []
    lines.push(`🔍 正在跨平台比价: "${query}"`)
    lines.push(`📡 搜索平台: ${selected.join(", ")}`)
    lines.push("")

    // 并发搜索所有平台
    const results = await Promise.all(
      selected.map(async (platform) => {
        const config = PLATFORMS[platform]
        if (!config) return { platform, items: [] as PriceItem[], error: `未知平台: ${platform}` }

        try {
          const items = await searchPlatform(query, config.domain, config.name, maxPerSource)
          return { platform, items, error: null }
        } catch (e) {
          return { platform, items: [] as PriceItem[], error: (e as Error).message }
        }
      }),
    )

    // 汇总结果
    let totalItems = 0
    const allItems: PriceItem[] = []

    for (const r of results) {
      if (r.error) {
        lines.push(`   ⚠️ [${r.platform}] ${r.error}`)
      } else {
        const count = r.items.length
        totalItems += count
        lines.push(`   ✅ [${PLATFORMS[r.platform]?.name ?? r.platform}] ${count} 条结果`)
        allItems.push(...r.items)
      }
    }

    if (allItems.length === 0) {
      lines.push("")
      lines.push("❌ 所有平台均未找到相关商品。")
      lines.push("💡 试试更换搜索词或换用其他平台。")
      return lines.join("\n")
    }

    // 排序：有价格的按价格升序
    const withPrice = allItems.filter((i) => i.price !== undefined && i.price !== null)
    const withoutPrice = allItems.filter((i) => i.price === undefined || i.price === null)
    withPrice.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    const sorted = [...withPrice, ...withoutPrice]

    // 输出详细结果
    lines.push("")
    lines.push("=".repeat(60))
    lines.push(`📊 比价结果 (共 ${totalItems} 条，含价格 ${withPrice.length} 条)`)
    lines.push("=".repeat(60))
    lines.push("")

    sorted.slice(0, 15).forEach((item, i) => {
      const priceStr = item.price !== undefined ? `¥${item.price.toFixed(2)}` : "价格待询"
      lines.push(`${i + 1}. [${item.source}] ${item.title}`)
      lines.push(`   💰 ${priceStr}  🔗 ${item.url}`)
      lines.push("")
    })

    if (sorted.length > 15) {
      lines.push(`... 以及 ${sorted.length - 15} 条更多结果`)
      lines.push("")
    }

    // 价格总结
    if (withPrice.length >= 2) {
      const cheapest = withPrice[0]
      const mostExpensive = withPrice[withPrice.length - 1]
      const diff = mostExpensive.price! - cheapest.price!
      const pct = ((diff / cheapest.price!) * 100).toFixed(1)

      lines.push("-".repeat(60))
      lines.push(`💰 价格总结:`)
      lines.push(`   ✅ 最低价: ¥${cheapest.price!.toFixed(2)} — ${cheapest.source}`)
      lines.push(`      ${cheapest.title}`)
      lines.push(`      ${cheapest.url}`)
      lines.push(`   ❌ 最高价: ¥${mostExpensive.price!.toFixed(2)} — ${mostExpensive.source}`)
      lines.push(`      ${mostExpensive.title}`)
      lines.push(`      ${mostExpensive.url}`)
      lines.push(`   📊 价差: ¥${diff.toFixed(2)} (${pct}%)`)

      // 推荐
      lines.push(`   🏆 推荐购买: ${cheapest.title}`)
      lines.push(`      ${cheapest.url}`)

      // 按平台统计
      const byPlatform = new Map<string, number[]>()
      for (const item of withPrice) {
        const prices = byPlatform.get(item.source) || []
        prices.push(item.price!)
        byPlatform.set(item.source, prices)
      }
      lines.push("")
      lines.push(`📈 各平台价格区间:`)
      for (const [source, prices] of byPlatform) {
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        if (min === max) {
          lines.push(`   ${source}: ¥${min.toFixed(2)}`)
        } else {
          lines.push(`   ${source}: ¥${min.toFixed(2)} ~ ¥${max.toFixed(2)}`)
        }
      }
    } else if (withPrice.length === 1) {
      lines.push(`   💰 唯一价格: ¥${withPrice[0].price!.toFixed(2)} (${withPrice[0].source})`)
    } else {
      lines.push("   💡 未提取到明确价格信息，可尝试更换搜索词。")
    }

    return lines.join("\n")
  },
})

// ── 平台搜索 ────────────────────────────────────────────

/**
 * 通过 DuckDuckGo site: 语法搜索指定平台的商品
 */
async function searchPlatform(
  query: string,
  domain: string,
  source: string,
  maxResults: number,
): Promise<PriceItem[]> {
  const scopedQuery = `site:${domain} ${query} 价格`
  const formData = new URLSearchParams({ q: scopedQuery, b: "", kl: "wt-wt" })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(DDG_HTML_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      body: formData.toString(),
      signal: controller.signal,
    })

    if (!response.ok) return []
    const html = await response.text()
    if (html.includes('id="challenge-form"')) return []

    return parseDdgResults(html, maxResults, source, domain)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析 DuckDuckGo HTML 搜索结果，提取商品信息
 */
function parseDdgResults(
  html: string,
  maxResults: number,
  source: string,
  domain: string,
): PriceItem[] {
  const results: PriceItem[] = []

  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = resultRegex.exec(html)) !== null) {
    if (results.length >= maxResults) break

    let url = match[1].trim()
    const uddgMatch = url.match(/[?&]uddg=([^&]+)/)
    if (uddgMatch) {
      try { url = decodeURIComponent(uddgMatch[1]) } catch { }
    }

    const title = match[2].replace(/<[^>]+>/g, "").trim()
    const snippet = match[3].replace(/<[^>]+>/g, "").trim()

    if (!title || !url) continue
    if (!url.includes(domain)) continue

    // 从标题和摘要中提取价格
    const fullText = `${title} ${snippet}`
    const price = parsePrice(fullText)

    results.push({
      title: title.replace(/[¥￥]\s*\d+(?:[.,]\d{1,2})?/, "").trim() || title,
      url,
      source,
      price,
      snippet: snippet.slice(0, 150),
    })
  }

  return results
}

/**
 * 从文本中解析价格
 */
function parsePrice(text: string): number | undefined {
  if (!text) return undefined
  const cleaned = text.trim()

  // 人民币: ¥123.00 或 ￥123
  const cnyMatch = cleaned.match(/[¥￥]\s*(\d{1,10}(?:[.,]\d{1,2})?)/)
  if (cnyMatch) return parseFloat(cnyMatch[1].replace(",", ""))

  // 数字 + 元: 123元
  const yuanMatch = cleaned.match(/(\d{1,10}(?:[.,]\d{1,2})?)\s*元/)
  if (yuanMatch) return parseFloat(yuanMatch[1].replace(",", ""))

  // 美元: $123.45
  const usdMatch = cleaned.match(/\$\s*(\d{1,10}(?:[.,]\d{1,2})?)/)
  if (usdMatch) return parseFloat(usdMatch[1].replace(",", "")) * 7.2

  return undefined
}

export default priceCompare
