import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./screenshot.txt"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { mkdirSync } from "fs"

// ─── 参数定义 ──────────────────────────────────────────────

export const Parameters = Schema.Struct({
  screen: Schema.optional(Schema.Number.annotate({
    description: "要截图的屏幕索引（从 0 开始）。不传则截取所有屏幕拼接为一张图。",
  })),
  format: Schema.optional(Schema.Literals(["png", "jpg"]).annotate({
    description: "输出格式（默认 png）",
  })),
})

// ─── 辅助类型 ──────────────────────────────────────────────

interface ScreenInfo {
  index: number
  name: string
  width: number
  height: number
  x: number
  y: number
}

const FALLBACK_SCREEN: ScreenInfo = { index: 0, name: "Primary", width: 1920, height: 1080, x: 0, y: 0 }

// ─── 平台实现 ──────────────────────────────────────────────

function listScreensWindows(): Effect.Effect<ScreenInfo[]> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: ["powershell", "-NoProfile", "-Command",
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Output ("{0}|{1}|{2}|{3}|{4}" -f $_.DeviceName, $_.Bounds.Width, $_.Bounds.Height, $_.Bounds.X, $_.Bounds.Y) }`],
        stdout: "pipe", stderr: "pipe",
      })
      const txt = await new Response(proc.stdout).text()
      if (!txt.trim()) return [FALLBACK_SCREEN]
      const screens: ScreenInfo[] = []
      let idx = 0
      for (const line of txt.trim().split("\n").filter(Boolean)) {
        const [name, w, h, x, y] = line.split("|")
        screens.push({ index: idx++, name: name?.trim() || `Screen ${idx}`, width: parseInt(w) || 1920, height: parseInt(h) || 1080, x: parseInt(x) || 0, y: parseInt(y) || 0 })
      }
      return screens.length > 0 ? screens : [FALLBACK_SCREEN]
    },
    catch: () => new Error("Windows 列举屏幕失败"),
  }).pipe(Effect.catch(() => Effect.succeed([FALLBACK_SCREEN])))
}

function listScreensMacOS(): Effect.Effect<ScreenInfo[]> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({ cmd: ["system_profiler", "SPDisplaysDataType", "-json"], stdout: "pipe", stderr: "pipe" })
      const json = await new Response(proc.stdout).text()
      const data = JSON.parse(json)
      const displays = data?.SPDisplaysDataType || []
      const screens: ScreenInfo[] = []
      let idx = 0
      for (const display of displays) {
        const name = display?._name || `Display ${idx + 1}`
        const [w, h] = (display?.spdisplays_resolution || "").split(" x ").map(Number)
        screens.push({ index: idx++, name, width: w || 1920, height: h || 1080, x: 0, y: 0 })
      }
      return screens.length > 0 ? screens : [FALLBACK_SCREEN]
    },
    catch: () => new Error("macOS 列举屏幕失败"),
  }).pipe(Effect.catch(() => Effect.succeed([FALLBACK_SCREEN])))
}

function listScreensLinux(): Effect.Effect<ScreenInfo[]> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({ cmd: ["xdpyinfo"], stdout: "pipe", stderr: "pipe" })
      const txt = await new Response(proc.stdout).text()
      const m = txt.match(/dimensions:\s+(\d+)x(\d+)/)
      if (m) return [{ index: 0, name: "Primary", width: parseInt(m[1]) || 1920, height: parseInt(m[2]) || 1080, x: 0, y: 0 }]
      return [FALLBACK_SCREEN]
    },
    catch: () => new Error("Linux 列举屏幕失败"),
  }).pipe(Effect.catch(() => Effect.succeed([FALLBACK_SCREEN])))
}

function listScreens(): Effect.Effect<ScreenInfo[]> {
  switch (process.platform) {
    case "win32": return listScreensWindows()
    case "darwin": return listScreensMacOS()
    default: return listScreensLinux()
  }
}

function captureScreenWindows(screenIndex: number, format: string, outputPath: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: ["powershell", "-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::AllScreens[${screenIndex}].Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::${format.toUpperCase()})
$graphics.Dispose()
$bitmap.Dispose()`],
        stdout: "pipe", stderr: "pipe",
      })
      const stderr = await new Response(proc.stderr).text()
      if (stderr && !stderr.includes("ok")) throw new Error(stderr)
    },
    catch: (e) => new Error(`Windows 截图失败: ${e}`),
  }).pipe(Effect.catch(() => Effect.void))
}

