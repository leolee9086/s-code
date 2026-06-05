/**
 * Bing Videos 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeBingVideos, parseBingVideosResults } from "../../src/search/engines/bing-videos"
import { makeEngineConfig } from "../../src/search/engine"

describe("Bing Videos engine", () => {
  test("makeBingVideos creates engine", () => {
    const e = makeBingVideos(makeEngineConfig({ name: "bing-videos", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("bing-videos")
    expect(typeof e.search).toBe("function")
  })

  test("parseBingVideosResults extracts from HTML", () => {
    const html = `<div id="mc_vtvc_video0"><div class="vrhdata" vrhm="{&quot;vt&quot;:&quot;Test Video&quot;,&quot;murl&quot;:&quot;https://ex.com/video.mp4&quot;,&quot;du&quot;:&quot;10:30&quot;}"></div></div>`
    const r = parseBingVideosResults(html, 10)
    expect(r.length).toBe(1)
    expect(r[0].title).toBe("Test Video")
    expect(r[0].url).toBe("https://ex.com/video.mp4")
    expect(r[0].category).toBe("video")
  })

  test("returns empty for empty HTML", () => expect(parseBingVideosResults("", 10)).toEqual([]))
  test("returns empty for invalid metadata", () => {
    const html = `<div id="mc_vtvc_video"><div class="vrhdata" vrhm="bad json"></div></div>`
    expect(parseBingVideosResults(html, 10).length).toBe(0)
  })
})
