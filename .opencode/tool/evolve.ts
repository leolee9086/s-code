import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"

// 平台名 → build 脚本中的命名规则
// build.ts: item.os === "win32" ? "windows" : item.os
function platformName(platform: string): string {
  return platform === "win32" ? "windows" : platform
}

// 构建产物的平台目录名，匹配 script/build.ts 的 name 生成逻辑
function binaryDirname(pkgName: string): string {
  return [pkgName, platformName(process.platform), process.arch].join("-")
}

/**
 * 恢复控制台原始模式（Windows）。
 * 与 TUI win32.ts 中的 win32InstallCtrlCGuard cleanup 逻辑一致：
 * - 重新启用 ENABLE_PROCESSED_INPUT，让 Ctrl+C 恢复为标准控制台事件
 * - 清空输入缓冲区
 */
function restoreConsole(): void {
  if (process.platform !== "win32") return
  try {
    // 使用动态 import 避免模块顶层的 `bun:ffi` 依赖导致启动失败
    const ffi = require("bun:ffi") as typeof import("bun:ffi")
    const k32 = ffi.dlopen("kernel32.dll", {
      GetStdHandle: { args: ["i32"], returns: "ptr" },
      GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
      SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
      FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
    })
    const STD_INPUT_HANDLE = -10
    const ENABLE_PROCESSED_INPUT = 0x0001

    const handle = k32.symbols.GetStdHandle(STD_INPUT_HANDLE)
    const buf = new Uint32Array(1)
    if (k32.symbols.GetConsoleMode(handle, ffi.ptr(buf)) !== 0) {
      // 重新启用 ENABLE_PROCESSED_INPUT
      k32.symbols.SetConsoleMode(handle, buf[0]! | ENABLE_PROCESSED_INPUT)
    }
    // 清空缓冲区，防止残留按键输入影响新窗口
    k32.symbols.FlushConsoleInputBuffer(handle)
  } catch {
    // 非 TTY 或无权限时静默忽略
  }
}

/**
 * 优雅关闭旧进程，与 TUI 下 Ctrl+C 走完全相同的退出路径。
 *
 * - **Unix/macOS**: 发送 SIGHUP 信号 → TUI 的 SIGHUP 处理器执行完整清理链
 *   （unguard → renderer.destroy → completeExit → thread.ts stopWorker → exit）。
 * - **Windows**: 无 SIGHUP，直接执行最小清理后退出（恢复控制台模式、清空输入缓冲区、
 *   退出 raw mode），避免新窗口继承损坏的控制台状态导致光标闪烁。
 */
function gracefulExit(): void {
  // 先退出 stdin raw mode（通用）
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false)
    }
  } catch {
    // 忽略
  }

  if (process.platform === "win32") {
    restoreConsole()
    process.exit(0)
  } else {
    // Unix: SIGHUP → TUI 的 onSighup → exit() → cleanup → unguard → renderer.destroy
    // 用 setTimeout 确保在当前工具返回后才触发，避免干扰 Effect 执行
    setTimeout(() => process.kill(process.pid, "SIGHUP"), 100).unref()
  }
}

export default tool({
  description:
    "进入下一轮进化：类型检查 → 构建 → 启动新版本 → 优雅退出旧进程。激活进化后只能用此工具结束每一轮。",
  args: {
    message: tool.schema.string().describe("进化续进消息：本轮做了什么，下一轮应该做什么"),
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext) {
    const { $ } = await import("bun")
    const pathM = await import("path")
    const cp = await import("child_process")

    const worktree = ctx.worktree!
    const pkgDir = pathM.join(worktree, "packages", "opencode")
    const pkgJson = JSON.parse(readFileSync(pathM.join(pkgDir, "package.json"), "utf-8"))
    const binDir = binaryDirname(pkgJson.name)
    const binary = pathM.join(
      pkgDir,
      "dist",
      binDir,
      "bin",
      `opencode${process.platform === "win32" ? ".exe" : ""}`,
    )

    const lines: string[] = []

    // 1. 类型检查
    lines.push("▶ 类型检查...")
    try {
      await $`bun turbo typecheck`.cwd(worktree).quiet()
      lines.push("   ✓ 通过")
    } catch (e: any) {
      return `类型检查失败，进化中止:\n${e.stderr?.toString() ?? e.message ?? String(e)}`
    }

    // 2. 构建
    lines.push("▶ 构建...")
    try {
      await $`bun run build --single --skip-install --skip-embed-web-ui`.cwd(pkgDir).quiet()
      lines.push("   ✓ 构建成功")
    } catch (e: any) {
      return `构建失败，进化中止:\n${e.stderr?.toString() ?? e.message ?? String(e)}`
    }

    lines.push(`▶ 版本: v${pkgJson.version}`)

    // 3. 启动新窗口
    // 用 --prompt 直传递进消息，避免文件读写竞态
    const sessionId = ctx?.sessionID
    const prompt = args.message as string
    const binArgs = sessionId
      ? ["-s", sessionId, "--prompt", prompt]
      : ["--prompt", prompt]

    const env = {
      ...(process.env as Record<string, string>),
      S_CODE_EVOLVE: "1",
    }

    if (process.platform === "win32") {
      // Windows: start 新控制台窗口
      cp.spawn("cmd.exe", ["/c", "start", "", "cmd", "/c", binary, ...binArgs], {
        detached: true,
        stdio: "ignore",
        env,
      })
    } else if (process.platform === "darwin") {
      // macOS: open 新 Terminal 窗口
      // 用 osascript 打开 Terminal 并执行命令，避免 "open -a Terminal" 的行为不确定性
      const escaped = [binary, ...binArgs]
        .map((a) => a.replace(/'/g, "'\\''"))
        .join("' '")
      cp.execSync(`open -a Terminal " '${escaped}' "`, { env })
    } else {
      // Linux: x-terminal-emulator（Debian/Ubuntu 标准）
      // 回退 gnome-terminal / xterm
      try {
        cp.spawn("x-terminal-emulator", ["-e", binary, ...binArgs], {
          detached: true,
          stdio: "ignore",
          env,
        })
      } catch {
        cp.spawn("gnome-terminal", ["--", binary, ...binArgs], {
          detached: true,
          stdio: "ignore",
          env,
        })
      }
    }

    // 4. 优雅退出旧进程
    // 与 TUI 下 Ctrl+C 走完全相同的退出路径，确保控制台状态被正确恢复、
    // 输入缓冲区被清空，新窗口不会继承损坏的状态。
    gracefulExit()

    return lines.join("\n")
  },
})
