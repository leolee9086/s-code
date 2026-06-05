/**
 * Bilibili 引擎测试：验证 JSON 响应解析和引擎配置
 */
import { describe, expect, test } from "bun:test"
import { makeBilibili, parseBilibiliResults } from "../../src/search/engines/bilibili"
import { makeEngineConfig } from "../../src/search/engine"

// Bilibili API 返回的模拟 JSON 片段（基于真实 API 响应格式）
const SAMPLE_JSON = JSON.stringify({
  code: 0,
  message: "OK",
  ttl: 1,
  data: {
    seid: "1234567890",
    page: 1,
    pagesize: 5,
    numResults: 1000,
    numPages: 200,
    result: [
      {
        type: "video",
        id: 12345678,
        aid: 12345678,
        title: "掌握<em class=\"keyword\">Rust编程</em>语言：从<em class=\"keyword\">入门</em>到精通",
        arcurl: "https://www.bilibili.com/video/BV1Test1",
        pic: "https://i0.hdslb.com/bfs/archive/test1.jpg",
        description: "从零开始学习 Rust 编程语言，涵盖基础语法到高级特性",
        author: "测试作者",
        play: 50000,
        video_review: 5000,
        favorites: 2000,
        tag: "Rust,编程",
        review: 500,
        pubdate: 1735689600, // 2025-01-01
        duration: "30:15",
        mid: 12345,
        bvid: "BV1Test1",
      },
      {
        type: "video",
        id: 23456789,
        aid: 23456789,
        title: "Rust &amp; WebAssembly 实战教程",
        arcurl: "https://www.bilibili.com/video/BV1Test2",
        pic: "https://i0.hdslb.com/bfs/archive/test2.jpg",
        description: "使用 Rust 和 WebAssembly 构建高性能 Web 应用",
        author: "技术博主",
        play: 30000,
        video_review: 3000,
        favorites: 1500,
        tag: "Rust,WASM",
        review: 200,
        pubdate: 1696000000, // 2023-09-30
        duration: "45:00",
        mid: 67890,
        bvid: "BV1Test2",
      },
    ],
  },
})

// 空结果
const EMPTY_JSON = JSON.stringify({ code: 0, message: "OK", data: { result: [] } })

// 无结果字段
const NO_RESULT_JSON = JSON.stringify({ code: 0, message: "OK", data: {} })

// 错误响应
const ERROR_JSON = JSON.stringify({ code: -1, message: "请求错误" })

describe("Bilibili engine config", () => {
  test("makeBilibili creates engine with correct config", () => {
    const engine = makeBilibili(makeEngineConfig({
      name: "bilibili",
      timeout: 5000,
      maxResults: 5,
    }))

    expect(engine.name).toBe("bilibili")
    expect(engine.config.maxResults).toBe(5)
    expect(engine.config.requiresKey).toBe(false)
    expect(typeof engine.search).toBe("function")
  })

  test("engine config has correct defaults", () => {
    const engine = makeBilibili(makeEngineConfig({
      name: "bilibili-video",
      weight: 1.0,
      timeout: 15000,
      maxResults: 8,
    }))

    expect(engine.config.weight).toBe(1.0)
    expect(engine.config.timeout).toBe(15000)
    expect(engine.config.maxResults).toBe(8)
  })
})

describe("parseBilibiliResults", () => {
  test("parses standard API response", () => {
    const results = parseBilibiliResults(SAMPLE_JSON, 10)
    expect(results.length).toBe(2)

    // 第一个结果 —— 验证 HTML 标签被清理、实体被解码
    expect(results[0].title).toBe("掌握Rust编程语言：从入门到精通")
    expect(results[0].url).toBe("https://www.bilibili.com/video/BV1Test1")
    expect(results[0].snippet).toContain("从零开始学习 Rust 编程语言")
    expect(results[0].engine).toBe("bilibili")
    expect(results[0].position).toBe(1)
    expect(results[0].category).toBe("video")
    // pubdate 应从秒级转换为毫秒级
    expect(results[0].publishedDate).toBe(1735689600000)

    // 第二个结果 —— 验证 HTML 实体解码
    expect(results[1].title).toBe("Rust & WebAssembly 实战教程")
    expect(results[1].url).toBe("https://www.bilibili.com/video/BV1Test2")
    expect(results[1].position).toBe(2)
    expect(results[1].publishedDate).toBe(1696000000000)
  })

  test("respects maxResults", () => {
    const results = parseBilibiliResults(SAMPLE_JSON, 1)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("掌握Rust编程语言：从入门到精通")
  })

  test("returns empty for empty result array", () => {
    expect(parseBilibiliResults(EMPTY_JSON, 10)).toEqual([])
  })

  test("returns empty for no result field", () => {
    expect(parseBilibiliResults(NO_RESULT_JSON, 10)).toEqual([])
  })

  test("returns empty for error response", () => {
    expect(parseBilibiliResults(ERROR_JSON, 10)).toEqual([])
  })

  test("returns empty for invalid JSON", () => {
    expect(parseBilibiliResults("not json", 10)).toEqual([])
  })

  test("returns empty for empty string", () => {
    expect(parseBilibiliResults("", 10)).toEqual([])
  })

  test("sanitizes HTML entities and tags in title", () => {
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [
          {
            aid: 1,
            arcurl: "https://bilibili.com/video/BV1Test",
            title: "Test &amp; Learn &lt;script&gt;安全&lt;/script&gt;",
            description: "desc",
          },
        ],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("Test & Learn 安全")
  })

  test("handles items without url field", () => {
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [
          { aid: 1, title: "No URL" },
          { aid: 2, arcurl: "https://bilibili.com/video/BV1Valid", title: "Valid" },
        ],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("Valid")
  })

  test("handles items without title field", () => {
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [
          { aid: 1, arcurl: "https://bilibili.com/video/BV1NoTitle" },
        ],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(0)
  })

  test("handles items with empty title", () => {
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [
          { aid: 1, arcurl: "https://bilibili.com/video/BV1Empty", title: "" },
        ],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(0)
  })

  test("truncates long description snippets", () => {
    const longDesc = "x".repeat(500)
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [
          { aid: 1, arcurl: "https://bilibili.com/video/BV1Long", title: "Long desc", description: longDesc },
        ],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(1)
    expect(results[0].snippet.length).toBe(300)
  })

  test("handles non-object items gracefully", () => {
    const json = JSON.stringify({
      code: 0,
      data: {
        result: [null, "string", 42, { aid: 1, arcurl: "https://bilibili.com/video/BV1Ok", title: "OK" }],
      },
    })
    const results = parseBilibiliResults(json, 10)
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("OK")
  })
})
