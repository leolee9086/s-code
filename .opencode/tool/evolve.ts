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

    // s-temp 是仓库根目录的平级目录（d:/dev/s-temp），不是子目录
    const sTempDir = pathM.join(pathM.dirname(worktree), "s-temp")

    // 轮次计数器，确保每次 evolve 输出不同文件名，永不文件锁冲突
    const countPath = pathM.join(sTempDir, ".evolve-round")
    let round = 0
    try {
      const { readFileSync } = await import("fs")
      round = Number(readFileSync(countPath, "utf-8").trim()) || 0
    } catch { /* 首次默认 0 */ }
    const { writeFileSync, mkdirSync } = await import("fs")
    mkdirSync(sTempDir, { recursive: true })
    writeFileSync(countPath, String(round + 1), "utf-8")

    const binarySuffix = `${sessionId}-${round}`
    const binary = pathM.join(pkgDir, distOutDir, binDir, "bin", `opencode-${binarySuffix}${process.platform === "win32" ? ".exe" : ""}`)

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
    const buildArgs = ["run", "build", "--single", "--skip-install", "--skip-embed-web-ui", "--outdir", distOutDir, "--binary-suffix", binarySuffix]
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
    // 包 <system-reminder> 标签，让 AI 能区分系统注入与用户实际输入
    const taggedMsg = `<system-remotion>\n${prompt}\n</system-remotion>`
    try {
      const { writeFileSync, mkdirSync } = await import("fs")
      mkdirSync(sTempDir, { recursive: true })
      writeFileSync(pathM.join(sTempDir, ".evolve-msg.txt"), taggedMsg, "utf-8")
    } catch {
      // 写入失败不应阻塞进化
    }

    // evolve 构建的是本地开发二进制，始终使用 local 数据库渠道。
    // 不使用 ctx.channel：如果当前二进制是 evolve 自构建的（OPENCODE_CHANNEL='dev'），
    // ctx.channel 会返回 "dev" 而非 "local"，导致子进程连到 opencode-dev.db（schema 不兼容）。
    const binArgs = sessionId
      ? ["-s", sessionId, "--prompt", prompt, "--channel", "local"]
      : ["--prompt", prompt, "--channel", "local"]

    // 必须传递 S_CODE_TEMP 和 S_CODE_EVOLVE，否则子进程的 evolveDir() 推算路径错误，
    // isInEvolveScope() 无法将 s-temp 加入白名单，导致工具反复弹 external_directory 授权。
    const env = {
      ...process.env as Record<string, string>,
      S_CODE_EVOLVE: "1",
      S_CODE_TEMP: sTempDir,
    }

    if (process.platform === "win32") {
      // Windows: start 新控制台窗口，先恢复控制台模式防止终端紊乱
      try {
        const { dlopen, ptr } = await import("bun:ffi")
        const k32 = dlopen("kernel32.dll", {
          GetStdHandle: { args: ["i32"], returns: "ptr" },
          GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
          SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
        })
        const handle = k32.symbols.GetStdHandle(-10)
        const modeBuf = new Uint32Array(1)
        k32.symbols.GetConsoleMode(handle, ptr(modeBuf))
        k32.symbols.SetConsoleMode(handle, (modeBuf[0]! & ~0x0018) | 0x0007)
      } catch { /* 非终端环境忽略 */ }
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

    // 下个 tick 立即自杀，确保 tool 返回值先传播出去。
    // process.exit(0) 触发 Worker exit 事件，
    // thread.ts 通过 onWorkerExit 路由到 TUI lifecycle.exit()，
    // 走完整退出路径（cleanup → renderer.destroy → stop），与 Ctrl+C 行为完全一致。
    setImmediate(() => process.exit(0))

    return lines.join("\n")
  },
})
