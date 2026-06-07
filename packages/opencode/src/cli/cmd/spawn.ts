// --spawn 命令行入口点
//
// 子进程启动入口：opencode --spawn <init-json>
//
// 子进程是一个完整的 opencode worker 实例：
//   - 加载自己的 InstanceContext
//   - 启动自己的 HTTP server（接收父进程 relay 消息）
//   - 在新窗口启动 TUI 子进程（`opencode tui --session <id>`）
//   - 注册轮次完成回调，每轮 LLM 响应后向父进程汇报
//   - 运行 SessionPrompt.loop() 永续循环处理消息
//   - 注册到父进程的 relay 路由表
//   - 定时发送心跳
//
// 注意：TUI 不在当前进程内运行，而是通过 child_process.spawn
// 在新的控制台窗口启动独立进程显示。这样父进程窗口和子进程 TUI
// 分别在不同窗口运行，用户可以同时观察两者。
//
// init-json 格式（由 SpawnTool 构造）：
// {
//   "sessionID": "父进程 fork 的 session ID",
//   "agent": "使用的 agent 类型",
//   "prompt": "初始提示词",
//   "parent": { "sessionID": "父 session ID", "httpURL": "父进程 HTTP 地址" }
// }

import { Effect, Context, Option } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { setForeverMode, clearForeverMode } from "@/forever/forever"
import { SessionPrompt } from "@/session/prompt"
import { Injection } from "@/session/injection"
import type { Injection as InjectionInterface } from "@/session/injection"
import { Server } from "@/server/server"
import type { SessionID } from "@/session/schema"

const HEARTBEAT_INTERVAL_MS = 30000

export const SpawnCommand = effectCmd({
  command: "spawn [init-json]",
  describe: false,
  instance: true,
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("init-json", {
      type: "string",
      describe: "JSON config for initialization",
    }),
  handler: Effect.fn("Cli.spawn")(function* (args: { "init-json"?: string } & Record<string, unknown>) {
    const initRaw = args["init-json"]
    if (!initRaw) return yield* fail("init-json argument is required for spawn mode")

    let init: {
      sessionID: string
      agent?: string
      prompt?: string
      parent?: { sessionID: string; httpURL: string }
    }
    try {
      init = JSON.parse(initRaw)
    } catch {
      return yield* fail("init-json must be valid JSON")
    }

    const sessionID = init.sessionID as SessionID
    if (!sessionID) return yield* fail("sessionID is required")

    // 1. 启动 HTTP server
    const opts = yield* resolveNetworkOptions(args as any)
    const server = yield* Effect.promise(() => Server.listen(opts))
    const httpURL = `http://localhost:${server.port}`
    process.env["OPENCODE_HTTP_URL"] = httpURL

    // 2. 注册到父进程 relay
    if (init.parent?.httpURL) {
      yield* Effect.tryPromise({
        try: () =>
          fetch(`${init.parent!.httpURL}/api/relay/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: init.sessionID, httpURL, pid: process.pid }),
          }),
        catch: (error) => {
          console.error("failed to register with parent relay:", error)
        },
      }).pipe(Effect.ignore)
    }

    // 3. 在新窗口启动 TUI 子进程（opencode --session <id> --port <port>）
    // TUI 必须是独立进程，在新控制台窗口显示。
    // 父进程与子进程的 TUI 分别在两个窗口运行。
    // 注意：built 二进制下 process.argv[1] 是 CLI 参数而非入口脚本，
    // 所以用 process.execPath 作为可执行文件路径，只传 flags 而不传入口脚本。
    yield* Effect.promise(() =>
      new Promise<void>((resolve) => {
        try {
          const cp = require("child_process") as typeof import("child_process")
          const binPath = process.execPath?.replace(/\\/g, "/") ?? process.argv[0]
          const isBun = binPath.endsWith("bun") || binPath.endsWith("bun.exe")
          // built 二进制不需要传入口脚本（process.argv[1]）；bun dev 需要
          const tuiArgs = isBun
            ? [process.argv[1], "--session", init.sessionID, "--port", String(server.port)]
            : ["--session", init.sessionID, "--port", String(server.port)]
          // 确保子进程继承 OPENCODE_CHANNEL（--channel 参数设到 env 里的值）
          const tuiEnv = {
            ...process.env as Record<string, string>,
            OPENCODE_HTTP_URL: httpURL,
          }
          if (process.platform === "win32") {
            cp.spawn("cmd.exe", ["/c", "start", "Spawn Session", "cmd", "/c", binPath, ...tuiArgs], {
              detached: true,
              stdio: "ignore",
              env: tuiEnv,
            })
          } else {
            cp.spawn(binPath, tuiArgs, {
              detached: true,
              stdio: "ignore",
              env: tuiEnv,
            })
          }
        } catch (e) {
          console.error("failed to spawn TUI:", e)
        }
        resolve()
      }),
    ).pipe(Effect.ignore)

    // 4. 设置永续模式 + 启动心跳
    setForeverMode()
    const heartbeatTimer = setInterval(() => {
      if (init.parent?.httpURL) {
        fetch(`${init.parent!.httpURL}/api/relay/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: init.sessionID }),
        }).catch(() => {})
      }
    }, HEARTBEAT_INTERVAL_MS)

    // 5. 注册轮次完成回调：每次子进程 LLM 响应后，将结果转发到父进程
    if (init.parent?.httpURL) {
      // Injection.Service 不在 AppServices 类型中，通过 Context 访问（运行时可用）
      const ctx = (yield* Effect.context()) as Context.Context<any>
      const injectionOpt = Context.getOption(ctx, Injection.Service as any) as Option.Option<InjectionInterface.Interface>
      if (Option.isSome(injectionOpt)) {
        const injection = injectionOpt.value
        yield* injection.onRoundComplete(sessionID, (roundCtx) =>
          Effect.gen(function* () {
            const content = roundCtx.lastAssistantMessage
            if (content) {
              yield* Effect.tryPromise({
                try: () =>
                  fetch(`${init.parent!.httpURL}/api/relay/inject`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      targetSessionID: init.parent!.sessionID,
                      messages: [{
                        type: "text" as const,
                        text: [
                          `[子进程 ${sessionID} 汇报]`,
                          content,
                        ].join("\n"),
                        synthetic: true,
                      }],
                    }),
                  }),
                catch: () => {},
              }).pipe(Effect.ignore)
            }
            return { action: "continue" as const }
          }),
        )
      }
    }

    // 6. 发送初始 prompt
    const promptSvc = yield* SessionPrompt.Service
    if (init.prompt) {
      yield* promptSvc.prompt({
        sessionID,
        agent: init.agent ?? "build",
        parts: [{ type: "text", text: init.prompt }],
      }).pipe(Effect.ignore)
    }

    // 7. 启动永续循环
    yield* promptSvc.loop({ sessionID })

    // 8. 清理
    clearForeverMode()
    clearInterval(heartbeatTimer)

    if (init.parent?.httpURL) {
      yield* Effect.tryPromise({
        try: () =>
          fetch(`${init.parent!.httpURL}/api/relay/unregister`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID }),
          }),
        catch: () => {},
      }).pipe(Effect.ignore)
    }

    yield* Effect.promise(() => server.stop(true)).pipe(Effect.ignore)
  }),
})
