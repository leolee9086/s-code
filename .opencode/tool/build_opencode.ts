import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"
import { dlopen, ptr, CString } from "bun:ffi"
import { execSync } from "child_process"

function getWindowsProxy(): { http?: string; https?: string } | null {
  try {
    // Try reading Windows system proxy via reg.exe (fast, built-in)
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
  description: "构建 opencode 自身 — 构建成功后打开一个新的 dev 窗口，续接当前 session",
  args: {},
  async execute(_args: {}, ctx: ToolContext) {
    const { $ } = await import("bun")
    const path = await import("path")
    const cp = await import("child_process")

    const pkgDir = path.join(ctx.worktree!, "packages", "opencode")
    const debug = `worktree: ${ctx.worktree}, pkgDir: ${pkgDir}`

    try {
      await $`bun turbo typecheck`.cwd(ctx.worktree!).quiet()
    } catch (e: any) {
      return `typecheck 失败，中止构建:\n${e.stderr?.toString() ?? e.message ?? e}`
    }

    // Try build first; if network fails, auto-detect system proxy and retry
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

      // Auto-detect and set system proxy, then retry once
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
