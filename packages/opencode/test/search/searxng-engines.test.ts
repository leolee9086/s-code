/**
 * SearXNG 新增引擎测试（第二批：mojeek、jisho、radio-browser 等 15 个引擎）
 */
import { describe, expect, test } from "bun:test"
import { parseMojeekResults } from "../../src/search/engines/mojeek"
import { parseJishoResults } from "../../src/search/engines/jisho"
import { parseRadioBrowserResults } from "../../src/search/engines/radio-browser"
import { parseSepiaSearchResults } from "../../src/search/engines/sepiasearch"
import { parseRepologyResults } from "../../src/search/engines/repology"
import { parseArticResults } from "../../src/search/engines/artic"
import { parseNvdResults } from "../../src/search/engines/nvd"
import { parseLocResults } from "../../src/search/engines/loc"
import { parse1xResults } from "../../src/search/engines/1x"
import { parseTootfinderResults } from "../../src/search/engines/tootfinder"
import { parseGrokipediaResults } from "../../src/search/engines/grokipedia"
import { parseFindThatMemeResults } from "../../src/search/engines/findthatmeme"
import { parseApkMirrorResults } from "../../src/search/engines/apkmirror"
import { parseFyydResults } from "../../src/search/engines/fyyd"
import { parseScanrResults } from "../../src/search/engines/scanr"

// ── Mojeek ──
describe("Mojeek engine", () => {
  test("parseMojeekResults extracts from HTML", () => {
    const html = `<a class="title" href="https://ex.com/1">Result 1</a><p class="teaser">Snippet 1</p>`
    const r = parseMojeekResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Result 1")
    expect(r[0].url).toBe("https://ex.com/1")
  })
  test("returns empty for empty HTML", () => expect(parseMojeekResults("", 10)).toEqual([]))
})

// ── Jisho ──
describe("Jisho engine", () => {
  const MOCK = JSON.stringify({
    data: [{ slug: "rust", japanese: [{ word: "錆", reading: "さび" }], senses: [{ english_definitions: ["rust", "corrosion"] }] }],
  })
  test("parses entries", () => {
    const r = parseJishoResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("錆")
    expect(r[0].url).toContain("/word/rust")
  })
  test("returns empty for invalid JSON", () => expect(parseJishoResults("bad", 10)).toEqual([]))
})

// ── Radio Browser ──
describe("Radio Browser engine", () => {
  const MOCK = JSON.stringify([{ name: "Test Radio", url: "https://stream.test", tags: "pop,rock", country: "US", codec: "MP3", bitrate: 128 }])
  test("parses stations", () => {
    const r = parseRadioBrowserResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Radio")
  })
  test("returns empty for non-array", () => expect(parseRadioBrowserResults("{}", 10)).toEqual([]))
})

// ── Sepia Search ──
describe("Sepia Search engine", () => {
  const MOCK = JSON.stringify({ data: [{ uuid: "abc", name: "Test Video", url: "https://ex.com/video", channel: { name: "Test Channel" }, duration: 120, views: 50 }] })
  test("parses videos", () => {
    const r = parseSepiaSearchResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].category).toBe("video")
  })
  test("returns empty for no data", () => expect(parseSepiaSearchResults("{}", 10)).toEqual([]))
})

