/**
 * 近期新增搜索引擎适配器测试
 * 测试 deepl、adobe-stock、tineye、yandex-music、lingva、libretranslate
 */
import { describe, expect, test } from "bun:test"
import { makeEngineConfig } from "../../src/search/engine"
import { parseDeepLApiResults } from "../../src/search/engines/deepl"
import { parseAdobeStockResults } from "../../src/search/engines/adobe-stock"
import { parseTinEyeResults } from "../../src/search/engines/tineye"
import { parseYandexMusicResults } from "../../src/search/engines/yandex-music"
import { parseLingvaResults } from "../../src/search/engines/lingva"
import { parseLibreTranslateResults } from "../../src/search/engines/libretranslate"
import { parseBraveResults } from "../../src/search/engines/brave"
import { parseYouTubeResults, getTimeRangeParam } from "../../src/search/engines/youtube"
import { parseHtmlResults, parseLiteResults, langToKl, timeRangeToDf } from "../../src/search/engines/duckduckgo"

// ── DeepL ──
describe("DeepL engine", () => {
  test("parseDeepLApiResults extracts translations", () => {
    const raw = JSON.stringify({
      translations: [{ text: "Hola mundo", detected_source_language: "EN" }],
    })
    const r = parseDeepLApiResults(raw, "Hello world", "ES")
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("Hello world → Hola mundo")
    expect(r[0].snippet).toContain("EN → ES")
    expect(r[0].engine).toBe("deepl")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseDeepLApiResults("invalid json", "test", "ZH")).toEqual([])
  })

  test("returns empty for missing translations", () => {
    expect(parseDeepLApiResults('{"something": "else"}', "test", "ZH")).toEqual([])
  })

  test("returns empty for empty translations array", () => {
    expect(parseDeepLApiResults('{"translations": []}', "test", "ZH")).toEqual([])
  })
})

// ── Adobe Stock ──
describe("Adobe Stock engine", () => {
  test("parseAdobeStockResults extracts items from JSON", () => {
    const raw = JSON.stringify({
      items: {
        "0": {
          title: "Beautiful Sunset",
          content_url: "https://stock.adobe.com/images/beautiful-sunset/123",
          thumbnail_url: "https://thumb.jpg",
          content_thumb_extra_large_url: "https://thumb-xl.jpg",
          content_original_width: 1920,
          content_original_height: 1080,
          format: "JPG",
          author: "John Doe",
          asset_type: "photo",
        },
      },
    })
    const r = parseAdobeStockResults(raw, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Beautiful Sunset")
    expect(r[0].url).toBe("https://stock.adobe.com/images/beautiful-sunset/123")
    expect(r[0].snippet).toContain("photo")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseAdobeStockResults("not json", 10)).toEqual([])
  })

  test("returns empty for null items", () => {
    expect(parseAdobeStockResults('{"items": null}', 10)).toEqual([])
  })

  test("skips items without title", () => {
    const raw = JSON.stringify({
      items: {
        "0": { content_url: "https://example.com/img.jpg" },
      },
    })
    expect(parseAdobeStockResults(raw, 10).length).toBe(0)
  })
})

// ── TinEye ──
describe("TinEye engine", () => {
  test("parseTinEyeResults extracts matches", () => {
    const raw = JSON.stringify({
      matches: [
        {
          image_url: "https://example.com/img.jpg",
          domain: "example.com",
          score: 85.5,
          width: 800,
          height: 600,
          backlinks: [
            { url: "https://example.com/", backlink: "https://example.com/page", crawl_date: "2024-01-01" },
          ],
        },
      ],
    })
    const r = parseTinEyeResults(raw, 10)
    expect(r.length).toBe(1)
    expect(r[0].url).toBe("https://example.com/page")
    expect(r[0].snippet).toContain("Found on example.com")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseTinEyeResults("bad", 10)).toEqual([])
  })

  test("returns empty for missing matches", () => {
    expect(parseTinEyeResults('{"no_matches": true}', 10)).toEqual([])
  })

  test("skips matches without backlinks", () => {
    const raw = JSON.stringify({
      matches: [
        {
          image_url: "https://example.com/img.jpg",
          score: 50,
          backlinks: [],
        },
      ],
    })
    expect(parseTinEyeResults(raw, 10).length).toBe(0)
  })
})

