import { Installation } from "@/installation"
import { Server } from "@/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

function formatErrorStack(e: unknown): { message: string; stack?: string; cause?: ReturnType<typeof formatErrorStack> } {
  if (e instanceof Error) {
    return {
      message: e.message,
      stack: e.stack?.split("\n").slice(0, 20).join("\n"),
      ...(e.cause ? { cause: formatErrorStack(e.cause) } : {}),
    }
  }
  return { message: String(e) }
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", formatErrorStack(e))
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", formatErrorStack(e))
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  ready() {
    // Rpc.listen(rpc) 之后立即调用。主线程 await client.call("ready")
    // 确保 Worker 已完成初始化（Log.init、Heap.start、GlobalBus.setup），
    // 之后 validateSession 的 RPC bridge fetch 才能正确响应。
    return "ok" as const
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    // 永远在回环地址上启动一个 HTTP 服务器供内部 relay 使用
    if (server) await server.stop(true)
    const internal = await Server.listen({ port: 0, hostname: "127.0.0.1" })
    server = internal

    // 如果用户指定了外部地址，额外监听一个外部服务器（共享同一个 fetch handler）
    const isExternal = input.port !== 0 || input.hostname !== "127.0.0.1"
    if (isExternal) {
      const external = Bun.serve({
        port: input.port,
        hostname: input.hostname,
        fetch: Server.Default().app.fetch,
      })
      // 停止时一起关掉
      const origStop = internal.stop
      ;(server as any).stop = async (close?: boolean) => {
        external.stop(close)
        return origStop(close)
      }
    }

    return { url: internal.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    Log.Default.info("worker shutting down")

    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.exit(0)
  },
}

const parentPid = process.ppid
const watchdog = setInterval(() => {
  try {
    process.kill(parentPid, 0)
  } catch {
    clearInterval(watchdog)
    Log.Default.info("parent process died, worker exiting")
    process.exit(0)
  }
}, 2000)
watchdog.unref()

Rpc.listen(rpc)
