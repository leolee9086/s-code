/**
 * 新搜索引擎适配器测试
 * 测试本轮新增的 6 个引擎：ArchLinux, AlpineLinux, VoidLinux, Open-Meteo, Lemmy, Discourse
 */
import { describe, expect, test } from "bun:test"
import { makeEngineConfig } from "../../src/search/engine"
import { makeArchLinux, parseArchLinuxResults } from "../../src/search/engines/archlinux"
import { makeAlpineLinux, parseAlpineLinuxResults } from "../../src/search/engines/alpinelinux"
import { makeVoidLinux, parseVoidLinuxResults } from "../../src/search/engines/voidlinux"
import { makeOpenMeteo, parseOpenMeteoResults } from "../../src/search/engines/open-meteo"
import { makeLemmy, parseLemmyResults } from "../../src/search/engines/lemmy"
import { makeDiscourse, parseDiscourseResults } from "../../src/search/engines/discourse"

describe("ArchLinux engine", () => {
  test("makeArchLinux creates engine", () => {
    const e = makeArchLinux(makeEngineConfig({ name: "archlinux", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("archlinux")
    expect(typeof e.search).toBe("function")
  })

  test("parseArchLinuxResults extracts items from HTML", () => {
    const html = `<li class="mw-search-result"><div class="mw-search-result-heading"><a href="/wiki/Linux" title="Linux">Linux</a></div><div class="searchresult">A free and open-source operating system</div></li>`
    const r = parseArchLinuxResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Linux")
    expect(r[0].url).toContain("wiki.archlinux.org")
    expect(r[0].category).toBe("code")
  })

  test("returns empty for empty HTML", () => expect(parseArchLinuxResults("", 10)).toEqual([]))

  test("returns empty for HTML without results", () => {
    const html = `<html><body><p>No results found</p></body></html>`
    expect(parseArchLinuxResults(html, 10)).toEqual([])
  })
})

describe("AlpineLinux engine", () => {
  test("makeAlpineLinux creates engine", () => {
    const e = makeAlpineLinux(makeEngineConfig({ name: "alpinelinux", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("alpinelinux")
    expect(typeof e.search).toBe("function")
  })

  test("parseAlpineLinuxResults extracts items from HTML", () => {
    const html = `<tr><td class="package"><a href="/packages/package/curl">curl</a></td><td class="version">8.0.1</td></tr>`
    const r = parseAlpineLinuxResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("curl")
    expect(r[0].title).toContain("8.0.1")
    expect(r[0].url).toContain("pkgs.alpinelinux.org")
    expect(r[0].category).toBe("code")
  })

  test("returns empty for empty HTML", () => expect(parseAlpineLinuxResults("", 10)).toEqual([]))
})

describe("VoidLinux engine", () => {
  test("makeVoidLinux creates engine", () => {
    const e = makeVoidLinux(makeEngineConfig({ name: "voidlinux", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("voidlinux")
    expect(typeof e.search).toBe("function")
  })

  test("parseVoidLinuxResults extracts items from JSON", () => {
    const json = JSON.stringify({
      data: [
        { name: "curl", short_desc: "URL transfer utility", version: "8.0.1", revision: "1", repository: "main" },
        { name: "git", short_desc: "Distributed version control", version: "2.40.0", revision: "1", repository: "main" },
      ],
    })
    const r = parseVoidLinuxResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("curl")
    expect(r[0].url).toContain("github.com/void-linux")
    expect(r[0].snippet).toContain("URL transfer utility")
    expect(r[0].category).toBe("code")
  })

  test("merges packages with same URL", () => {
    const json = JSON.stringify({
      data: [
        { name: "libfoo", short_desc: "Library", version: "1.0", revision: "1", repository: "main" },
        { name: "libfoo-32bit", short_desc: "32-bit library", version: "1.0", revision: "1", repository: "multilib" },
      ],
    })
    const r = parseVoidLinuxResults(json, 10)
    expect(r.length).toBe(1) // 合并为一条
    expect(r[0].title).toContain("libfoo")
    expect(r[0].title).toContain("libfoo-32bit")
  })

  test("returns empty for empty JSON", () => expect(parseVoidLinuxResults("{}", 10)).toEqual([]))
  test("returns empty for invalid JSON", () => expect(parseVoidLinuxResults("bad", 10)).toEqual([]))
})

describe("OpenMeteo engine", () => {
  test("makeOpenMeteo creates engine", () => {
    const e = makeOpenMeteo(makeEngineConfig({ name: "open-meteo", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("open-meteo")
    expect(typeof e.search).toBe("function")
  })

  test("parseOpenMeteoResults extracts weather info", () => {
    const json = JSON.stringify({
      current: {
        temperature_2m: 22.5,
        apparent_temperature: 20.1,
        relative_humidity_2m: 65,
        weather_code: 2,
        wind_speed_10m: 12.3,
      },
    })
    const r = parseOpenMeteoResults(json, "Beijing", 5)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("Beijing")
    expect(r[0].title).toContain("22.5")
    expect(r[0].category).toBe("weather")
    expect(r[0].snippet).toContain("Partly cloudy")
    expect(r[0].snippet).toContain("Humidity: 65%")
  })

  test("returns empty for missing current data", () => expect(parseOpenMeteoResults("{}", "Test", 5)).toEqual([]))
  test("returns empty for invalid JSON", () => expect(parseOpenMeteoResults("bad", "Test", 5)).toEqual([]))
})

describe("Lemmy engine", () => {
  test("makeLemmy creates engine", () => {
    const e = makeLemmy(makeEngineConfig({ name: "lemmy", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("lemmy")
    expect(typeof e.search).toBe("function")
  })

  test("parseLemmyResults extracts items from JSON", () => {
    const json = JSON.stringify({
      posts: [
        {
          post: { ap_id: "https://lemmy.ml/post/1", name: "Test Post", body: "Test body", published: "2024-01-15T10:00:00Z" },
          creator: { name: "user1", display_name: "User One" },
          community: { title: "testcommunity" },
          counts: { upvotes: 42, downvotes: 3, comments: 7 },
        },
      ],
    })
    const r = parseLemmyResults(json, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Post")
    expect(r[0].url).toBe("https://lemmy.ml/post/1")
    expect(r[0].category).toBe("social")
    expect(r[0].publishedDate).toBeDefined()
    expect(r[0].snippet).toContain("User One")
    expect(r[0].snippet).toContain("▲42")
  })

  test("returns empty for empty posts", () => expect(parseLemmyResults(JSON.stringify({}), 10)).toEqual([]))
  test("returns empty for invalid JSON", () => expect(parseLemmyResults("bad", 10)).toEqual([]))
})

describe("Discourse engine", () => {
  test("makeDiscourse creates engine", () => {
    const e = makeDiscourse(makeEngineConfig({ name: "discourse", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("discourse")
    expect(typeof e.search).toBe("function")
  })

  test("parseDiscourseResults extracts items from JSON", () => {
    const json = JSON.stringify({
      topics: [{ id: 100, title: "Test Topic", posts_count: 5, created_at: "2024-01-15T10:00:00Z", closed: false }],
      posts: [
        { id: 500, topic_id: 100, username: "testuser", blurb: "This is a test post with useful content" },
      ],
    })
    const r = parseDiscourseResults(json, 10, "https://meta.discourse.org")
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Topic")
    expect(r[0].url).toBe("https://meta.discourse.org/p/500")
    expect(r[0].category).toBe("social")
    expect(r[0].snippet).toContain("test post")
  })

  test("parseDiscourseResults shows answered status", () => {
    const json = JSON.stringify({
      topics: [{ id: 100, title: "Answered Topic", posts_count: 3, has_accepted_answer: true }],
      posts: [{ id: 1, topic_id: 100, username: "helper" }],
    })
    const r = parseDiscourseResults(json, 10, "https://example.com")
    expect(r.length).toBe(1)
    expect(r[0].snippet).toContain("answered")
  })

  test("returns empty for empty posts", () => expect(parseDiscourseResults(JSON.stringify({}), 10, "https://ex.com")).toEqual([]))
  test("returns empty for invalid JSON", () => expect(parseDiscourseResults("bad", 10, "https://ex.com")).toEqual([]))
})

describe("CurrencyConvert engine", () => {
  test("makeCurrencyConvert creates engine", () => {
    const { makeCurrencyConvert } = require("../../src/search/engines/currency-convert")
    const e = makeCurrencyConvert(makeEngineConfig({ name: "currency-convert", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("currency-convert")
    expect(typeof e.search).toBe("function")
  })

  test("parseCurrencyResults extracts from JSONP", () => {
    const { parseCurrencyResults } = require("../../src/search/engines/currency-convert")
    const jsonp = `ddg_spice_currency_callback({"to":[{"mid":0.1402,"fq":"1 USD = 0.1402 CNY"}]})`
    const r = parseCurrencyResults(jsonp, "100 USD", "USD", "CNY", 100)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("USD")
    expect(r[0].title).toContain("CNY")
    expect(r[0].snippet).toContain("100 USD = 14.02 CNY")
    expect(r[0].category).toBe("general")
  })

  test("returns empty for invalid JSONP", () => {
    const { parseCurrencyResults } = require("../../src/search/engines/currency-convert")
    expect(parseCurrencyResults("invalid", "1 USD", "USD", "CNY")).toEqual([])
  })

  test("returns empty for missing rate data", () => {
    const { parseCurrencyResults } = require("../../src/search/engines/currency-convert")
    expect(parseCurrencyResults("{}", "1 USD", "USD", "CNY")).toEqual([])
  })
})

describe("Gitea engine", () => {
  test("makeGitea creates engine", () => {
    const { makeGitea } = require("../../src/search/engines/gitea")
    const e = makeGitea(makeEngineConfig({ name: "gitea", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("gitea")
    expect(typeof e.search).toBe("function")
  })

  test("parseGiteaResults extracts items from JSON", () => {
    const { parseGiteaResults } = require("../../src/search/engines/gitea")
    const json = JSON.stringify({
      data: [
        { id: 1, full_name: "user/repo1", description: "A test repo", stars_count: 42, forks_count: 7, language: "TypeScript", html_url: "https://gitea.com/user/repo1" },
        { id: 2, full_name: "user/repo2", description: "Another repo", stars_count: 10, forks_count: 2, language: "Go" },
      ],
    })
    const r = parseGiteaResults(json, 10, "https://gitea.com")
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("user/repo1")
    expect(r[0].url).toBe("https://gitea.com/user/repo1")
    expect(r[0].snippet).toContain("TypeScript")
    expect(r[0].snippet).toContain("★42")
    expect(r[0].category).toBe("code")
  })

  test("returns empty for empty data", () => {
    const { parseGiteaResults } = require("../../src/search/engines/gitea")
    expect(parseGiteaResults("{}", 10, "https://gitea.com")).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parseGiteaResults } = require("../../src/search/engines/gitea")
    expect(parseGiteaResults("bad", 10, "https://gitea.com")).toEqual([])
  })
})

describe("SourceHut engine", () => {
  test("makeSourceHut creates engine", () => {
    const { makeSourceHut } = require("../../src/search/engines/sourcehut")
    const e = makeSourceHut(makeEngineConfig({ name: "sourcehut", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("sourcehut")
    expect(typeof e.search).toBe("function")
  })

  test("parseSourceHutResults extracts items from HTML", () => {
    const { parseSourceHutResults } = require("../../src/search/engines/sourcehut")
    const html = `<div class="event-list"><div class="event"><h4><a href="/~user1">~user1</a> <a href="/~user1/myproject">myproject</a></h4><p>A cool project</p><div class="tags"><a>#cli</a><a>#rust</a></div></div></div>`
    const r = parseSourceHutResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("~user1/myproject")
    expect(r[0].url).toBe("https://sr.ht/~user1/myproject")
    expect(r[0].snippet).toContain("cli")
    expect(r[0].snippet).toContain("rust")
    expect(r[0].snippet).toContain("cool project")
    expect(r[0].category).toBe("code")
  })

  test("returns empty for empty HTML", () => {
    const { parseSourceHutResults } = require("../../src/search/engines/sourcehut")
    expect(parseSourceHutResults("", 10)).toEqual([])
  })

  test("returns empty for HTML without projects", () => {
    const { parseSourceHutResults } = require("../../src/search/engines/sourcehut")
    expect(parseSourceHutResults("<html><body>No projects</body></html>", 10)).toEqual([])
  })
})

describe("Dictzone engine", () => {
  test("makeDictzone creates engine", () => {
    const { makeDictzone } = require("../../src/search/engines/dictzone")
    const e = makeDictzone(makeEngineConfig({ name: "dictzone", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("dictzone")
    expect(typeof e.search).toBe("function")
  })

  test("parseDictzoneResults extracts translations from HTML", () => {
    const { parseDictzoneResults } = require("../../src/search/engines/dictzone")
    const html = `<table id="r"><tr><td class="e">Haus</td><td class="t"><p>house</p><p>home</p></td></tr><tr><td class="e">Hausarbeit</td><td class="t"><p>housework</p></td></tr></table>`
    const r = parseDictzoneResults(html, 10, "Haus", "german", "english")
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("german to english")
    expect(r[0].snippet).toContain("Haus")
    expect(r[0].snippet).toContain("house")
    expect(r[0].snippet).toContain("home")
    expect(r[0].category).toBe("general")
  })

  test("returns empty for empty HTML", () => {
    const { parseDictzoneResults } = require("../../src/search/engines/dictzone")
    expect(parseDictzoneResults("", 10, "test", "en", "de")).toEqual([])
  })

  test("returns empty for HTML without results", () => {
    const { parseDictzoneResults } = require("../../src/search/engines/dictzone")
    expect(parseDictzoneResults("<html><body>No results</body></html>", 10, "test", "en", "de")).toEqual([])
  })
})

describe("Duden engine", () => {
  test("makeDuden creates engine", () => {
    const { makeDuden } = require("../../src/search/engines/duden")
    const e = makeDuden(makeEngineConfig({ name: "duden", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("duden")
    expect(typeof e.search).toBe("function")
  })

  test("parseDudenResults extracts items from HTML", () => {
    const { parseDudenResults } = require("../../src/search/engines/duden")
    const html = `<section><h2><a href="/rechtschreibung/Haus">Haus</a></h2><p>Gebäude für Wohn- und Geschäftszwecke</p></section><section><h2><a href="/rechtschreibung/Hausarzt">Hausarzt</a></h2><p>niedergelassener Arzt</p></section>`
    const r = parseDudenResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Haus")
    expect(r[0].url).toContain("duden.de/rechtschreibung/Haus")
    expect(r[0].snippet).toContain("Gebäude")
    expect(r[0].category).toBe("general")
  })

  test("returns empty for empty HTML", () => {
    const { parseDudenResults } = require("../../src/search/engines/duden")
    expect(parseDudenResults("", 10)).toEqual([])
  })

  test("returns empty for HTML without results", () => {
    const { parseDudenResults } = require("../../src/search/engines/duden")
    expect(parseDudenResults("<html><body>NotFound</body></html>", 10)).toEqual([])
  })
})

describe("Bitchute engine", () => {
  test("makeBitchute creates engine", () => {
    const { makeBitchute } = require("../../src/search/engines/bitchute")
    const e = makeBitchute(makeEngineConfig({ name: "bitchute", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("bitchute")
    expect(typeof e.search).toBe("function")
  })

  test("parseBitchuteResults extracts items from JSON", () => {
    const { parseBitchuteResults } = require("../../src/search/engines/bitchute")
    const json = JSON.stringify({
      videos: [
        { video_id: "abc123", video_name: "Test Video", description: "A test video", duration: "10:30", view_count: 1500, thumbnail_url: "https://ex.com/thumb.jpg", date_published: "2024-01-15T10:00:00.000Z", channel: { channel_name: "TestChannel" } },
        { video_id: "def456", video_name: "Second Video", description: "Another video", channel: { channel_name: "TestChannel" } },
      ],
    })
    const r = parseBitchuteResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].url).toContain("bitchute.com/video/abc123")
    expect(r[0].snippet).toContain("TestChannel")
    expect(r[0].snippet).toContain("1500 views")
    expect(r[0].category).toBe("video")
    expect(r[0].publishedDate).toBeDefined()
  })

  test("returns empty for empty videos", () => {
    const { parseBitchuteResults } = require("../../src/search/engines/bitchute")
    expect(parseBitchuteResults("{}", 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parseBitchuteResults } = require("../../src/search/engines/bitchute")
    expect(parseBitchuteResults("bad", 10)).toEqual([])
  })
})

describe("AcFun engine", () => {
  test("makeAcfun creates engine", () => {
    const { makeAcfun } = require("../../src/search/engines/acfun")
    const e = makeAcfun(makeEngineConfig({ name: "acfun", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("acfun")
    expect(typeof e.search).toBe("function")
  })

  test("parseAcfunResults extracts items from HTML with bigPipe data", () => {
    const { parseAcfunResults } = require("../../src/search/engines/acfun")
    const html = `<script>bigPipe.onPageletArrive({"html":"<div class=\\"search-video\\" data-exposure-log='{\\"content_id\\":\\"12345\\",\\"title\\":\\"测试视频\\"}'><img src=\\"https://ex.com/thumb.jpg\\"><span class=\\"duration\\">10:30</span><span class=\\"create-time\\">2024-01-15</span><div class=\\"intro\\">一个测试视频</div></div>"});</script>`
    const r = parseAcfunResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("测试视频")
    expect(r[0].url).toContain("acfun.cn/v/ac12345")
    expect(r[0].snippet).toContain("10:30")
    expect(r[0].category).toBe("video")
  })

  test("returns empty for empty HTML", () => {
    const { parseAcfunResults } = require("../../src/search/engines/acfun")
    expect(parseAcfunResults("", 10)).toEqual([])
  })

  test("returns empty for HTML without video data", () => {
    const { parseAcfunResults } = require("../../src/search/engines/acfun")
    expect(parseAcfunResults("<html><body>No data</body></html>", 10)).toEqual([])
  })
})

describe("SogouVideos engine", () => {
  test("makeSogouVideos creates engine", () => {
    const { makeSogouVideos } = require("../../src/search/engines/sogou-videos")
    const e = makeSogouVideos(makeEngineConfig({ name: "sogou-videos", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("sogou-videos")
    expect(typeof e.search).toBe("function")
  })

  test("parseSogouVideosResults extracts items from JSON", () => {
    const { parseSogouVideosResults } = require("../../src/search/engines/sogou-videos")
    const json = JSON.stringify({
      data: {
        list: [
          { titleEsc: "测试视频", url: "/vc/np/test123", site: "sogou", picurl: "https://ex.com/pic.jpg", date: "2024-01-15", duration: "05:30" },
          { titleEsc: "Second Video", url: "https://ex.com/video2", site: "test" },
        ],
      },
    })
    const r = parseSogouVideosResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("测试视频")
    expect(r[0].url).toContain("v.sogou.com/vc/np/test123")
    expect(r[0].snippet).toContain("sogou")
    expect(r[0].snippet).toContain("05:30")
    expect(r[0].category).toBe("video")
    expect(r[0].publishedDate).toBeDefined()
  })

  test("returns empty for empty data", () => {
    const { parseSogouVideosResults } = require("../../src/search/engines/sogou-videos")
    expect(parseSogouVideosResults("{}", 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parseSogouVideosResults } = require("../../src/search/engines/sogou-videos")
    expect(parseSogouVideosResults("bad", 10)).toEqual([])
  })
})

describe("SogouImages engine", () => {
  test("makeSogouImages creates engine", () => {
    const { makeSogouImages } = require("../../src/search/engines/sogou-images")
    const e = makeSogouImages(makeEngineConfig({ name: "sogou-images", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("sogou-images")
    expect(typeof e.search).toBe("function")
  })

  test("parseSogouImagesResults extracts items from __INITIAL_STATE__", () => {
    const { parseSogouImagesResults } = require("../../src/search/engines/sogou-images")
    const html = `<script>window.__INITIAL_STATE__={"searchList":{"searchList":[{"url":"https://ex.com/img1","picUrl":"https://ex.com/pic1","title":"Test Image 1","content_major":"A test image","ch_site_name":"sogou"},{"url":"https://ex.com/img2","picUrl":"https://ex.com/pic2","title":"Test Image 2"}]}};</script>`
    const r = parseSogouImagesResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Test Image 1")
    expect(r[0].url).toBe("https://ex.com/img1")
    expect(r[0].snippet).toContain("sogou")
    expect(r[0].snippet).toContain("A test image")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for HTML without __INITIAL_STATE__", () => {
    const { parseSogouImagesResults } = require("../../src/search/engines/sogou-images")
    expect(parseSogouImagesResults("<html></html>", 10)).toEqual([])
  })

  test("returns empty for empty HTML", () => {
    const { parseSogouImagesResults } = require("../../src/search/engines/sogou-images")
    expect(parseSogouImagesResults("", 10)).toEqual([])
  })
})

describe("Emojipedia engine", () => {
  test("makeEmojipedia creates engine", () => {
    const { makeEmojipedia } = require("../../src/search/engines/emojipedia")
    const e = makeEmojipedia(makeEngineConfig({ name: "emojipedia", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("emojipedia")
    expect(typeof e.search).toBe("function")
  })

  test("parseEmojipediaResults extracts items from HTML", () => {
    const { parseEmojipediaResults } = require("../../src/search/engines/emojipedia")
    const html = `<div class="EmojisList"><a href="/fire"><span>🔥</span> Fire</a><a href="/smile"><span>😊</span> Smiling Face</a></div>`
    const r = parseEmojipediaResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("Fire")
    expect(r[0].url).toContain("emojipedia.org/fire")
    expect(r[1].title).toContain("Smiling")
  })

  test("returns empty for empty HTML", () => {
    const { parseEmojipediaResults } = require("../../src/search/engines/emojipedia")
    expect(parseEmojipediaResults("", 10)).toEqual([])
  })
})

describe("Cara engine", () => {
  test("makeCara creates engine", () => {
    const { makeCara } = require("../../src/search/engines/cara")
    const e = makeCara(makeEngineConfig({ name: "cara", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("cara")
    expect(typeof e.search).toBe("function")
  })

  test("parseCaraResults extracts items from JSON", () => {
    const { parseCaraResults } = require("../../src/search/engines/cara")
    const json = JSON.stringify([
      { id: "post1", title: "Beautiful Landscape", content: "A stunning view", name: "Artist1", images: [{ src: "img1.jpg", isCoverImg: true }] },
      { id: "post2", title: "Digital Portrait", name: "Artist2", images: [{ src: "img2.jpg" }] },
    ])
    const r = parseCaraResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Beautiful Landscape")
    expect(r[0].url).toContain("cara.app/post/post1")
    expect(r[0].snippet).toContain("Artist1")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for empty array", () => {
    const { parseCaraResults } = require("../../src/search/engines/cara")
    expect(parseCaraResults("[]", 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parseCaraResults } = require("../../src/search/engines/cara")
    expect(parseCaraResults("bad", 10)).toEqual([])
  })
})

describe("OpenClipArt engine", () => {
  test("makeOpenClipArt creates engine", () => {
    const { makeOpenClipArt } = require("../../src/search/engines/openclipart")
    const e = makeOpenClipArt(makeEngineConfig({ name: "openclipart", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("openclipart")
    expect(typeof e.search).toBe("function")
  })

  test("parseOpenClipArtResults extracts items from HTML", () => {
    const { parseOpenClipArtResults } = require("../../src/search/engines/openclipart")
    const html = `<div class="gallery"><div class="artwork"><a href="/detail/123/test-image"><img src="/media/test.svg" alt="Test Image"></a></div><div class="artwork"><a href="/detail/456/another"><img src="/media/another.svg" alt="Another Art"></a></div></div>`
    const r = parseOpenClipArtResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Test Image")
    expect(r[0].url).toContain("openclipart.org/detail/123/test-image")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for empty HTML", () => {
    const { parseOpenClipArtResults } = require("../../src/search/engines/openclipart")
    expect(parseOpenClipArtResults("", 10)).toEqual([])
  })

  test("returns empty for HTML without artwork", () => {
    const { parseOpenClipArtResults } = require("../../src/search/engines/openclipart")
    expect(parseOpenClipArtResults("<html><body>No art</body></html>", 10)).toEqual([])
  })
})

describe("Ipernity engine", () => {
  test("makeIpernity creates engine", () => {
    const { makeIpernity } = require("../../src/search/engines/ipernity")
    const e = makeIpernity(makeEngineConfig({ name: "ipernity", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("ipernity")
    expect(typeof e.search).toBe("function")
  })

  test("parseIpernityResults extracts items from HTML with JS data", () => {
    const { parseIpernityResults } = require("../../src/search/engines/ipernity")
    const html = `<a href="/doc/user123/photo1"><img src="https://ex.com/photo1_240.jpg"></a><script>searchResults[0] = {"title":"Test Photo","user_name":"photographer","posted_at":"1705315200","doc_id":"photo1","user_id":"user123"};</script>`
    const r = parseIpernityResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Photo")
    expect(r[0].url).toContain("ipernity.com/doc/user123/photo1")
    expect(r[0].snippet).toContain("photographer")
    expect(r[0].category).toBe("image")
    expect(r[0].publishedDate).toBeDefined()
  })

  test("returns empty for empty HTML", () => {
    const { parseIpernityResults } = require("../../src/search/engines/ipernity")
    expect(parseIpernityResults("", 10)).toEqual([])
  })
})

describe("Uxwing engine", () => {
  test("makeUxwing creates engine", () => {
    const { makeUxwing } = require("../../src/search/engines/uxwing")
    const e = makeUxwing(makeEngineConfig({ name: "uxwing", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("uxwing")
    expect(typeof e.search).toBe("function")
  })

  test("parseUxwingResults extracts items from HTML", () => {
    const { parseUxwingResults } = require("../../src/search/engines/uxwing")
    const html = `<article id="post-123" class="categorycolor categoryarrow taggreen"><a href="https://uxwing.com/check-icon/"><img src="https://uxwing.com/wp-content/uploads/check.svg" alt="Check Icon"></a></article><article id="post-456" class="categoryshape"><a href="https://uxwing.com/star-icon/"><img src="https://uxwing.com/wp-content/uploads/star.svg" alt="Star Icon"></a></article>`
    const r = parseUxwingResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Check Icon")
    expect(r[0].url).toContain("uxwing.com/check-icon/")
    expect(r[0].snippet).toContain("color")
    expect(r[0].snippet).toContain("arrow")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for empty HTML", () => {
    const { parseUxwingResults } = require("../../src/search/engines/uxwing")
    expect(parseUxwingResults("", 10)).toEqual([])
  })
})

describe("Flaticon engine", () => {
  test("makeFlaticon creates engine", () => {
    const { makeFlaticon } = require("../../src/search/engines/flaticon")
    const e = makeFlaticon(makeEngineConfig({ name: "flaticon", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("flaticon")
    expect(typeof e.search).toBe("function")
  })

  test("parseFlaticonResults extracts items from HTML", () => {
    const { parseFlaticonResults } = require("../../src/search/engines/flaticon")
    const html = `<a class="icon--fill" href="/icon/check"><img src="https://cdn.flaticon.com/check.svg" alt="check icon"></a><a class="icon--fill" href="/icon/star"><img src="https://cdn.flaticon.com/star.svg" alt="star icon"></a>`
    const r = parseFlaticonResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("check icon")
    expect(r[0].url).toContain("flaticon.com/icon/check")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for empty HTML", () => {
    const { parseFlaticonResults } = require("../../src/search/engines/flaticon")
    expect(parseFlaticonResults("", 10)).toEqual([])
  })
})

describe("Tagesschau engine", () => {
  test("makeTagesschau creates engine", () => {
    const { makeTagesschau } = require("../../src/search/engines/tagesschau")
    const e = makeTagesschau(makeEngineConfig({ name: "tagesschau", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("tagesschau")
    expect(typeof e.search).toBe("function")
  })

  test("parseTagesschauResults extracts items from JSON", () => {
    const { parseTagesschauResults } = require("../../src/search/engines/tagesschau")
    const json = JSON.stringify({
      searchResults: [
        { type: "story", title: "Berlin News", firstSentence: "New developments in Berlin", date: "2024-01-15T10:00:00Z", shareURL: "https://tagesschau.de/berlin" },
        { type: "video", title: "Sports Highlights", firstSentence: "Today's sports news", date: "2024-01-14T08:00:00Z", shareURL: "https://tagesschau.de/sports" },
      ],
    })
    const r = parseTagesschauResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Berlin News")
    expect(r[0].url).toContain("tagesschau.de")
    expect(r[0].snippet).toContain("NEWS")
    expect(r[0].category).toBe("news")
    expect(r[0].publishedDate).toBeDefined()
  })

  test("returns empty for empty results", () => {
    const { parseTagesschauResults } = require("../../src/search/engines/tagesschau")
    expect(parseTagesschauResults("{}", 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parseTagesschauResults } = require("../../src/search/engines/tagesschau")
    expect(parseTagesschauResults("bad", 10)).toEqual([])
  })
})

describe("Selfhst engine", () => {
  test("makeSelfhst creates engine", () => {
    const { makeSelfhst } = require("../../src/search/engines/selfhst")
    const e = makeSelfhst(makeEngineConfig({ name: "selfhst", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("selfhst")
    expect(typeof e.search).toBe("function")
  })

  test("parseSelfhstResults filters items by query", () => {
    const { parseSelfhstResults } = require("../../src/search/engines/selfhst")
    const json = JSON.stringify([
      { Reference: "nginx", Name: "Nginx", SVG: "Yes", PNG: "No", CreatedAt: "2024-01-01" },
      { Reference: "docker", Name: "Docker", SVG: "Yes", PNG: "No", CreatedAt: "2024-01-02" },
      { Reference: "postgresql", Name: "PostgreSQL", SVG: "Yes", PNG: "Yes", CreatedAt: "2024-01-03" },
    ])
    const r = parseSelfhstResults(json, "nginx", 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Nginx")
    expect(r[0].url).toContain("nginx.svg")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for no matches", () => {
    const { parseSelfhstResults } = require("../../src/search/engines/selfhst")
    expect(parseSelfhstResults("[]", "nothing", 10)).toEqual([])
  })
})

describe("Devicons engine", () => {
  test("makeDevicons creates engine", () => {
    const { makeDevicons } = require("../../src/search/engines/devicons")
    const e = makeDevicons(makeEngineConfig({ name: "devicons", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("devicons")
    expect(typeof e.search).toBe("function")
  })

  test("parseDeviconsResults filters items by query", () => {
    const { parseDeviconsResults } = require("../../src/search/engines/devicons")
    const json = JSON.stringify([
      { name: "nginx", altnames: ["nginx proxy"], tags: ["server", "web"], color: "#269539", versions: { svg: ["plain", "original"] } },
      { name: "react", altnames: ["reactjs"], tags: ["framework", "ui"], color: "#61DAFB", versions: { svg: ["original"] } },
    ])
    const r = parseDeviconsResults(json, "nginx", 5)
    expect(r.length).toBe(2) // 两种 SVG 版本
    expect(r[0].title).toBe("nginx")
    expect(r[0].url).toContain("nginx-plain.svg")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for no matches", () => {
    const { parseDeviconsResults } = require("../../src/search/engines/devicons")
    expect(parseDeviconsResults("[]", "nothing", 10)).toEqual([])
  })
})

describe("Lucide engine", () => {
  test("makeLucide creates engine", () => {
    const { makeLucide } = require("../../src/search/engines/lucide")
    const e = makeLucide(makeEngineConfig({ name: "lucide", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("lucide")
    expect(typeof e.search).toBe("function")
  })

  test("parseLucideResults filters by query", () => {
    const { parseLucideResults } = require("../../src/search/engines/lucide")
    const json = JSON.stringify({ home: ["house", "building"], user: ["person", "profile"], settings: ["gear"] })
    const r = parseLucideResults(json, "home", 5)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("home")
    expect(r[0].url).toContain("home.svg")
    expect(r[0].snippet).toContain("house")
  })

  test("returns empty for no matches", () => {
    const { parseLucideResults } = require("../../src/search/engines/lucide")
    expect(parseLucideResults("{}", "nothing", 10)).toEqual([])
  })
})

describe("MaterialIcons engine", () => {
  test("makeMaterialIcons creates engine", () => {
    const { makeMaterialIcons } = require("../../src/search/engines/material-icons")
    const e = makeMaterialIcons(makeEngineConfig({ name: "material-icons", timeout: 5000, maxResults: 3 }))
    expect(e.name).toBe("material-icons")
    expect(typeof e.search).toBe("function")
  })

  test("parseMaterialIconsResults filters by query", () => {
    const { parseMaterialIconsResults } = require("../../src/search/engines/material-icons")
    const json = `)]}'\\n{"icons":[{"name":"home","tags":["house","building"],"categories":["places"]},{"name":"search","tags":["find"],"categories":["actions"]}]}`
    const r = parseMaterialIconsResults(json, "home", 5)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("home")
    expect(r[0].url).toContain("Material+Symbols")
  })

  test("returns empty for no data", () => {
    const { parseMaterialIconsResults } = require("../../src/search/engines/material-icons")
    expect(parseMaterialIconsResults("", "test", 10)).toEqual([])
  })
})

describe("Hex engine", () => {
  test("makeHex creates engine", () => {
    const { makeHex } = require("../../src/search/engines/hex")
    const e = makeHex(makeEngineConfig({ name: "hex", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("hex")
    expect(typeof e.search).toBe("function")
  })

  test("parseHexResults extracts items from JSON", () => {
    const { parseHexResults } = require("../../src/search/engines/hex")
    const json = JSON.stringify([
      { name: "phoenix", latest_version: "1.7.0", meta: { description: "Web framework" }, inserted_at: "2024-01-01T00:00:00Z", downloads: { all: 5000000 } },
      { name: "ecto", latest_version: "3.10.0", meta: { description: "Database wrapper" } },
    ])
    const r = parseHexResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("phoenix")
    expect(r[0].title).toContain("v1.7.0")
    expect(r[0].url).toContain("hex.pm/packages/phoenix")
    expect(r[0].category).toBe("code")
    expect(r[0].publishedDate).toBeDefined()
  })

  test("returns empty for empty array", () => {
    const { parseHexResults } = require("../../src/search/engines/hex")
    expect(parseHexResults("[]", 10)).toEqual([])
  })
})

describe("MicrosoftLearn engine", () => {
  test("makeMicrosoftLearn creates engine", () => {
    const { makeMicrosoftLearn } = require("../../src/search/engines/microsoft-learn")
    const e = makeMicrosoftLearn(makeEngineConfig({ name: "microsoft-learn", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("microsoft-learn")
    expect(typeof e.search).toBe("function")
  })

  test("parseMicrosoftLearnResults extracts items from JSON", () => {
    const { parseMicrosoftLearnResults } = require("../../src/search/engines/microsoft-learn")
    const json = JSON.stringify({
      results: [
        { url: "https://learn.microsoft.com/azure", title: "Azure Docs", description: "Cloud computing docs" },
        { url: "https://learn.microsoft.com/dotnet", title: ".NET Docs", description: ".NET framework docs" },
      ],
    })
    const r = parseMicrosoftLearnResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Azure Docs")
    expect(r[0].url).toContain("microsoft.com")
    expect(r[0].category).toBe("general")
  })

  test("returns empty for empty results", () => {
    const { parseMicrosoftLearnResults } = require("../../src/search/engines/microsoft-learn")
    expect(parseMicrosoftLearnResults("{}", 10)).toEqual([])
  })
})

describe("Ansa engine", () => {
  test("makeAnsa creates engine", () => {
    const { makeAnsa } = require("../../src/search/engines/ansa")
    const e = makeAnsa(makeEngineConfig({ name: "ansa", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("ansa")
    expect(typeof e.search).toBe("function")
  })

  test("parseAnsaResults extracts items from HTML", () => {
    const { parseAnsaResults } = require("../../src/search/engines/ansa")
    const html = `<article><a href="/english/news/2024/01/15/test"><img src="https://ex.com/img.jpg" alt="Italy News Title"></a><p>Breaking news from Italy</p></article>`
    const r = parseAnsaResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Italy News Title")
    expect(r[0].url).toContain("ansa.it")
    expect(r[0].category).toBe("news")
  })

  test("returns empty for empty HTML", () => {
    const { parseAnsaResults } = require("../../src/search/engines/ansa")
    expect(parseAnsaResults("", 10)).toEqual([])
  })
})

describe("SensCritique engine", () => {
  test("makeSensCritique creates engine", () => {
    const { makeSensCritique } = require("../../src/search/engines/senscritique")
    const e = makeSensCritique(makeEngineConfig({ name: "senscritique", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("senscritique")
    expect(typeof e.search).toBe("function")
  })

  test("parseSensCritiqueResults extracts items from HTML", () => {
    const { parseSensCritiqueResults } = require("../../src/search/engines/senscritique")
    const html = `<a href="/film/test_movie" class="EllaItem"><img alt="Test Movie"><div class="Text">Great French movie</div></a>`
    const r = parseSensCritiqueResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Movie")
    expect(r[0].url).toContain("senscritique.com/film/test_movie")
    expect(r[0].snippet).toContain("French movie")
  })

  test("returns empty for empty HTML", () => {
    const { parseSensCritiqueResults } = require("../../src/search/engines/senscritique")
    expect(parseSensCritiqueResults("", 10)).toEqual([])
  })
})

describe("PDBe engine", () => {
  test("makePdbe creates engine", () => {
    const { makePdbe } = require("../../src/search/engines/pdbe")
    const e = makePdbe(makeEngineConfig({ name: "pdbe", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("pdbe")
    expect(typeof e.search).toBe("function")
  })

  test("parsePdbeResults extracts items from JSON", () => {
    const { parsePdbeResults } = require("../../src/search/engines/pdbe")
    const json = JSON.stringify({
      response: { docs: [{ pdb_id: "1XYZ", title: "Test Protein", citation_title: "A test protein structure", entry_author_list: ["Smith J"], journal: "Nature", citation_year: 2024 }] },
    })
    const r = parsePdbeResults(json, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("test protein structure")
    expect(r[0].url).toContain("pdbe/entry/pdb/1XYZ")
    expect(r[0].category).toBe("academic")
  })

  test("returns empty for empty docs", () => {
    const { parsePdbeResults } = require("../../src/search/engines/pdbe")
    expect(parsePdbeResults("{}", 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    const { parsePdbeResults } = require("../../src/search/engines/pdbe")
    expect(parsePdbeResults("bad", 10)).toEqual([])
  })
})

describe("Moviepilot engine", () => {
  test("makeMoviepilot creates engine", () => {
    const { makeMoviepilot } = require("../../src/search/engines/moviepilot")
    const e = makeMoviepilot(makeEngineConfig({ name: "moviepilot", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("moviepilot")
    expect(typeof e.search).toBe("function")
  })

  test("parseMoviepilotResults extracts items from JSON", () => {
    const { parseMoviepilotResults } = require("../../src/search/engines/moviepilot")
    const json = JSON.stringify([
      { title: "Inception", url: "/filme/inception", class: "movie", info: "2010", more: "Christopher Nolan" },
      { title: "Interstellar", url: "/filme/interstellar", class: "movie", info: "2014", more: "Christopher Nolan" },
    ])
    const r = parseMoviepilotResults(json, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Inception")
    expect(r[0].url).toContain("moviepilot.de/filme/inception")
    expect(r[0].snippet).toContain("movie")
  })

  test("returns empty for empty array", () => {
    const { parseMoviepilotResults } = require("../../src/search/engines/moviepilot")
    expect(parseMoviepilotResults("[]", 10)).toEqual([])
  })
})

describe("AnnasArchive engine", () => {
  test("makeAnnasArchive creates engine", () => {
    const { makeAnnasArchive } = require("../../src/search/engines/annas-archive")
    const e = makeAnnasArchive(makeEngineConfig({ name: "annas-archive", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("annas-archive")
    expect(typeof e.search).toBe("function")
  })

  test("parseAnnasArchiveResults extracts items from HTML", () => {
    const { parseAnnasArchiveResults } = require("../../src/search/engines/annas-archive")
    const html = `<div class="js-aarecord-list-outer"><div class="flex"><a href="/book/123"><a class="js-vim-focus">Test Book</a><div class="line-clamp">A great book description</div><img src="https://ex.com/thumb.jpg"></div></div>`
    const r = parseAnnasArchiveResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Book")
    expect(r[0].url).toContain("annas-archive.gl/book/123")
    expect(r[0].snippet).toContain("great book")
  })

  test("returns empty for empty HTML", () => {
    const { parseAnnasArchiveResults } = require("../../src/search/engines/annas-archive")
    expect(parseAnnasArchiveResults("", 10)).toEqual([])
  })
})

describe("Iqiyi engine", () => {
  test("makeIqiyi creates engine", () => {
    const { makeIqiyi } = require("../../src/search/engines/iqiyi")
    const e = makeIqiyi(makeEngineConfig({ name: "iqiyi", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("iqiyi")
    expect(typeof e.search).toBe("function")
  })

  test("parseIqiyiResults extracts items from HTML with primary regex", () => {
    const { parseIqiyiResults } = require("../../src/search/engines/iqiyi")
    const html = `<a href="https://www.iqiyi.com/video/123.html" class="search-ResultItem"><img src="https://ex.com/thumb.jpg" alt="测试视频"><span class="duration">45:30</span></a>`
    const r = parseIqiyiResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("测试视频")
    expect(r[0].url).toContain("iqiyi.com/video/123.html")
    expect(r[0].snippet).toContain("45:30")
    expect(r[0].category).toBe("video")
  })

  test("uses fallback regex when primary fails", () => {
    const { parseIqiyiResults } = require("../../src/search/engines/iqiyi")
    const html = `<a href="/video/456.html"><img src="https://ex.com/thumb.jpg" alt="Fallback Video"></a>`
    const r = parseIqiyiResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Fallback Video")
    expect(r[0].category).toBe("video")
  })

  test("returns empty for empty HTML", () => {
    const { parseIqiyiResults } = require("../../src/search/engines/iqiyi")
    expect(parseIqiyiResults("", 10)).toEqual([])
  })
})

describe("Zhihu engine", () => {
  test("makeZhihu creates engine", () => {
    const { makeZhihu } = require("../../src/search/engines/zhihu")
    const e = makeZhihu(makeEngineConfig({ name: "zhihu", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("zhihu")
    expect(typeof e.search).toBe("function")
  })

  test("parseZhihuResults extracts items from HTML pattern 1", () => {
    const { parseZhihuResults } = require("../../src/search/engines/zhihu")
    const html = `<a class="Entry" href="/question/123"><span>如何评价 TypeScript？</span></a><p class="RichContent">TypeScript 是 JavaScript 的超集</p><a class="Entry" href="/question/456"><span>什么是 Rust？</span></a><p class="RichContent">Rust 是一门系统编程语言</p>`
    const r = parseZhihuResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("TypeScript")
    expect(r[0].url).toContain("zhihu.com/question/123")
    expect(r[0].snippet).toContain("超集")
    expect(r[0].category).toBe("social")
  })

  test("falls back to pattern 3 for simple links", () => {
    const { parseZhihuResults } = require("../../src/search/engines/zhihu")
    const html = `<a href="/question/789">如何学习编程？</a><a href="/answer/456">编程入门指南</a>`
    const r = parseZhihuResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("编程")
    expect(r[0].url).toContain("zhihu.com/question/789")
  })

  test("returns empty for empty HTML", () => {
    const { parseZhihuResults } = require("../../src/search/engines/zhihu")
    expect(parseZhihuResults("", 10)).toEqual([])
  })
})

describe("Xiaohongshu engine", () => {
  test("makeXiaohongshu creates engine", () => {
    const { makeXiaohongshu } = require("../../src/search/engines/xiaohongshu")
    const e = makeXiaohongshu(makeEngineConfig({ name: "xiaohongshu", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("xiaohongshu")
    expect(typeof e.search).toBe("function")
  })

  test("parseXiaohongshuResults extracts items from HTML", () => {
    const { parseXiaohongshuResults } = require("../../src/search/engines/xiaohongshu")
    const html = `<a class="noteItem" href="/explore/123"><img alt="小红书测试笔记" src="https://ex.com/pic.jpg"><span class="likeCount">1.2万</span></a><a class="noteItem" href="/explore/456"><img alt="第二篇笔记" src="https://ex.com/pic2.jpg"><span class="likeCount">500</span></a>`
    const r = parseXiaohongshuResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toContain("小红书测试笔记")
    expect(r[0].url).toContain("xiaohongshu.com/explore/123")
    expect(r[0].snippet).toContain("1.2万")
    expect(r[0].category).toBe("social")
  })

  test("uses fallback pattern for simple links", () => {
    const { parseXiaohongshuResults } = require("../../src/search/engines/xiaohongshu")
    const html = `<a href="/discovery/test">测试发现页</a>`
    const r = parseXiaohongshuResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toContain("测试")
    expect(r[0].url).toContain("xiaohongshu.com/discovery/test")
  })

  test("returns empty for empty HTML", () => {
    const { parseXiaohongshuResults } = require("../../src/search/engines/xiaohongshu")
    expect(parseXiaohongshuResults("", 10)).toEqual([])
  })
})