// ── Yandex Music ──
describe("Yandex Music engine", () => {
  test("parseYandexMusicResults extracts tracks", () => {
    const raw = JSON.stringify({
      tracks: {
        items: [
          {
            id: 12345,
            title: "Test Song",
            type: "music",
            albums: [{ id: 678, title: "Test Album" }],
            artists: [{ name: "Test Artist" }],
          },
        ],
      },
    })
    const r = parseYandexMusicResults(raw, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Song")
    expect(r[0].url).toContain("/album/678/track/12345")
    expect(r[0].snippet).toContain("Test Album")
    expect(r[0].category).toBe("music")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseYandexMusicResults("bad", 10)).toEqual([])
  })

  test("returns empty for missing tracks", () => {
    expect(parseYandexMusicResults('{"tracks": {}}', 10)).toEqual([])
  })

  test("filters out non-music type items", () => {
    const raw = JSON.stringify({
      tracks: {
        items: [
          { id: 1, title: "Artist", type: "artist" },
          { id: 2, title: "Song", type: "music", albums: [{ id: 1 }], artists: [{ name: "A" }] },
        ],
      },
    })
    const r = parseYandexMusicResults(raw, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Song")
  })
})

// ── Lingva ──
describe("Lingva engine", () => {
  test("parseLingvaResults extracts translation", () => {
    const raw = JSON.stringify({
      translation: "bonjour",
    })
    const r = parseLingvaResults(raw, "hello", "en", "fr")
    expect(r.length).toBeGreaterThanOrEqual(1)
    expect(r[0].title).toContain("hello → bonjour")
    expect(r[0].snippet).toContain("en → fr")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseLingvaResults("bad", "test", "en", "fr")).toEqual([])
  })

  test("returns empty for missing translation", () => {
    expect(parseLingvaResults('{"error": "not found"}', "test", "en", "fr")).toEqual([])
  })
})

// ── LibreTranslate ──
describe("LibreTranslate engine", () => {
  test("parseLibreTranslateResults extracts translation", () => {
    const raw = JSON.stringify({
      translatedText: "bonjour",
      alternatives: ["salut", "coucou"],
    })
    const r = parseLibreTranslateResults(raw, "hello", "en", "fr")
    expect(r.length).toBeGreaterThanOrEqual(1)
    expect(r[0].title).toContain("hello → bonjour")
    expect(r[0].snippet).toContain("en → fr")

    // Should include alternatives
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r[1].title).toContain("Alternative")
  })

  test("returns empty for invalid JSON", () => {
    expect(parseLibreTranslateResults("bad", "test", "en", "fr")).toEqual([])
  })

  test("returns empty for missing translation", () => {
    expect(parseLibreTranslateResults('{"error": "not found"}', "test", "en", "fr")).toEqual([])
  })
})

// ── Brave Search ──
describe("Brave engine", () => {
  test("parseBraveResults extracts web results", () => {
    const raw = JSON.stringify({
      web: {
        results: [
          { title: "Result 1", url: "https://example.com/1", description: "First result" },
          { title: "Result 2", url: "https://example.com/2", description: "Second result" },
        ],
      },
    })
    const r = parseBraveResults(raw)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Result 1")
    expect(r[0].url).toBe("https://example.com/1")
    expect(r[0].snippet).toBe("First result")
    expect(r[0].category).toBe("general")
    expect(r[1].position).toBe(2)
  })

  test("returns empty for invalid JSON", () => {
    expect(parseBraveResults("bad json")).toEqual([])
  })

  test("returns empty for empty results", () => {
    expect(parseBraveResults('{"web": {"results": []}}')).toEqual([])
  })

  test("handles missing web field gracefully", () => {
    expect(parseBraveResults('{}')).toEqual([])
  })

  test("falls back to top-level results array", () => {
    const raw = JSON.stringify({
      results: [
        { title: "Fallback", url: "https://example.com/f", snippet: "desc" },
      ],
    })
    const r = parseBraveResults(raw)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Fallback")
  })
})

