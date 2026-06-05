/**
 * 引擎选择器测试
 */
import { describe, expect, test } from "bun:test"
import { selectEngines } from "../../src/search/selector"

describe("selectEngines", () => {
  test("always includes duckduckgo and bing", () => {
    const engines = selectEngines({})
    const names = engines.map(e => e.name)
    expect(names).toContain("duckduckgo")
    expect(names).toContain("bing")
  })

  test("includes bing-news when queryType is news", () => {
    const engines = selectEngines({ queryType: "news" })
    const names = engines.map(e => e.name)
    expect(names).toContain("bing-news")
  })

  test("includes xiaohongshu and zhihu when flags set", () => {
    const engines = selectEngines({ xiaohongshu: true, zhihu: true })
    const names = engines.map(e => e.name)
    expect(names).toContain("xiaohongshu")
    expect(names).toContain("zhihu")
  })
})
