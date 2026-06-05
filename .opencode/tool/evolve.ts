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

export default tool({
  description: "进入下一轮进化：类型检查 → 构建 → 启动新版本 → 自杀。激活进化后只能用此工具结束每一轮。",
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
    const binary = pathM.join(pkgDir, "dist", binDir, "bin", `opencode${process.platform === "win32" ? ".exe" : ""}`)

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
    const channel = ctx.channel
    const binArgs = sessionId
      ? ["-s", sessionId, "--prompt", prompt, "--channel", channel]
      : ["--prompt", prompt, "--channel", channel]

    const env = {
      ...process.env as Record<string, string>,
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
      const escaped = [binary, ...binArgs].map(a => a.replace(/'/g, "'\\''")).join("' '")
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

    // 4. 自杀
    setTimeout(() => process.exit(0), 2000)

    return lines.join("\n")
  },
})
