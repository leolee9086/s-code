/**
 * Bing Images、Sogou、360Search 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeBingImages, parseBingImagesResults } from "../../src/search/engines/bing-images"
import { makeSogou, parseSogouResults } from "../../src/search/engines/sogou"
import { make360Search, parse360Results } from "../../src/search/engines/360search"
import { makeEngineConfig } from "../../src/search/engine"

// ── Bing Images ──
describe("Bing Images engine", () => {
  test("makeBingImages creates engine", () => {
    const e = makeBingImages(makeEngineConfig({ name: "bing-images", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("bing-images")
    expect(typeof e.search).toBe("function")
  })

  test("parseBingImagesResults extracts from HTML", () => {
    const html = `<ul class="dgControl_list"><li><a class="iusc" m="{&quot;purl&quot;:&quot;https://ex.com/page&quot;,&quot;murl&quot;:&quot;https://ex.com/img.jpg&quot;,&quot;turl&quot;:&quot;https://ex.com/thumb.jpg&quot;}"><div class="infnmpt"><a>Test Image</a></div><div class="imgpt"><div><span>1920x1080 · JPEG</span></div></div></a></li></ul>`
    const r = parseBingImagesResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Image")
    expect(r[0].url).toBe("https://ex.com/page")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for no results", () => {
    expect(parseBingImagesResults("<html></html>", 10)).toEqual([])
  })

  test("ignores items without valid metadata", () => {
    const html = `<ul class="dgControl_list"><li><a class="iusc" m="invalid json"></a></li></ul>`
    expect(parseBingImagesResults(html, 10).length).toBe(0)
  })
})

// ── Sogou ──
describe("Sogou engine", () => {
  test("makeSogou creates engine", () => {
    const e = makeSogou(makeEngineConfig({ name: "sogou", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("sogou")
  })

  test("parseSogouResults parses rb blocks", () => {
    const html = `<div class="rb"><h3 class="pt"><a href="https://ex.com/1">Sogou Result 1</a></h3><div class="ft">Description 1</div><cite>2024-01-15</cite></div></div>`
    const r = parseSogouResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Sogou Result 1")
    expect(r[0].url).toBe("https://ex.com/1")
    expect(r[0].snippet).toContain("Description 1")
  })

  test("parses vrwrap blocks", () => {
    const html = `<div class="vrwrap"><h3 class="vr-title"><a href="https://ex.com/2">VR Result</a></h3><div class="ft">VR desc</div></div></div>`
    const r = parseSogouResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("VR Result")
  })

  test("skips special-wrap blocks", () => {
    const html = `<div class="vrwrap special-wrap"><h3 class="vr-title"><a href="https://ex.com/ad">Ad</a></h3></div></div>`
    expect(parseSogouResults(html, 10).length).toBe(0)
  })

  test("returns empty for empty HTML", () => {
    expect(parseSogouResults("", 10)).toEqual([])
  })

  test("handles sogou redirect URLs", () => {
    const html = `<div class="rb"><h3 class="pt"><a href="/link?url=redirect">Title</a></h3><div class="ft">desc</div><cite>2024-06-15</cite></div></div>`
    const r = parseSogouResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].url).toContain("sogou.com")
  })
})

// ── 360Search ──
describe("360Search engine", () => {
  test("make360Search creates engine", () => {
    const e = make360Search(makeEngineConfig({ name: "360search", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("360search")
  })

  test("parse360Results parses res-list blocks", () => {
    const html = `<li class="res-list"><a href="https://ex.com/1">360 Result</a><p class="res-desc">Description</p></li>`
    const r = parse360Results(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("360 Result")
    expect(r[0].url).toBe("https://ex.com/1")
    expect(r[0].snippet).toBe("Description")
  })

  test("returns empty for empty HTML", () => {
    expect(parse360Results("", 10)).toEqual([])
  })
})
