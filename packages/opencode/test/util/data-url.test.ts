/**
 * data-url 工具测试
 */
import { describe, expect, test } from "bun:test"
import { decodeDataUrl } from "../../src/util/data-url"

describe("decodeDataUrl", () => {
  test("decodes base64 data URL", () => {
    const encoded = Buffer.from("hello world").toString("base64")
    expect(decodeDataUrl(`data:text/plain;base64,${encoded}`)).toBe("hello world")
  })

  test("decodes URI-encoded data URL", () => {
    expect(decodeDataUrl("data:text/plain,hello%20world")).toBe("hello world")
  })

  test("returns empty for invalid URL", () => {
    expect(decodeDataUrl("no-comma")).toBe("")
  })

  test("handles empty body", () => {
    expect(decodeDataUrl("data:text/plain,")).toBe("")
  })
})
