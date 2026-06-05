/**
 * Google Traits + Google Images 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { getGoogleInfo, isGoogleCaptcha } from "../../src/search/engines/google-traits"
import { makeGoogleImages, parseGoogleImagesResults } from "../../src/search/engines/google-images"
import { makeGoogle, parseGoogleResults } from "../../src/search/engines/google"
import { makeEngineConfig } from "../../src/search/engine"

// ── Google Traits ──
describe("Google Traits", () => {
  test("getGoogleInfo returns default for no lang", () => {
    const info = getGoogleInfo()
    expect(info.subdomain).toBe("www.google.com")
    expect(info.language).toBe("lang_en")
    expect(info.params.hl).toBe("en")
  })

  test("getGoogleInfo handles zh-CN", () => {
    const info = getGoogleInfo("zh-CN")
    expect(info.country).toBe("CN")
    expect(info.subdomain).toBe("www.google.com.hk")
    expect(info.language).toBe("lang_zh-CN")
  })

  test("getGoogleInfo handles ja-JP", () => {
    const info = getGoogleInfo("ja-JP")
    expect(info.country).toBe("JP")
    expect(info.subdomain).toBe("www.google.co.jp")
    expect(info.language).toBe("lang_ja")
  })

  test("getGoogleInfo handles de-DE", () => {
    const info = getGoogleInfo("de-DE")
    expect(info.country).toBe("DE")
    expect(info.subdomain).toBe("www.google.de")
    expect(info.language).toBe("lang_de")
  })

  test("isGoogleCaptcha detects short sorry responses", () => {
    expect(isGoogleCaptcha(200, "<html>/sorry/</html>")).toBe(true)
    expect(isGoogleCaptcha(200, "normal content with /sorry/".repeat(100))).toBe(false)
    expect(isGoogleCaptcha(200, "<html>normal content</html>".repeat(200))).toBe(false)
  })

  test("isGoogleCaptcha detects 302 status", () => {
    expect(isGoogleCaptcha(302, "")).toBe(true)
    expect(isGoogleCaptcha(303, "")).toBe(true)
  })
})

// ── Google Images ──
describe("Google Images engine", () => {
  test("makeGoogleImages creates engine", () => {
    const e = makeGoogleImages(makeEngineConfig({ name: "google-images", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("google-images")
    expect(typeof e.search).toBe("function")
  })

  test("parseGoogleImagesResults extracts from JSON", () => {
    const json = `{"ischj":{"metadata":[{"result":{"referrer_url":"https://ex.com/page","page_title":"Test Image"},"original_image":{"url":"https://ex.com/img.jpg","width":800,"height":600},"thumbnail":{"url":"https://ex.com/thumb.jpg"},"text_in_grid":{"snippet":"A test image"}}]}}`
    const r = parseGoogleImagesResults(json, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Image")
    expect(r[0].url).toBe("https://ex.com/page")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseGoogleImagesResults("not json", 10)).toEqual([])
  })

  test("returns empty for missing ischj", () => {
    expect(parseGoogleImagesResults('{"data":{}}', 10)).toEqual([])
  })
})

// ── Google Web (updated with traits) ──
describe("Google Web engine", () => {
  test("makeGoogle creates engine", () => {
    const e = makeGoogle(makeEngineConfig({ name: "google", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("google")
  })

  test("parseGoogleResults extracts from HTML", () => {
    const html = `<a data-ved="0abc" href="/url?q=https://ex.com/page&sa=U&ved=0abc"><h3>Test Result</h3></a><div class="VwiC3b">Snippet</div>`
    const r = parseGoogleResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Result")
    expect(r[0].url).toBe("https://ex.com/page")
  })
})