// ── YouTube ──
describe("YouTube engine", () => {
  test("getTimeRangeParam returns correct params", () => {
    expect(getTimeRangeParam("day")).toBe("EgIIBQ%3D%3D")
    expect(getTimeRangeParam("week")).toBe("EgIIBA%3D%3D")
    expect(getTimeRangeParam("month")).toBe("EgIIAw%3D%3D")
    expect(getTimeRangeParam("year")).toBe("EgIIAg%3D%3D")
    expect(getTimeRangeParam()).toBe("")
    expect(getTimeRangeParam("invalid" as any)).toBe("")
  })

  test("parseYouTubeResults extracts from ytInitialData JSON", () => {
    const mockData = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: [{
                    videoRenderer: {
                      videoId: "abc123",
                      title: { runs: [{ text: "Test Video" }] },
                      ownerText: { runs: [{ text: "Test Channel" }] },
                      viewCountText: { simpleText: "10K views" },
                      publishedTimeText: { simpleText: "1 year ago" },
                      lengthText: { simpleText: "5:30" },
                    },
                  }],
                },
              }],
            },
          },
        },
      },
    }
    const html = `<html><script>var ytInitialData = ${JSON.stringify(mockData)};</script></html>`
    const r = parseYouTubeResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].url).toBe("https://www.youtube.com/watch?v=abc123")
    expect(r[0].snippet).toContain("Test Channel")
    expect(r[0].snippet).toContain("10K views")
    expect(r[0].category).toBe("video")
  })

  test("returns empty for empty HTML", () => {
    expect(parseYouTubeResults("", 10)).toEqual([])
  })

  test("returns empty for HTML without video data", () => {
    expect(parseYouTubeResults("<html><body>no results</body></html>", 10)).toEqual([])
  })

  test("falls back to HTML parsing when ytInitialData missing", () => {
    // Only the HTML regex fallback path
    // The regex looks for /watch?v=VIDEO_ID
    const html = `<a href="/watch?v=abc123def45" aria-label="HTML Video Title"></a>`
    const r = parseYouTubeResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("HTML Video Title")
    expect(r[0].url).toContain("abc123def45")
  })

  test("deduplicates video IDs from HTML parsing", () => {
    const html = `<a href="/watch?v=abc123def45" aria-label="Video 1"></a><a href="/watch?v=abc123def45" aria-label="Video 1 dup"></a>`
    const r = parseYouTubeResults(html, 10)
    expect(r.length).toBe(1)
  })

  test("respects maxResults limit", () => {
    const mockData = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: Array.from({ length: 5 }, (_, i) => ({
                    videoRenderer: {
                      videoId: `id${i}`,
                      title: { runs: [{ text: `Video ${i}` }] },
                      ownerText: { runs: [{ text: "Ch" }] },
                    },
                  })),
                },
              }],
            },
          },
        },
      },
    }
    const html = `<script>var ytInitialData = ${JSON.stringify(mockData)};</script>`
    const r = parseYouTubeResults(html, 3)
    expect(r.length).toBe(3)
  })
})

// ── DuckDuckGo ──
describe("DuckDuckGo engine", () => {
  test("langToKl maps language codes correctly", () => {
    expect(langToKl("zh-CN")).toBe("cn-zh")
    expect(langToKl("en")).toBe("us-en")
    expect(langToKl("ja")).toBe("jp-jp")
    expect(langToKl()).toBe("wt-wt")
    expect(langToKl("fr")).toBe("fr-fr")
  })

  test("timeRangeToDf maps correctly", () => {
    expect(timeRangeToDf("day")).toBe("d")
    expect(timeRangeToDf("week")).toBe("w")
    expect(timeRangeToDf("month")).toBe("m")
    expect(timeRangeToDf("year")).toBe("y")
    expect(timeRangeToDf()).toBe("")
  })

  test("parseLiteResults extracts from table HTML", () => {
    const html = `<tr><a href="https://example.com/1">Result 1</a><td class="snippet">Desc 1</td></tr>`
    const r = parseLiteResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Result 1")
    expect(r[0].url).toBe("https://example.com/1")
    expect(r[0].snippet).toBe("Desc 1")
  })

  test("parseLiteResults returns empty for empty HTML", () => {
    expect(parseLiteResults("", 10)).toEqual([])
  })

  test("parseHtmlResults extracts from result divs", () => {
    const html = `<div class="result"><a class="result__a" href="https://example.com/1">Title 1</a><a class="result__snippet">Some snippet</a></div>`
    const r = parseHtmlResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Title 1")
    expect(r[0].url).toBe("https://example.com/1")
  })

  test("parseHtmlResults returns empty for empty HTML", () => {
    expect(parseHtmlResults("", 10)).toEqual([])
  })

  test("parseHtmlResults handles nested result divs correctly", () => {
    // Only top-level result divs should be counted
    const html = `<div class="results"><div class="result"><a class="result__a" href="https://ex.com/1">Title 1</a></div></div>`
    const r = parseHtmlResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Title 1")
  })
})
