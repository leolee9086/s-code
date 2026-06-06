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

  test("includes video engines when queryType is video", () => {
    const engines = selectEngines({ queryType: "video" })
    const names = engines.map(e => e.name)
    expect(names).toContain("youtube")
    expect(names).toContain("bilibili")
    expect(names).toContain("bitchute")
    expect(names).toContain("acfun")
    expect(names).toContain("sogou-videos")
    expect(names).not.toContain("bing-news") // 非新闻
    expect(names).not.toContain("github") // 非代码
  })

  test("includes code engines when queryType is code", () => {
    const engines = selectEngines({ queryType: "code" })
    const names = engines.map(e => e.name)
    expect(names).toContain("github")
    expect(names).toContain("gitlab")
    expect(names).toContain("crates")
    expect(names).toContain("pypi-html")
    expect(names).toContain("gitea")
    expect(names).toContain("sourcehut")
    expect(names).not.toContain("youtube") // 非视频
  })

  test("includes academic engines when queryType is academic", () => {
    const engines = selectEngines({ queryType: "academic" })
    const names = engines.map(e => e.name)
    expect(names).toContain("arxiv")
    expect(names).toContain("wikipedia")
    expect(names).toContain("semantic-scholar")
    expect(names).not.toContain("youtube")
  })

  test("includes social engines when queryType is social", () => {
    const engines = selectEngines({ queryType: "social" })
    const names = engines.map(e => e.name)
    expect(names).toContain("mastodon")
    expect(names).toContain("lemmy")
    expect(names).toContain("discourse")
    expect(names).toContain("boardreader")
  })

  test("brave flag enables brave engine", () => {
    const engines = selectEngines({ brave: true })
    const names = engines.map(e => e.name)
    expect(names).toContain("brave")
  })

  test("bilibili flag enables bilibili engine", () => {
    const engines = selectEngines({ bilibili: true })
    const names = engines.map(e => e.name)
    expect(names).toContain("bilibili")
  })

  test("xiaohongshu and zhihu flags enable scoped engines", () => {
    const engines = selectEngines({ xiaohongshu: true, zhihu: true })
    const names = engines.map(e => e.name)
    expect(names).toContain("xiaohongshu")
    expect(names).toContain("zhihu")
  })

  test("includes recently-added translation engines when no flags", () => {
    const engines = selectEngines()
    const names = engines.map(e => e.name)
    expect(names).toContain("lingva")
    expect(names).toContain("libretranslate")
    expect(names).toContain("deepl")
  })

  test("includes recently-added image engines when no flags", () => {
    const engines = selectEngines()
    const names = engines.map(e => e.name)
    expect(names).toContain("tineye")
    expect(names).toContain("adobe-stock")
  })

  test("includes yandex-music when no flags", () => {
    const engines = selectEngines()
    const names = engines.map(e => e.name)
    expect(names).toContain("yandex-music")
  })

  test("includes academic engines (pdbe) when no flags", () => {
    const engines = selectEngines()
    const names = engines.map(e => e.name)
    expect(names).toContain("pdbe")
    expect(names).toContain("microsoft-learn")
  })
})
