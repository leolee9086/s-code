/**
 * 查询意图检测测试
 */
import { describe, expect, test } from "bun:test"
import { detectQueryIntent, optimizeQuery, extractKeywords } from "../../src/search/query-intent"

describe("detectQueryIntent", () => {
  test("detects code queries by language name", () => {
    expect(detectQueryIntent("how to sort in Rust").queryType).toBe("code")
    expect(detectQueryIntent("Python async await example").queryType).toBe("code")
    expect(detectQueryIntent("TypeScript interface vs type").queryType).toBe("code")
  })

  test("detects code queries by keywords", () => {
    expect(detectQueryIntent("npm install express").queryType).toBe("code")
    expect(detectQueryIntent("docker compose tutorial").queryType).toBe("code")
    expect(detectQueryIntent("what is graphql").queryType).toBe("code")
  })

  test("detects currency conversion", () => {
    const r = detectQueryIntent("100 USD to CNY")
    expect(r.isCurrency).toBe(true)
    expect(r.queryType).toBe("general")
  })

  test("detects weather queries", () => {
    const r = detectQueryIntent("weather in Tokyo")
    expect(r.isWeather).toBe(true)
    expect(r.queryType).toBe("general")
  })

  test("detects Chinese weather queries", () => {
    const r1 = detectQueryIntent("北京天气")
    expect(r1.isWeather).toBe(true)
    const r2 = detectQueryIntent("明天温度多少")
    expect(r2.isWeather).toBe(true)
  })

  test("detects translation", () => {
    const r = detectQueryIntent("translate hello to french")
    expect(r.isTranslation).toBe(true)
  })

  test("detects Chinese translation queries", () => {
    const r1 = detectQueryIntent("苹果翻译成英文")
    expect(r1.isTranslation).toBe(true)
    const r2 = detectQueryIntent("hello 意思")
    expect(r2.isTranslation).toBe(true)
  })

  test("detects academic queries", () => {
    expect(detectQueryIntent("machine learning paper 2024").queryType).toBe("academic")
    expect(detectQueryIntent("doi 10.1007/s10948").queryType).toBe("academic")
  })

  test("detects news queries", () => {
    expect(detectQueryIntent("breaking news today").queryType).toBe("news")
    expect(detectQueryIntent("latest technology update").queryType).toBe("news")
  })

  test("detects Chinese news queries", () => {
    expect(detectQueryIntent("最新科技新闻").queryType).toBe("news")
    expect(detectQueryIntent("国际热点").queryType).toBe("news")
  })

  test("detects video queries", () => {
    expect(detectQueryIntent("new movie trailer").queryType).toBe("video")
  })

  test("detects Chinese video queries", () => {
    expect(detectQueryIntent("最新电影预告").queryType).toBe("video")
    expect(detectQueryIntent("B站视频").queryType).toBe("video")
  })

  test("detects shopping queries in English", () => {
    expect(detectQueryIntent("iPhone 16 price").queryType).toBe("shopping")
    expect(detectQueryIntent("buy gaming laptop").queryType).toBe("shopping")
    expect(detectQueryIntent("best price for SSD").queryType).toBe("shopping")
    expect(detectQueryIntent("discount coupon code").queryType).toBe("shopping")
    expect(detectQueryIntent("compare phone prices").queryType).toBe("shopping")
  })

  test("detects shopping queries in Chinese", () => {
    expect(detectQueryIntent("iPhone 16 价格").queryType).toBe("shopping")
    expect(detectQueryIntent("戴森吸尘器多少钱").queryType).toBe("shopping")
    expect(detectQueryIntent("机械键盘 优惠").queryType).toBe("shopping")
    expect(detectQueryIntent("空调 比价").queryType).toBe("shopping")
    expect(detectQueryIntent("笔记本电脑 性价比").queryType).toBe("shopping")
    expect(detectQueryIntent("跑步机 报价").queryType).toBe("shopping")
    expect(detectQueryIntent("耳机 促销").queryType).toBe("shopping")
    expect(detectQueryIntent("手机 值得买").queryType).toBe("shopping")
  })

  test("does not misclassify non-shopping queries as shopping", () => {
    // These queries do not contain any shopping keywords
    expect(detectQueryIntent("machine learning tutorial").queryType).toBe("code")
    expect(detectQueryIntent("history of mathematics").queryType).toBe("general")
    expect(detectQueryIntent("population of china").queryType).toBe("general")
  })

  test("defaults to general for plain queries", () => {
    expect(detectQueryIntent("best restaurants in Tokyo").queryType).toBe("general")
    expect(detectQueryIntent("history of coffee").queryType).toBe("general")
  })

  test("handles empty query", () => {
    expect(detectQueryIntent("").queryType).toBeUndefined()
  })

  test("URL queries go to general", () => {
    expect(detectQueryIntent("https://example.com/page").queryType).toBe("general")
  })
})