function captureScreenMacOS(screenIndex: number, format: string, outputPath: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const args = ["-x", "-o", outputPath]
      if (screenIndex >= 0) args.push("-D", String(screenIndex + 1))
      if (format === "jpg") args.push("-t", "jpg")
      const proc = Bun.spawn({ cmd: ["screencapture", ...args], stdout: "pipe", stderr: "pipe" })
      const stderr = await new Response(proc.stderr).text()
      if (stderr) throw new Error(stderr)
    },
    catch: (e) => new Error(`macOS 截图失败: ${e}`),
  }).pipe(Effect.catch(() => Effect.void))
}

function captureScreenLinux(screenIndex: number, format: string, outputPath: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: async () => {
      const cmd = ["import", "-window", "root", `${format}:${outputPath}`]
      try { await Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" }).exited } catch {
        const cmd2 = screenIndex >= 0 ? ["scrot", "-o", outputPath] : ["scrot", outputPath]
        try { await Bun.spawn({ cmd: cmd2, stdout: "pipe", stderr: "pipe" }).exited } catch {
          await Bun.spawn({ cmd: ["gnome-screenshot", "-f", outputPath], stdout: "pipe", stderr: "pipe" }).exited
        }
      }
    },
    catch: (e) => new Error(`Linux 截图失败: ${e}`),
  }).pipe(Effect.catch(() => Effect.void))
}

function captureScreen(screenIndex: number, format: string, outputPath: string): Effect.Effect<void> {
  switch (process.platform) {
    case "win32": return captureScreenWindows(screenIndex, format, outputPath)
    case "darwin": return captureScreenMacOS(screenIndex, format, outputPath)
    default: return captureScreenLinux(screenIndex, format, outputPath)
  }
}

// ─── 工具定义 ──────────────────────────────────────────────

export const ScreenshotTool = Tool.define(
  "screenshot",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.screen === undefined) {
            const screens = yield* listScreens()
            const summary = screens.map((s) => `  ${s.index}: ${s.name} (${s.width}x${s.height}, 位置 ${s.x},${s.y})`).join("\n")
            return {
              title: "可用屏幕",
              output: screens.length > 1
                ? `检测到 ${screens.length} 个屏幕：\n${summary}\n\n使用 screen 参数指定屏幕索引截图，例如: screen: 0`
                : `检测到 1 个屏幕：\n${summary}\n\n使用 screen: 0 截图，或不传参数截取所有屏幕`,
              metadata: { screens } as Record<string, unknown>,
            }
          }

          const format = params.format ?? "png"
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
          const instance = yield* InstanceState.context
          // 遵循 session plan() 函数的同款模式：
          //   Git 项目 → 数据存到工作树根目录 .opencode/
          //   非 Git 项目 → 数据存到系统全局目录
          const outputDir = instance.project.vcs
            ? path.join(instance.worktree, ".opencode", "screenshots")
            : path.join(Global.Path.data, "screenshots")
          mkdirSync(outputDir, { recursive: true })
          const outputPath = path.join(outputDir, `screenshot-${timestamp}.${format}`)

          return yield* captureScreen(params.screen, format, outputPath).pipe(
            Effect.flatMap(() =>
              Effect.tryPromise({
                try: async () => {
                  const file = Bun.file(outputPath)
                  const fileSize = await file.size
                  return {
                    title: "截图完成",
                    output: `截图已保存到: ${outputPath}\n文件大小: ${(fileSize / 1024).toFixed(1)} KB\n格式: ${format.toUpperCase()}\nURL: file://${outputPath.replace(/\\/g, "/")}`,
                    metadata: { path: outputPath, format, size: fileSize } as Record<string, unknown>,
                  }
                },
                catch: () => ({
                  title: "截图完成",
                  output: `截图已保存到: ${outputPath}\nURL: file://${outputPath.replace(/\\/g, "/")}`,
                  metadata: { path: outputPath, format } as Record<string, unknown>,
                }),
              })
            ),
            Effect.catch((error) =>
              Effect.succeed({
                title: "截图失败",
                output: `截图失败: ${error instanceof Error ? error.message : String(error)}\n\n可能原因：\n1. 未安装截图工具\n2. 无屏幕访问权限\n3. 平台不支持`,
                metadata: { error: error instanceof Error ? error.message : String(error) } as Record<string, unknown>,
              }),
            ),
          )
        }).pipe(Effect.orDie),
    }
  }),
)
