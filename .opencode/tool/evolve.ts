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

    // 自构建场景（进程运行在 dist-tick/ 或 dist-toc/ 下）：
    // build.ts 的 rm -rf 和覆写二进制在 Windows 上会因为 EXE 运行中而失败。
    // evolve 交替使用 dist-tick / dist-toc 两个固定目录，
    // 用 --binary-suffix <sessionId> 区分不同 session 的文件名。
    // 同目录下文件名不同，多个 session 可同时 evolve 不冲突。
    // dist（无后缀）保留给正常构建（build_opencode / build_and_deploy_opencode）。
    const sessionId = ctx?.sessionID ?? "default"
    const execPath = process.execPath?.replace(/\\/g, "/") ?? ""
    const normSep = (p: string) => p.replace(/\\/g, "/")
    const knownDirs = ["dist-tick", "dist-toc"]
    const currentDir = knownDirs.find(d => {
      const dir = normSep(pathM.join(pkgDir, d))
      return execPath.startsWith(dir)
    })
    const distOutDir = currentDir
      ? knownDirs.find(d => d !== currentDir)!
      : "dist-tick"
    const binary = pathM.join(pkgDir, distOutDir, binDir, "bin", `opencode-${sessionId}${process.platform === "win32" ? ".exe" : ""}`)

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
    // --binary-suffix <sessionId> 输出独特文件名，不冲突；--outdir 切换目录避免覆写运行中的 exe
    lines.push("▶ 构建...")
    const buildArgs = ["run", "build", "--single", "--skip-install", "--skip-embed-web-ui", "--outdir", distOutDir, "--binary-suffix", sessionId]
    try {
      await $`bun ${buildArgs}`.cwd(pkgDir).quiet()
      lines.push("   ✓ 构建成功")
    } catch (e: any) {
      return `构建失败，进化中止:\n${e.stderr?.toString() ?? e.message ?? String(e)}`
    }

    lines.push(`▶ 版本: v${pkgJson.version}`)

    // 3. 写入续进消息到文件协议
    // runtime.ts 和 session/prompt.ts 通过 readEvolveMessage() 读取
    // s-temp/.evolve-msg.txt，新窗口启动后自动注入续进消息。
    const prompt = args.message as string
    try {
      const { writeFileSync, mkdirSync } = await import("fs")
      const evolveDir = pathM.join(worktree, "s-temp")
      mkdirSync(evolveDir, { recursive: true })
      writeFileSync(pathM.join(evolveDir, ".evolve-msg.txt"), prompt, "utf-8")
    } catch {
      // 写入失败不应阻塞进化
    }

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