// ── Repology ──
describe("Repology engine", () => {
  const MOCK = JSON.stringify({ curl: [{ repo: "main", version: "8.0.1", status: "newest", summary: "URL tool" }] })
  test("parses projects", () => {
    const r = parseRepologyResults(MOCK, "curl", 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("curl")
    expect(r[0].snippet).toContain("8.0.1")
  })
  test("returns empty for empty object", () => expect(parseRepologyResults("{}", "test", 10)).toEqual([]))
})

// ── Artic ──
describe("Artic engine", () => {
  const MOCK = JSON.stringify({ data: [{ id: 123, title: "Starry Night", artist_title: "van Gogh", date_display: "1889" }] })
  test("parses artworks", () => {
    const r = parseArticResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Starry Night")
    expect(r[0].snippet).toContain("van Gogh")
  })
  test("returns empty for no data", () => expect(parseArticResults("{}", 10)).toEqual([]))
})

// ── NVD ──
describe("NVD engine", () => {
  const MOCK = JSON.stringify({ response: [{ grid: { vulnerabilities: [{ cve: { id: "CVE-2024-1234", descriptions: [{ value: "Test vuln" }] } }] } }] })
  test("parses CVEs", () => {
    const r = parseNvdResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("CVE-2024-1234")
  })
  test("returns empty for no vulns", () => expect(parseNvdResults("{}", 10)).toEqual([]))
})

// ── LOC ──
describe("LOC engine", () => {
  const MOCK = JSON.stringify({ results: [{ title: "Photo 1", item: { link: "https://loc.gov/1" }, image_url: ["https://loc.gov/img.jpg"] }] })
  test("parses results", () => {
    const r = parseLocResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Photo 1")
  })
  test("returns empty for no results", () => expect(parseLocResults("{}", 10)).toEqual([]))
})

// ── 1x ──
describe("1x engine", () => {
  test("parses photo links", () => {
    const r = parse1xResults('<a href="/photo/123">Test Photo</a>', 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Photo")
    expect(r[0].url).toContain("1x.com")
  })
  test("returns empty for empty", () => expect(parse1xResults("", 10)).toEqual([]))
})

// ── Tootfinder ──
describe("Tootfinder engine", () => {
  const MOCK = JSON.stringify([{ url: "https://mastodon.social/@test", content: "<p>Test toot</p>", created_at: "2024-01-15 10:00:00" }])
  test("parses toots", () => {
    const r = parseTootfinderResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("Test toot")
    expect(r[0].category).toBe("social")
  })
  test("returns empty for invalid JSON", () => expect(parseTootfinderResults("bad", 10)).toEqual([]))
})

// ── Grokipedia ──
describe("Grokipedia engine", () => {
  const MOCK = JSON.stringify({ results: [{ slug: "test-page", title: "Test Page", snippet: "A test page" }] })
  test("parses results", () => {
    const r = parseGrokipediaResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Page")
  })
  test("returns empty for no results", () => expect(parseGrokipediaResults("{}", 10)).toEqual([]))
})

// ── FindThatMeme ──
describe("FindThatMeme engine", () => {
  const MOCK = JSON.stringify([{ source_page_url: "https://ex.com/meme", source_site: "MemeSite", meme_file_size: 50000 }])
  test("parses memes", () => {
    const r = parseFindThatMemeResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("MemeSite")
    expect(r[0].category).toBe("image")
  })
  test("returns empty for invalid JSON", () => expect(parseFindThatMemeResults("bad", 10)).toEqual([]))
})

// ── APKMirror ──
describe("APKMirror engine", () => {
  test("parses app rows", () => {
    const html = `<div class="appRow"><h5><a href="/app/test">TestApp</a></h5><img src="/icon.png"/></div>`
    const r = parseApkMirrorResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("TestApp")
    expect(r[0].url).toContain("apkmirror.com")
  })
  test("returns empty for empty html", () => expect(parseApkMirrorResults("", 10)).toEqual([]))
})

// ── Fyyd ──
describe("Fyyd engine", () => {
  const MOCK = JSON.stringify({ data: [{ htmlURL: "https://fyyd.de/podcast/1", title: "Test Podcast", description: "A great podcast", episode_count: 50 }] })
  test("parses podcasts", () => {
    const r = parseFyydResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Podcast")
  })
  test("returns empty for no data", () => expect(parseFyydResults("{}", 10)).toEqual([]))
})

// ── ScanR ──
describe("ScanR engine", () => {
  const MOCK = JSON.stringify({ results: [{ id: "123", label: "CNRS", highlights: [{ value: "French research org" }] }], total: 1 })
  test("parses structures", () => {
    const r = parseScanrResults(MOCK, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("CNRS")
    expect(r[0].category).toBe("academic")
  })
  test("returns empty for no results", () => expect(parseScanrResults('{"total":0}', 10)).toEqual([]))
})
