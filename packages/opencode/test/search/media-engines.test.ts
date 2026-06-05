/**
 * SoundCloud + Flickr 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeSoundCloud, parseSoundCloudResults } from "../../src/search/engines/soundcloud"
import { makeFlickr, parseFlickrResults } from "../../src/search/engines/flickr"
import { makeEngineConfig } from "../../src/search/engine"

describe("SoundCloud engine", () => {
  test("creates engine", () => {
    const e = makeSoundCloud(makeEngineConfig({ name: "soundcloud", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("soundcloud")
  })

  test("parseSoundCloudResults extracts items", () => {
    const html = `<li class="soundList__item"><a href="/track/test">Test Track</a></li>`
    const r = parseSoundCloudResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Track")
    expect(r[0].url).toContain("soundcloud.com")
    expect(r[0].category).toBe("music")
  })

  test("returns empty for empty HTML", () => expect(parseSoundCloudResults("", 10)).toEqual([]))
})

describe("Flickr engine", () => {
  test("creates engine", () => {
    const e = makeFlickr(makeEngineConfig({ name: "flickr", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("flickr")
  })

  test("parseFlickrResults extracts items", () => {
    const html = `<a class="overlay" href="/photos/test"><img alt="Test Photo"></a>`
    const r = parseFlickrResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Photo")
    expect(r[0].category).toBe("image")
  })

  test("returns empty for empty HTML", () => expect(parseFlickrResults("", 10)).toEqual([]))
})
