/**
 * Naver 引擎测试
 */
import { describe, expect, test } from "bun:test"
import { makeNaver, parseNaverResults } from "../../src/search/engines/naver"
import { makeEngineConfig } from "../../src/search/engine"

describe("Naver engine", () => {
  test("makeNaver creates engine", () => {
    const e = makeNaver(makeEngineConfig({ name: "naver", timeout: 5000, maxResults: 5 }))
    expect(e.name).toBe("naver")
    expect(typeof e.search).toBe("function")
  })

  test("parseNaverResults parses li.bx blocks", () => {
    const html = `<li class="bx"><a class="link_tit" href="https://naver.com/1">Naver Result 1</a><a class="api_txt_lines">Description 1</a></li>
                  <li class="bx"><a class="link_tit" href="https://naver.com/2">Naver Result 2</a></li>`
    const r = parseNaverResults(html, 10)
    expect(r.length).toBe(2)
    expect(r[0].title).toBe("Naver Result 1")
    expect(r[0].url).toBe("https://naver.com/1")
    expect(r[0].snippet).toBe("Description 1")
    expect(r[1].title).toBe("Naver Result 2")
  })

  test("respects maxResults", () => {
    const html = `<li class="bx"><a class="link_tit" href="https://ex.com/1">R1</a></li>
                  <li class="bx"><a class="link_tit" href="https://ex.com/2">R2</a></li>`
    expect(parseNaverResults(html, 1).length).toBe(1)
  })

  test("returns empty for empty HTML", () => {
    expect(parseNaverResults("", 10)).toEqual([])
  })

  test("skips items without title", () => {
    const html = `<li class="bx"><a class="link_tit" href="https://ex.com"></a></li>`
    expect(parseNaverResults(html, 10).length).toBe(0)
  })
})
