/**
 * wildcard 模式匹配工具测试
 */
import { describe, expect, test } from "bun:test"
import { match, all, allStructured } from "../../src/util/wildcard"

describe("wildcard.match", () => {
  test("exact match", () => {
    expect(match("hello", "hello")).toBe(true)
    expect(match("hello", "world")).toBe(false)
  })

  test("wildcard * matches anything", () => {
    expect(match("anything", "*")).toBe(true)
    expect(match("hello world", "hello *")).toBe(true)
    expect(match("hello", "hello *")).toBe(true)
    expect(match("hello world foo", "hello *")).toBe(true)
    expect(match("world hello", "hello *")).toBe(false)
  })

  test("wildcard ? matches single char", () => {
    expect(match("cat", "?at")).toBe(true)
    expect(match("bat", "?at")).toBe(true)
    expect(match("at", "?at")).toBe(false)
  })

  test("case insensitive by default", () => {
    expect(match("Hello", "hello")).toBe(true)
    expect(match("HELLO", "hello")).toBe(true)
  })

  test("backslash normalization", () => {
    expect(match("foo\\bar", "foo/bar")).toBe(true)
    expect(match("foo/bar", "foo\\bar")).toBe(true)
  })
})

describe("wildcard.all", () => {
  const patterns = {
    "*.ts": "typescript",
    "*.js": "javascript",
    "*.json": "json",
    "*": "other",
  }

  test("matches most specific first", () => {
    expect(all("file.ts", patterns)).toBe("typescript")
    expect(all("file.js", patterns)).toBe("javascript")
    expect(all("file.json", patterns)).toBe("json")
  })

  test("falls through to catch-all", () => {
    expect(all("file.py", patterns)).toBe("other")
  })

  test("empty input uses catch-all", () => {
    expect(all("", patterns)).toBe("other")
  })
})

describe("wildcard.allStructured", () => {
  test("matches head and tail", () => {
    const patterns = {
      "git status": "check",
      "git *": "git-other",
      "*": "other",
    }
    expect(allStructured({ head: "git", tail: ["status"] }, patterns)).toBe("check")
    expect(allStructured({ head: "git", tail: ["commit", "-m", "msg"] }, patterns)).toBe("git-other")
    expect(allStructured({ head: "npm", tail: ["install"] }, patterns)).toBe("other")
  })
})
