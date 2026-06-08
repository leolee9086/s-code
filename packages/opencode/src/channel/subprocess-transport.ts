// s-code: src/channel/subprocess-transport.ts
//
// 子进程传输层 — 通用 stdin/stdout JSON 行协议。
//
// 任何外部程序只要往本进程的 stdin 写入 JSON WorkerRequest（一行一条），
// 即可从 stdout 读取 JSON WorkerResponse。
//
// 不依赖 s-forge 特定的概念。协议版本 1.0，通过 ping 请求可获取能力声明。

import { createInterface } from "readline"
import { WriteStream, createWriteStream } from "fs"
import type { WorkerRequest, WorkerResponse } from "./types"

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

export const receiveRequest = (): Promise<WorkerRequest | null> =>
  new Promise((resolve) => {
    rl.once("line", (line: string) => {
      const t = line.trim()
      if (!t) { resolve(null); return }
      try { resolve(JSON.parse(t) as WorkerRequest) } catch { resolve(null) }
    })
    rl.once("close", () => resolve(null))
  })

const out = createWriteStream("", { fd: 1 }) as WriteStream
export const sendResponse = (resp: WorkerResponse): void => {
  out.write(JSON.stringify(resp) + "\n")
}

export const logLine = (msg: string): void => {
  try { process.stderr.write(`[worker] ${msg}\n`) } catch {}
}

export const PROTOCOL_VERSION = "1.0"

const ACCOUNT_ID = process.env["OPENCODE_ACCOUNT_ID"] || "s-code-worker"

export const runWorkerLoop = async (
  handler: (req: WorkerRequest) => WorkerResponse | Promise<WorkerResponse>,
): Promise<void> => {
  logLine(`worker v${PROTOCOL_VERSION} ready`)

  for (;;) {
    const req = await receiveRequest()
    if (!req) break

    // 健康检查 + 能力发现
    if (req.type === "ping") {
      sendResponse({
        id: req.id ?? "ping",
        status: "success",
        envelope: {
          channelId: req.envelope?.channelId ?? "",
          channelType: req.envelope?.channelType ?? "generic",
          accountId: ACCOUNT_ID,
          userId: req.envelope?.userId ?? "",
          timestamp: Date.now(),
        },
        result: {
          pong: true,
          version: PROTOCOL_VERSION,
          capabilities: {
            types: ["search", "shell", "read", "write", "edit", "git", "ping"],
            features: { stdin_stdout: true, ring_queue: true },
          },
        },
      })
      continue
    }

    try {
      sendResponse(await handler(req))
    } catch (err) {
      sendResponse({
        id: req.id,
        status: "error",
        envelope: {
          channelId: req.envelope?.channelId ?? "",
          channelType: req.envelope?.channelType ?? "generic",
          accountId: ACCOUNT_ID,
          userId: req.envelope?.userId ?? "",
          timestamp: Date.now(),
        },
        error: { code: "HANDLER_FAILED", message: String(err) },
      })
    }
  }

  logLine("worker exiting")
}

export * as SubprocessTransport from "./subprocess-transport"
