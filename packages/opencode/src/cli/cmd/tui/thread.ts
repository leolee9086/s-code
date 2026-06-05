import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import * as Log from "@opencode-ai/core/util/log"
import { errorMessage } from "@/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { writeHeapSnapshot } from "v8"
import { TuiConfig } from "./config/tui"
import {
  OPENCODE_PROCESS_ROLE,
  OPENCODE_RUN_ID,
  ensureRunID,
  sanitizedProcessEnv,
} from "@opencode-ai/core/util/opencode-process"
import { validateSession } from "./validate-session"
import { Database } from "bun:sqlite"
import { xdgData } from "xdg-basedir"
import { checkSchema } from "@opencode-ai/core/database/schema-check"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return Filesystem.resolve(cwd)
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start opencode tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start opencode in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())
      const env = sanitizedProcessEnv({
        [OPENCODE_PROCESS_ROLE]: "worker",
        [OPENCODE_RUN_ID]: ensureRunID(),
      })

      // 在 Worker 启动前检查数据库表结构兼容性
      if (!process.env.OPENCODE_SKIP_SCHEMA_CHECK) {
        try {
          const channel = process.env.OPENCODE_CHANNEL || "local"
          const dbName = ["latest", "beta", "prod"].includes(channel) ? "opencode.db" : `opencode-${channel}.db`
          const dataDir = path.join(xdgData!, "opencode")
          const dbPath = path.join(dataDir, dbName)
          const db = new Database(dbPath, { readonly: true })
          const rows = db
            .prepare(
              `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'`,
            )
            .all() as { name: string; sql: string }[]
          db.close()
          const result = checkSchema(rows)
          if (!result.compatible) {
            console.error("")
            console.error("  Database schema mismatch:")
            for (const l of result.message.split("\n")) console.error("    " + l)
            console.error("")
            console.error("  Set OPENCODE_SKIP_SCHEMA_CHECK=1 to bypass.")
            console.error("")
            process.exit(1)
          }
        } catch {
          // DB 还不存在（首次启动）或其它临时错误，跳过
        }
      }

      const worker = new Worker(file, {
        env,
      })
      worker.onerror = (e) => {
        Log.Default.error("thread error", {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error: e.error,
        })
      }

      const client = Rpc.client<typeof rpc>(worker)
      const error = (e: unknown) => {
        Log.Default.error("process error", { error: errorMessage(e) })
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: errorMessage(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      // Worker 意外退出（如 evolve tool 中的 process.exit）触发线程退出。
      // 先恢复控制台模式再退出，与 Ctrl+C 行为一致。
      worker.addEventListener("exit", () => {
        unguard?.()
        process.exit(0)
      })

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: errorMessage(error),
          })
        })
        worker.terminate()
      }

      // Worker 意外退出（如 evolve tool 调用 process.exit）时触发退出流程，
      // 行为和 Ctrl+C 一致
      worker.addEventListener("exit", () => {
        if (!stopped) stop()
      })

      const prompt = await input(args.prompt)

      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      let sessionNotFound: string | undefined
      if (args.session) {
        try {
          await validateSession({
            url: transport.url,
            sessionID: args.session,
            directory: cwd,
            fetch: transport.fetch,
          })
        } catch (error) {
          sessionNotFound = errorMessage(error)
        }
      }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        const { createTuiRenderer, tui } = await import("./app")
        const renderer = await createTuiRenderer(config)
        const handle = tui({
          url: transport.url,
          renderer,
          async onSnapshot() {
            const tui = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tui, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: sessionNotFound ? undefined : args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
            sessionNotFound,
            pendingPrompt: sessionNotFound ? prompt : undefined,
          },
        })
        await handle.done
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
    process.exit(0)
  },
})
// scratch
