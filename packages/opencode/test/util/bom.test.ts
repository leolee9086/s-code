/**
 * BOM (Byte Order Mark) 处理工具测试
 */
import { describe, expect, test } from "bun:test"
import { split, join } from "../../src/util/bom"

const BOM = "\uFEFF"

describe("BOM.split", () => {
  test("detects BOM at start", () => {
    const result = split(`${BOM}hello`)
    expect(result.bom).toBe(true)
    expect(result.text).toBe("hello")
  })

  test("returns bom=false when no BOM", () => {
    const result = split("hello")
    expect(result.bom).toBe(false)
    expect(result.text).toBe("hello")
  })

  test("handles empty string", () => {
    const result = split("")
    expect(result.bom).toBe(false)
    expect(result.text).toBe("")
  })
})

describe("BOM.join", () => {
  test("adds BOM when requested", () => {
    expect(join("hello", true)).toBe(`${BOM}hello`)
  })

  test("strips existing BOM before adding", () => {
    expect(join(`${BOM}hello`, true)).toBe(`${BOM}hello`)
  })

  test("returns text without BOM when not requested", () => {
    expect(join(`${BOM}hello`, false)).toBe("hello")
    expect(join("hello", false)).toBe("hello")
  })
})
