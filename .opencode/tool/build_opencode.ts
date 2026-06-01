import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"

export default tool({
  description: "构建 opencode 自身 — 构建成功后打开一个新的 dev 窗口，续接当前 session",
  args: {},
  async execute(_args: {}, ctx: ToolContext) {
    const { $ } = await import("bun")
    const path = await import("path")
    const cp = await import("child_process")

    const pkgDir = path.join(ctx.worktree!, "packages", "opencode")
    const debug = `worktree: ${ctx.worktree}, pkgDir: ${pkgDir}`

    const buildResult = await $`bun run build --single --skip-install --skip-embed-web-ui`
      .cwd(pkgDir)
      .quiet()

    const { version } = JSON.parse(
      await Bun.file(path.join(pkgDir, "package.json")).text(),
    )

    const sessionId = ctx?.sessionID
    const devCmd = sessionId
      ? `bun run --conditions=browser ./src/index.ts --session ${sessionId}`
      : "bun run dev"

    cp.spawn("cmd", ["/c", "start", "", "pwsh", "-NoExit", "-Command", devCmd], {
      cwd: pkgDir,
      detached: true,
      stdio: "ignore",
    })

    return [
      debug,
      `构建成功 v${version}`,
      sessionId ? `续接 session: ${sessionId}` : "已打开新的 dev 窗口",
      buildResult.text(),
    ].join("\n")
  },
})
