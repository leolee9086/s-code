/**
 * locale 工具函数测试
 */
import { describe, expect, test } from "bun:test"
import { titlecase, number, truncate, truncateLeft, truncateMiddle, pluralize } from "../../src/util/locale"

describe("titlecase", () => {
  test("capitalizes first letter of each word", () => {
    expect(titlecase("hello world")).toBe("Hello World")
    expect(titlecase("foo bar baz")).toBe("Foo Bar Baz")
  })
})

describe("number", () => {
  test("formats thousands", () => {
    expect(number(500)).toBe("500")
    expect(number(1500)).toBe("1.5K")
    expect(number(2500000)).toBe("2.5M")
  })
})

describe("truncate", () => {
  test("truncates with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…")
    expect(truncate("short", 10)).toBe("short")
  })
})

describe("truncateLeft", () => {
  test("truncates from left with ellipsis", () => {
    expect(truncateLeft("hello world", 8)).toBe("…o world")
    expect(truncateLeft("short", 10)).toBe("short")
  })
})

describe("truncateMiddle", () => {
  test("truncates middle with ellipsis", () => {
    const result = truncateMiddle("this is a long string that should be truncated", 35)
    expect(result.length).toBeLessThanOrEqual(36)
    expect(result).toContain("…")
    expect(result.startsWith("this is")).toBe(true)
    expect(result.endsWith("cated")).toBe(true)
  })

  test("does not truncate short strings", () => {
    expect(truncateMiddle("short")).toBe("short")
  })
})

describe("pluralize", () => {
  test("uses singular for 1", () => {
    expect(pluralize(1, "{} item", "{} items")).toBe("1 item")
  })

  test("uses plural for other counts", () => {
    expect(pluralize(0, "{} item", "{} items")).toBe("0 items")
    expect(pluralize(5, "{} item", "{} items")).toBe("5 items")
  })
})
