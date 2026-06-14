import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"
import { execSync } from "child_process"

function getWindowsProxy(): { http?: string; https?: string } | null {
  try {
    const enableRaw = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable`,
      { encoding: "utf8", timeout: 2000 },
    )
    if (!enableRaw.includes("0x1")) return null

    const serverRaw = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer`,
      { encoding: "utf8", timeout: 2000 },
    )
    const match = serverRaw.match(/ProxyServer\s+REG_SZ\s+(\S+)/)
    if (!match) return null

    const proxy = match[1]!.trim()
    if (!proxy) return null

    return { http: `http://${proxy}`, https: `http://${proxy}` }
  } catch {
    return null
  }
}

function ensureProxy(force?: boolean) {
  if (!force && process.env.HTTPS_PROXY) return
  const proxy = getWindowsProxy()
  if (proxy) {
    if (!process.env.HTTPS_PROXY) process.env.HTTPS_PROXY = proxy.https!
    if (!process.env.HTTP_PROXY) process.env.HTTP_PROXY = proxy.http!
  }
}

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

    try {
      await $`bun turbo typecheck`.cwd(ctx.worktree!).quiet()
    } catch (e: any) {
      return `typecheck 失败，中止构建:\n${e.stderr?.toString() ?? e.message ?? e}`
    }

    let buildResult
    try {
      buildResult = await $`bun run build --single --skip-install --skip-embed-web-ui`
        .cwd(pkgDir)
        .quiet()
    } catch (e: any) {
      const isNetError = (msg: string) =>
        msg.includes("Unable to connect") || msg.includes("ConnectionRefused") || msg.includes("ETIMEDOUT")

      const msg = e.stderr?.toString() ?? e.message ?? String(e)
      if (!isNetError(msg)) return `构建失败:\n${msg}`

      ensureProxy()
      if (!process.env.HTTPS_PROXY) {
        return [
          `构建失败：网络错误`,
          ``,
          msg,
          ``,
          `提示：当前网络可能需要代理才能访问 models.dev。`,
          `请设置 HTTPS_PROXY 环境变量后重试：`,
          `  $env:HTTPS_PROXY="http://你的代理地址:端口"`,
          `  $env:HTTP_PROXY="http://你的代理地址:端口"`,
          `  bun run build --single --skip-install --skip-embed-web-ui`,
        ].join("\n")
      }

      try {
        buildResult = await $`bun run build --single --skip-install --skip-embed-web-ui`
          .cwd(pkgDir)
          .quiet()
      } catch (e2: any) {
        return `构建失败（已尝试系统代理，${process.env.HTTPS_PROXY}）:\n${e2.stderr?.toString() ?? e2.message ?? String(e2)}`
      }
    }
  
    const exists = await fs.stat(builtPath).then(() => true).catch(() => false)
    if (!exists) {
      return `构建失败：未找到输出文件 ${builtPath}\n${buildResult.text()}`
    }
  
    // 先删除原文件（Windows 允许删除正在运行的 .exe），避免 rename + copy 的跨盘符问题
    await fs.unlink(globalPath).catch(() => {})
  
    // 直接复制，不经过 rename（同一盘符或跨盘符均可）
    await fs.copyFile(builtPath, globalPath)
  
    // 校验：确认复制后的文件大小一致
    const actualSize = await fs.stat(globalPath).then(s => s.size).catch(() => 0)
    const expectedSize = await fs.stat(builtPath).then(s => s.size).catch(() => 0)
    if (actualSize !== expectedSize) {
      return `部署失败：文件大小不匹配！\n构建输出 (${builtPath})：${expectedSize} 字节\n部署位置 (${globalPath})：${actualSize} 字节`
    }

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
