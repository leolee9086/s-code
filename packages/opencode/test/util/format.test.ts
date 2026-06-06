/**
 * format 工具函数测试
 */
import { describe, expect, test } from "bun:test"
import { formatDuration } from "../../src/util/format"

describe("formatDuration", () => {
  test("returns empty for zero or negative", () => {
    expect(formatDuration(0)).toBe("")
    expect(formatDuration(-1)).toBe("")
  })

  test("formats seconds", () => {
    expect(formatDuration(30)).toBe("30s")
    expect(formatDuration(59)).toBe("59s")
  })

  test("formats minutes", () => {
    expect(formatDuration(60)).toBe("1m")
    expect(formatDuration(120)).toBe("2m")
    expect(formatDuration(90)).toBe("1m 30s")
  })

  test("formats hours", () => {
    expect(formatDuration(3600)).toBe("1h")
    expect(formatDuration(3660)).toBe("1h 1m")
    expect(formatDuration(7200)).toBe("2h")
  })

  test("formats days", () => {
    expect(formatDuration(86400)).toBe("~1 day")
    expect(formatDuration(172800)).toBe("~2 days")
  })

  test("formats weeks", () => {
    expect(formatDuration(604800)).toBe("~1 week")
    expect(formatDuration(1209600)).toBe("~2 weeks")
  })
})
