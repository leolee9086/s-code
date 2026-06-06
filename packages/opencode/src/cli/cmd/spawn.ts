// --spawn 命令行入口点
//
// 子进程启动入口：opencode --spawn <init-json>
// 启动一个永续模式子进程，与父进程通过 HTTP relay 通信。
//
// init-json 格式：
// {
//   "sessionID": "已有的 session ID（可选，留空则新建）",
//   "parentURL": "父进程 HTTP relay 地址（可选）",
//   "prompt": "初始提示词（可选）"
// }

import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { setForeverMode, clearForeverMode } from "@/forever/forever"

export const SpawnCommand = effectCmd({
  command: "--spawn [init-json]",
  describe: false,
  instance: true,
  builder: (yargs) =>
    yargs.positional("init-json", {
      type: "string",
      describe: "JSON config for initialization",
    }),
  handler: Effect.fn("Cli.spawn")(function* (args: { "init-json"?: string }) {
    // 1. 解析 init JSON
    const initRaw = args["init-json"]
    if (!initRaw) {
      return yield* fail("init-json argument is required for spawn mode")
    }

    let init: { sessionID?: string; parentURL?: string; prompt?: string }
    try {
      init = JSON.parse(initRaw)
    } catch {
      return yield* fail("init-json must be valid JSON")
    }

    // 2. 启动永续模式
    setForeverMode()

    // 3. 注册到父进程中继（如果提供了 parentURL）
    if (init.parentURL) {
      const registerUrl = `${init.parentURL}/api/relay/register`
      yield* Effect.tryPromise({
        try: () =>
          fetch(registerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionID: init.sessionID,
              httpURL: `http://localhost:${process.env["PORT"] || "4096"}`,
              pid: process.pid,
            }),
          }),
        catch: (error) => {
          console.error("failed to register with parent relay:", error)
        },
      }).pipe(Effect.ignore)
    }

    // 4. 通过 SDK 创建 session 并进入永续循环
    const { createOpencodeClient } = yield* Effect.promise(() => import("@opencode-ai/sdk/v2"))

    const client = createOpencodeClient({
      baseUrl: `http://localhost:${process.env["PORT"] || "4096"}`,
    })

    // 如果有 sessionID，恢复 session；否则创建新 session
    let sessionID: string | undefined = init.sessionID
    if (!sessionID) {
      const created = yield* Effect.promise(() => client.session.create({}))
      sessionID = (created as any).id ?? (created as any).data?.id
    }
    if (!sessionID) return yield* fail("failed to create or resolve session")

    // 如果有初始提示词，先发送
    const initPrompt = init.prompt
    if (initPrompt) {
      yield* Effect.promise(() =>
        client.session.prompt({
          sessionID,
          agent: "build",
          parts: [{ type: "text", text: initPrompt }],
        }),
      )
    }

    // 5. 通过 HTTP API 调用 forever 循环（复用已有的 session.forever 端点）
    // 这会阻塞直到永续模式退出（预算耗尽 / 手动停止）
    const foreverUrl = `http://localhost:${process.env["PORT"] || "4096"}/api/sessions/${sessionID}/forever`
    yield* Effect.tryPromise({
      try: () =>
        fetch(foreverUrl, { method: "POST" }).then(async (r) => {
          if (!r.ok) {
            const text = await r.text().catch(() => "")
            throw new Error(`forever loop failed: ${r.status} ${text}`)
          }
        }),
      catch: (error) => {
        console.error("forever loop exited with error:", error)
      },
    }).pipe(Effect.ignore)

    // 6. 永续模式结束，清理
    clearForeverMode()

    // 通知父进程
    if (init.parentURL) {
      const unregisterUrl = `${init.parentURL}/api/relay/unregister`
      yield* Effect.tryPromise({
        try: () =>
          fetch(unregisterUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID }),
          }),
        catch: () => {},
      }).pipe(Effect.ignore)
    }
  }),
})
