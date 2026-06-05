/**
 * Google + Yandex 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeGoogle, parseGoogleResults } from "../../src/search/engines/google"
import { makeYandex, parseYandexResults } from "../../src/search/engines/yandex"
import { makeEngineConfig } from "../../src/search/engine"

// ── Google ──
describe("Google engine", () => {
  test("makeGoogle creates engine", () => {
    const e = makeGoogle(makeEngineConfig({ name: "google", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("google")
    expect(typeof e.search).toBe("function")
  })

  test("parseGoogleResults extracts from HTML", () => {
    const html = `<a data-ved="0abc" href="/url?q=https://example.com/page&sa=U&ved=0abc"><h3>Test Result</h3></a><div class="VwiC3b">Test snippet here</div>`
    const r = parseGoogleResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Result")
    expect(r[0].url).toBe("https://example.com/page")
    expect(r[0].snippet).toContain("Test snippet")
    expect(r[0].engine).toBe("google")
  })

  test("cleans Google tracking params from URL", () => {
    const html = `<a data-ved="0abc" href="/url?q=https://example.com/page&sa=U&ved=0abc"><h3>Title</h3></a>`
    const r = parseGoogleResults(html, 10)
    expect(r[0].url).toBe("https://example.com/page")
    expect(r[0].url).not.toContain("sa=U")
  })

  test("returns empty for empty HTML", () => {
    expect(parseGoogleResults("", 10)).toEqual([])
  })

  test("returns empty for no results", () => {
    expect(parseGoogleResults("<html></html>", 10)).toEqual([])
  })
})

// ── Yandex ──
describe("Yandex engine", () => {
  test("makeYandex creates engine", () => {
    const e = makeYandex(makeEngineConfig({ name: "yandex", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("yandex")
    expect(typeof e.search).toBe("function")
  })

  test("parseYandexResults extracts from HTML", () => {
    const html = `<li class="serp-item"><a class="b-serp-item__title-link" href="https://yandex.com/result"><span>Yandex Result</span></a><div class="b-serp-item__text">Yandex description</div></li>`
    const r = parseYandexResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Yandex Result")
    expect(r[0].url).toBe("https://yandex.com/result")
    expect(r[0].snippet).toContain("Yandex description")
    expect(r[0].engine).toBe("yandex")
  })

  test("returns empty for empty HTML", () => {
    expect(parseYandexResults("", 10)).toEqual([])
  })

  test("skips items without title", () => {
    const html = `<li class="serp-item"><a class="b-serp-item__title-link" href="https://ex.com"></a></li>`
    expect(parseYandexResults(html, 10).length).toBe(0)
  })
})
