/**
 * 系统代理检测模块
 *
 * 自动检测可用的 HTTP/HTTPS 代理，供各搜索引擎使用。
 *
 * 检测顺序：
 * 1. HTTP_PROXY / HTTPS_PROXY / ALL_PROXY 环境变量
 * 2. 探测常见代理地址（如 127.0.0.1:7890）
 * 3. 无可用代理时返回 undefined
 */
import { Effect } from "effect"

export interface ProxyConfig {
  readonly http?: string
  readonly https?: string
  readonly noProxy?: string
}

/**
 * 从环境变量检测代理配置
 */
export function detectProxyFromEnv(): ProxyConfig {
  const http = process.env.HTTP_PROXY || process.env.http_proxy
  const https = process.env.HTTPS_PROXY || process.env.https_proxy
  const all = process.env.ALL_PROXY || process.env.all_proxy
  const noProxy = process.env.NO_PROXY || process.env.no_proxy

  return {
    http: http || all || undefined,
    https: https || all || undefined,
    noProxy,
  }
}

/**
 * 探测 127.0.0.1:7890 是否可用（常见代理端口）
 */
export function probeCommonProxy(): Effect.Effect<ProxyConfig | undefined> {
  return Effect.gen(function* () {
    const candidates = [
      "http://127.0.0.1:7890",
      "http://127.0.0.1:1080",
      "http://127.0.0.1:1081",
      "http://127.0.0.1:8080",
    ]

    for (const proxy of candidates) {
      try {
        const resp = yield* Effect.promise(() =>
          fetch(proxy, {
            method: "CONNECT",
            signal: AbortSignal.timeout(3000),
          }),
        )
        if (resp.status < 500) {
          return { http: proxy, https: proxy }
        }
      } catch {
        continue
      }
    }
    return undefined
  })
}

/**
 * 获取代理配置：优先环境变量，其次自动探测
 */
export function getProxyConfig(): ProxyConfig {
  const envProxy = detectProxyFromEnv()
  if (envProxy.http || envProxy.https) return envProxy
  return {}
}

export * as Proxy from "./proxy"
