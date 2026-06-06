/**
 * error 工具函数测试（errorFormat、errorMessage、errorData）
 */
import { describe, expect, test } from "bun:test"
import { errorFormat, errorMessage, errorData } from "../../src/util/error"

describe("errorFormat", () => {
  test("formats Error instances with stack", () => {
    const err = new Error("test error")
    const result = errorFormat(err)
    expect(result).toContain("test error")
    expect(result).toContain("Error:")
  })

  test("formats plain objects", () => {
    const result = errorFormat({ message: "hello", code: 42 })
    expect(result).toContain("hello")
    expect(result).toContain("42")
  })

  test("formats null/undefined as string", () => {
    expect(errorFormat(null)).toBe("null")
    expect(errorFormat(undefined)).toBe("undefined")
  })

  test("formats primitive values", () => {
    expect(errorFormat("string error")).toBe("string error")
    expect(errorFormat(42)).toBe("42")
  })
})

describe("errorMessage", () => {
  test("extracts message from Error", () => {
    expect(errorMessage(new Error("something failed"))).toBe("something failed")
  })

  test("uses name when message is empty", () => {
    expect(errorMessage(new Error())).toBe("Error")
  })

  test("extracts message from objects", () => {
    expect(errorMessage({ message: "custom" })).toBe("custom")
  })

  test("returns unknown error for empty string", () => {
    expect(errorMessage("")).toBe("unknown error")
  })
})

describe("errorData", () => {
  test("extracts data from Error", () => {
    const data = errorData(new Error("test"))
    expect(data.type).toBe("Error")
    expect(data.message).toBe("test")
    expect(data.stack).toBeDefined()
  })

  test("extracts data from plain objects", () => {
    const data = errorData({ code: 500, message: "server error" })
    expect(data.message).toBe("server error")
  })

  test("handles null", () => {
    const data = errorData(null)
    expect(data.type).toBe("object")
  })
})
