/**
 * 搜狗微信引擎测试：验证 HTML 解析
 */
import { describe, expect, test } from "bun:test"
import { makeSogouWeChat, parseSogouWeChatResults } from "../../src/search/engines/sogou-wechat"
import { makeEngineConfig } from "../../src/search/engine"

// 模拟搜狗微信搜索结果 HTML
const SAMPLE_HTML = `<html><body>
<li id="sogou_vr_11002623_0" class="news-list">
  <h3><a href="/link?url=https://mp.weixin.qq.com/s/test1" target="_blank">AI技术的最新发展与应用</a></h3>
  <p class="txt-info">这是一篇关于人工智能技术最新发展的文章，涵盖了深度学习、自然语言处理等领域。</p>
  <div class="account">科技前沿</div>
  <script>timeConvert('1735689600')</script>
</li>
<li id="sogou_vr_11002623_1" class="news-list">
  <h3><a href="https://mp.weixin.qq.com/s/test2" target="_blank">Rust语言入门教程</a></h3>
  <p class="txt-info">从零开始学习Rust编程语言，掌握系统编程的基础知识。</p>
  <div class="account">编程课堂</div>
  <script>timeConvert('1696000000')</script>
</li>
</body></html>`

const EMPTY_HTML = "<html><body></body></html>"

describe("Sogou WeChat engine config", () => {
  test("makeSogouWeChat creates engine with correct config", () => {
    const engine = makeSogouWeChat(makeEngineConfig({ name: "sogou-wechat", timeout: 5000, maxResults: 5 }))
    expect(engine.name).toBe("sogou-wechat")
    expect(engine.config.requiresKey).toBe(false)
    expect(typeof engine.search).toBe("function")
  })
})

describe("parseSogouWeChatResults", () => {
  test("parses standard search results", () => {
    const results = parseSogouWeChatResults(SAMPLE_HTML, 10)
    expect(results.length).toBe(2)

    expect(results[0].title).toBe("AI技术的最新发展与应用")
    expect(results[0].url).toContain("mp.weixin.qq.com/s/test1")
    expect(results[0].snippet).toContain("人工智能")
    expect(results[0].engine).toBe("sogou-wechat")
    expect(results[0].position).toBe(1)
    expect(results[0].category).toBe("news")
    expect(results[0].publishedDate).toBe(1735689600000)

    expect(results[1].title).toBe("Rust语言入门教程")
    expect(results[1].publishedDate).toBe(1696000000000)
  })

  test("respects maxResults", () => {
    expect(parseSogouWeChatResults(SAMPLE_HTML, 1).length).toBe(1)
  })

  test("returns empty for empty HTML", () => {
    expect(parseSogouWeChatResults(EMPTY_HTML, 10)).toEqual([])
  })

  test("returns empty for empty string", () => {
    expect(parseSogouWeChatResults("", 10)).toEqual([])
  })

  test("handles missing title gracefully", () => {
    const html = `<li id="sogou_vr_1"><h3><a href="/link?url=https://ex.com">  </a></h3></li>`
    expect(parseSogouWeChatResults(html, 10).length).toBe(0)
  })
})
