import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

export default tool({
  description: "进入下一轮进化：类型检查 → 构建 → 写续进消息 → 启动新版本 → 自杀。激活进化后只能用此工具结束每一轮。",
 args: {
    message: tool.schema.string().describe("进化续进消息：本轮做了什么，下一轮应该做什么"),
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext) {
    const { $ } = await import("bun")
    const pathM = await import("path")
    const cp = await import("child_process")

    const worktree = ctx.worktree!
    const pkgDir = pathM.join(worktree, "packages", "opencode")
    // 进化 temp 目录 = 仓库根目录下的 s-temp
    const tempDir = pathM.join(worktree, "s-temp")
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })

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

    const { version } = JSON.parse(readFileSync(pathM.join(pkgDir, "package.json"), "utf-8"))

    // 3. 写续进消息 + 环境变量
    //   - .evolve-msg.txt 由 TUI session 路由的进化模式自动提交
    //   - S_CODE_EVOLVE=1 激活进化模式
    writeFileSync(pathM.join(tempDir, ".evolve-msg.txt"), args.message as string, "utf-8")
    process.env["S_CODE_EVOLVE"] = "1"
    process.env["S_CODE_TEMP"] = tempDir

    const sessionId = ctx?.sessionID
    // 直接开 TUI，session 路由里新增的进化模式逻辑会自动读 .evolve-msg.txt 并提交
    const devCmd = sessionId
      ? `bun run --conditions=browser ./src/index.ts --session ${sessionId}`
      : "bun run dev"

    // 4. 启动新窗口
    cp.spawn("cmd.exe", ["/c", "start", "", "cmd", "/c", devCmd], {
      cwd: pkgDir,
      detached: true,
      stdio: "ignore",
      env: { ...process.env as Record<string, string>, S_CODE_EVOLVE: "1", S_CODE_TEMP: tempDir },
    })

    lines.push(`▶ 版本: v${version}`)

    // 5. 自杀
    cp.exec(`powershell -Command "Start-Sleep 2; Stop-Process -Id ${process.pid} -Force"`, () => {})

    return lines.join("\n")
  },
})