// ── Query Optimizer（灵感：BettaFish Keyword Optimizer）─────

describe("optimizeQuery", () => {
  test("code query gets documentation/tutorial variants", () => {
    const variants = optimizeQuery("rust sort", { queryType: "code" })
    expect(variants.length).toBeGreaterThanOrEqual(3)
    expect(variants).toContain("rust sort documentation")
    expect(variants).toContain("rust sort tutorial")
  })

  test("academic query gets paper/study variants", () => {
    const variants = optimizeQuery("machine learning", { queryType: "academic" })
    expect(variants).toContain("machine learning research paper")
    expect(variants).toContain("machine learning study")
  })

  test("news query gets latest variant", () => {
    const variants = optimizeQuery("technology", { queryType: "news" })
    expect(variants).toContain("technology latest news")
  })

  test("video query gets video variant", () => {
    const variants = optimizeQuery("cat", { queryType: "video" })
    expect(variants).toContain("cat video")
  })

  test("shopping query gets price/coupon/review variants", () => {
    const variants = optimizeQuery("iPhone", { queryType: "shopping" })
    expect(variants).toContain("iPhone 价格")
    expect(variants).toContain("iPhone 优惠")
    expect(variants).toContain("iPhone 评测")
  })

  test("translation intent gets meaning/definition variants", () => {
    const variants = optimizeQuery("hello", { queryType: "general", isTranslation: true })
    expect(variants).toContain("hello meaning")
    expect(variants).toContain("hello definition")
  })

  test("weather intent gets forecast variant", () => {
    const variants = optimizeQuery("beijing", { queryType: "general", isWeather: true })
    expect(variants).toContain("beijing weather forecast")
  })

  test("returns original query for unknown intent", () => {
    const variants = optimizeQuery("hello world", {})
    expect(variants).toEqual(["hello world"])
  })

  test("handles empty query", () => {
    expect(optimizeQuery("", {})).toEqual([""])
  })
})

// ── extractKeywords（灵感：BettaFish 的关键词提取）─────

describe("extractKeywords", () => {
  test("extracts meaningful words from English query", () => {
    const kw = extractKeywords("how to sort array in Rust")
    expect(kw).toContain("Rust")
    expect(kw).toContain("sort")
    expect(kw).toContain("array")
    // stop words removed
    expect(kw).not.toContain("how")
    expect(kw).not.toContain("to")
    expect(kw).not.toContain("in")
  })

  test("extracts meaningful words from Chinese query", () => {
    const kw = extractKeywords("最新的科技发展趋势")
    expect(kw.length).toBeGreaterThan(0)
    // stop words removed
    expect(kw).not.toContain("的")
  })

  test("filters out bad/official keywords", () => {
    const kw = extractKeywords("舆情管理未来展望")
    expect(kw).not.toContain("未来展望")
    expect(kw).not.toContain("舆情管理")
  })

  test("respects maxTokens limit", () => {
    const kw = extractKeywords("a b c d e f g h i j k l", 3)
    expect(kw.length).toBeLessThanOrEqual(3)
  })

  test("returns empty for empty query", () => {
    expect(extractKeywords("")).toEqual([])
  })

  test("removes single-character tokens", () => {
    const kw = extractKeywords("a in rust lang")
    expect(kw).not.toContain("a")
    expect(kw).not.toContain("in")
    expect(kw).toContain("rust")
  })
})
