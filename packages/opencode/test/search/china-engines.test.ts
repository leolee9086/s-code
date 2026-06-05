/**
 * 豆瓣 + 微博 直连引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeDouban, parseDoubanResults } from "../../src/search/engines/douban"
import { makeWeibo, parseWeiboResults } from "../../src/search/engines/weibo"
import { makeEngineConfig } from "../../src/search/engine"

describe("Douban engine", () => {
  test("creates engine", () => {
    const e = makeDouban(makeEngineConfig({ name: "douban", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("douban")
  })

  test("parseDoubanResults extracts results", () => {
    const html = `<div class="result"><div class="title"><a href="https://movie.douban.com/1">豆瓣测试</a></div></div>`
    const r = parseDoubanResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("豆瓣测试")
    expect(r[0].url).toContain("douban.com")
  })

  test("returns empty for empty HTML", () => expect(parseDoubanResults("", 10)).toEqual([]))
})

describe("Weibo engine", () => {
  test("creates engine", () => {
    const e = makeWeibo(makeEngineConfig({ name: "weibo", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("weibo")
  })

  test("parseWeiboResults extracts results", () => {
    const html = `<div class="card-wrap"><div class="card"><p class="txt"><a href="//weibo.com/1">微博测试</a></p></div></div>`
    const r = parseWeiboResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("微博测试")
    expect(r[0].url).toContain("https://weibo.com/1")
    expect(r[0].category).toBe("social")
  })

  test("returns empty for empty HTML", () => expect(parseWeiboResults("", 10)).toEqual([]))
})
