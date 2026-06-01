import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"

export default tool({
  description: "构建 opencode 并部署到全局安装位置，替换当前版本后打开新窗口",
  args: {},
  async execute(_args: {}, ctx: ToolContext) {
    const { $ } = await import("bun")
    const path = await import("path")
    const fs = await import("fs/promises")
    const cp = await import("child_process")

    const pkgDir = path.join(ctx.worktree!, "packages", "opencode")
    const binaryName = "opencode-windows-x64"
    const builtPath = path.join(pkgDir, "dist", binaryName, "bin", "opencode.exe")
    const globalPath = "C:\\Users\\al765\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe"

    const buildResult = await $`bun run build --single --skip-install --skip-embed-web-ui`
      .cwd(pkgDir)
      .quiet()

    const exists = await fs.stat(builtPath).then(() => true).catch(() => false)
    if (!exists) {
      return `构建失败：未找到输出文件 ${builtPath}\n${buildResult.text()}`
    }

    const backupPath = globalPath + ".bak"
    try {
      await fs.rename(globalPath, backupPath)
    } catch {
      try { await fs.unlink(backupPath).catch(() => {}) } catch {}
    }

    await fs.copyFile(builtPath, globalPath)

    try { await fs.unlink(backupPath).catch(() => {}) } catch {}

    const { version } = JSON.parse(
      await Bun.file(path.join(pkgDir, "package.json")).text(),
    )

    cp.spawn("cmd", ["/c", "start", "", "pwsh", "-NoExit", "-Command", "opencode"], {
      cwd: pkgDir,
      detached: true,
      stdio: "ignore",
    })

    return `构建完成 v${version}，已部署到全局路径 ${globalPath}\n${buildResult.text()}`
  },
})
