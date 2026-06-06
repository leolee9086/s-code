/**
 * 购物比价模块测试
 */
import { describe, expect, test } from "bun:test"
import { detectPrice, extractPrices, computeStats, formatShoppingReport } from "../../src/search/price-compare"
import { makeAggregatedResult } from "../../src/search/engine"

describe("detectPrice", () => {
  test("extracts CNY price with ¥ prefix", () => {
    expect(detectPrice("¥123.00")).toBe(123)
    expect(detectPrice("只要 ¥2,599 起")).toBe(2599)
    expect(detectPrice("特价 ¥99")).toBe(99)
  })

  test("extracts CNY price with ￥ prefix", () => {
    expect(detectPrice("￥1,234.56")).toBe(1234.56)
    expect(detectPrice("￥ 500")).toBe(500)
  })

  test("extracts CNY price with 元 suffix", () => {
    expect(detectPrice("100元")).toBe(100)
    expect(detectPrice("1,299元起")).toBe(1299)
  })

  test("extracts USD price and converts to CNY", () => {
    expect(detectPrice("$99.99")).toBeCloseTo(719.93, 0) // 99.99 * 7.2
    expect(detectPrice("$ 1,299.00")).toBe(1299 * 7.2)
  })

  test("returns undefined for text without price", () => {
    expect(detectPrice("")).toBeUndefined()
    expect(detectPrice("hello world")).toBeUndefined()
    expect(detectPrice("免费")).toBeUndefined()
  })
})

describe("extractPrices", () => {
  test("extracts prices from aggregated results", () => {
    const results = [
      makeAggregatedResult({
        title: "iPhone 16 Pro Max",
        url: "https://jd.com/item/123",
        snippet: "¥8,999 限时优惠",
        engines: ["jd"],
        positions: [1],
        category: "shopping",
      }),
      makeAggregatedResult({
        title: "iPhone 16 Pro Max",
        url: "https://smzdm.com/p/456",
        snippet: "好价 ¥8,499",
        engines: ["smzdm"],
        positions: [1],
        category: "shopping",
      }),
    ]

    const prices = extractPrices(results)
    expect(prices).toHaveLength(2)
    expect(prices[0].price).toBe(8999)
    expect(prices[0].source).toBe("京东")
    expect(prices[1].price).toBe(8499)
    expect(prices[1].source).toBe("什么值得买")
  })

  test("handles results without prices", () => {
    const results = [
      makeAggregatedResult({
        title: "商品测试",
        url: "https://example.com/item/1",
        snippet: "暂无报价",
        engines: ["test"],
        positions: [1],
        category: "shopping",
      }),
    ]

    const prices = extractPrices(results)
    expect(prices).toHaveLength(1)
    expect(prices[0].price).toBeUndefined()
  })
})

describe("computeStats", () => {
  test("computes price statistics with multiple items", () => {
    const prices = [
      { price: 8499, source: "什么值得买", title: "iPhone 16", url: "https://smzdm.com/1", snippet: "" },
      { price: 8999, source: "京东", title: "iPhone 16", url: "https://jd.com/1", snippet: "" },
      { price: 8799, source: "淘宝", title: "iPhone 16", url: "https://taobao.com/1", snippet: "" },
    ]

    const stats = computeStats(prices)
    expect(stats).toBeDefined()
    expect(stats!.cheapest.price).toBe(8499)
    expect(stats!.mostExpensive.price).toBe(8999)
    expect(stats!.spread).toBe(500)
    expect(stats!.spreadPercent).toBeCloseTo(5.88, 0)
    expect(stats!.pricedCount).toBe(3)
  })

  test("handles single priced item", () => {
    const prices = [
      { price: 5000, source: "京东", title: "商品", url: "https://jd.com/1", snippet: "" },
      { price: undefined, source: "淘宝", title: "商品", url: "https://taobao.com/1", snippet: "" },
    ]

    const stats = computeStats(prices)
    expect(stats).toBeDefined()
    expect(stats!.cheapest.price).toBe(5000)
    expect(stats!.mostExpensive.price).toBe(5000)
    expect(stats!.spread).toBe(0)
    expect(stats!.pricedCount).toBe(1)
  })

  test("returns undefined when no priced items", () => {
    const prices = [
      { price: undefined, source: "A", title: "1", url: "https://a.com/1", snippet: "" },
    ]
    expect(computeStats(prices)).toBeUndefined()
  })

  test("groups by platform", () => {
    const prices = [
      { price: 100, source: "京东", title: "A", url: "https://jd.com/1", snippet: "" },
      { price: 200, source: "京东", title: "B", url: "https://jd.com/2", snippet: "" },
      { price: 150, source: "淘宝", title: "C", url: "https://taobao.com/1", snippet: "" },
    ]

    const stats = computeStats(prices)!
    expect(stats.byPlatform.get("京东")!.min).toBe(100)
    expect(stats.byPlatform.get("京东")!.max).toBe(200)
    expect(stats.byPlatform.get("京东")!.count).toBe(2)
    expect(stats.byPlatform.get("淘宝")!.min).toBe(150)
    expect(stats.byPlatform.get("淘宝")!.max).toBe(150)
  })
})

describe("formatShoppingReport", () => {
  test("generates structured report with prices", () => {
    const results = [
      makeAggregatedResult({
        title: "iPhone 16 Pro Max 256GB",
        url: "https://jd.com/item/123",
        snippet: "¥8,999 限时优惠 立即购买",
        engines: ["jd"],
        positions: [1],
        category: "shopping",
      }),
      makeAggregatedResult({
        title: "iPhone 16 Pro Max",
        url: "https://smzdm.com/p/456",
        snippet: "好价 ¥8,499 包邮",
        engines: ["smzdm"],
        positions: [1],
        category: "shopping",
      }),
    ]

    const report = formatShoppingReport(results, "iPhone 16 Pro Max")
    expect(report).toContain("比价报告")
    expect(report).toContain("¥8,999")
    expect(report).toContain("¥8,499")
    expect(report).toContain("京东")
    expect(report).toContain("什么值得买")
  })

  test("handles empty results", () => {
    expect(formatShoppingReport([], "test")).toBe("")
  })

  test("separates shopping from other categories", () => {
    const shopping = [
      makeAggregatedResult({
        title: "商品",
        url: "https://jd.com/1",
        snippet: "¥100",
        engines: ["jd"],
        positions: [1],
        category: "shopping",
      }),
    ]
    const general = [
      makeAggregatedResult({
        title: "通用信息",
        url: "https://example.com/1",
        snippet: "相关内容",
        engines: ["test"],
        positions: [1],
        category: "general",
      }),
    ]

    const report = formatShoppingReport([...shopping, ...general], "test")
    expect(report).toContain("其他相关信息")
  })
})
