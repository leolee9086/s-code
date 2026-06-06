/**
 * proxy-env 工具函数测试
 */
import { describe, expect, test, afterEach } from "bun:test"
import { getProxyForUrl } from "../../src/util/proxy-env"

afterEach(() => {
  // 清理环境变量，避免测试间相互影响
  delete process.env.http_proxy
  delete process.env.HTTP_PROXY
  delete process.env.https_proxy
  delete process.env.HTTPS_PROXY
  delete process.env.all_proxy
  delete process.env.ALL_PROXY
  delete process.env.no_proxy
  delete process.env.NO_PROXY
})

describe("proxy-env", () => {
  test("returns undefined when no proxy configured", () => {
    expect(getProxyForUrl("http://example.com")).toBeUndefined()
  })

  test("returns http proxy when configured", () => {
    process.env.http_proxy = "http://proxy.local:8080"
    const result = getProxyForUrl("http://example.com")
    expect(result).toBe("http://proxy.local:8080")
  })

  test("returns https proxy for https urls", () => {
    process.env.https_proxy = "http://https-proxy.local:3128"
    const result = getProxyForUrl("https://example.com")
    expect(result).toBe("http://https-proxy.local:3128")
  })

  test("respects no_proxy", () => {
    process.env.http_proxy = "http://proxy.local:8080"
    process.env.NO_PROXY = "example.com"
    const result = getProxyForUrl("http://example.com")
    expect(result).toBeUndefined()
  })

  test("wildcard no_proxy blocks all", () => {
    process.env.http_proxy = "http://proxy.local:8080"
    process.env.NO_PROXY = "*"
    const result = getProxyForUrl("http://anything.com")
    expect(result).toBeUndefined()
  })

  test("falls back to all_proxy", () => {
    process.env.ALL_PROXY = "http://fallback-proxy:8888"
    const result = getProxyForUrl("http://example.com")
    expect(result).toBe("http://fallback-proxy:8888")
  })

  test("no_proxy with port restriction allows different port", () => {
    process.env.https_proxy = "http://proxy.local:8080"
    process.env.no_proxy = "example.com:80"
    // Different port (443 vs 80) should still proxy
    const result = getProxyForUrl("https://example.com:443")
    expect(result).toBe("http://proxy.local:8080")
  })

  test("invalid URL returns undefined", () => {
    expect(getProxyForUrl("not-a-url")).toBeUndefined()
  })
})
