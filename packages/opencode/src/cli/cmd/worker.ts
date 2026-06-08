// s-code: src/cli/cmd/worker.ts
//
// worker 模式入口 — s-code 以子进程方式运行，通过 stdin/stdout
// 与父进程（s-forge）通信，接收并执行工具调用。
//
// 启动: opencode worker
// 接口: 支持 search / shell / read / write / edit / git / ping

import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { SubprocessTransport } from "@/channel"
import type { WorkerRequest, WorkerResponse } from "@/channel"
import { cmd } from "./cmd"

// ── CLI 命令 ──────────────────────────────────────────

export const WorkerCommand = cmd({
  command: "worker",
  describe: "以 worker 子进程模式运行（通过 stdin/stdout 与父进程通信）",
  handler: async () => {
    await SubprocessTransport.runWorkerLoop(handleRequest)
  },
})

// ── 请求分发 ──────────────────────────────────────────

/** 默认调用方标识（可被环境变量覆盖） */
const DEFAULT_ACCOUNT_ID = process.env["OPENCODE_ACCOUNT_ID"] || process.env["S_CODE_ACCOUNT"] || "s-code-worker"

function handleRequest(req: WorkerRequest): WorkerResponse {
  // 响应信封: 从请求透传所有字段。不硬编码通道类型或调用方标识。
  // 任何外部程序都可以设置自己的 channelType 和 accountId。
  const accountId = req.envelope.accountId || DEFAULT_ACCOUNT_ID
  const channelType = req.envelope.channelType || "generic"
  const envelope = {
    channelId: req.envelope.channelId ?? "",
    channelType,
    accountId,
    userId: req.envelope.userId ?? "",
    conversationToken: req.envelope.conversationToken,
    timestamp: Date.now(),
  }

  try {
    switch (req.type) {
      case "search": return handleSearch(req, envelope)
      case "shell":  return handleShell(req, envelope)
      case "read":   return handleRead(req, envelope)
      case "write":  return handleWrite(req, envelope)
      case "edit":   return handleEdit(req, envelope)
      case "git":    return handleGit(req, envelope)
      default:
        return { id: req.id, status: "error", envelope, error: { code: "UNKNOWN_TYPE", message: `unknown type: ${req.type}` } }
    }
  } catch (err) {
    return { id: req.id, status: "error", envelope, error: { code: "HANDLER_ERROR", message: String(err) } }
  }
}

// ── 环境类型 ──────────────────────────────────────────
// 继承自请求信封，不硬编码任何值

type Env = {
  channelId: string
  channelType: string
  accountId: string
  userId: string
  text?: string
  conversationToken?: string
  timestamp: number
}

// ── 搜索 ────────────────────────────────────────────────

interface SearchPayload { query: string; numResults?: number; type?: string }

/** HTML 解析辅助：提取 <a> href + 文本 */
function extractLinks(html: string, linkRegex: RegExp, snippetRegex: RegExp, engine: string, max: number): Array<{ title: string; url: string; snippet: string; engine: string }> {
  const results: Array<{ title: string; url: string; snippet: string; engine: string }> = []
  // 按结果块分割（<li> 或 <div class="result">）
  const blocks = html.split(/<li[^>]*>|<div[^>]*class="[^"]*result[^"]*"[^>]*>/g).slice(1)
  for (const block of blocks) {
    if (results.length >= max) break
    const linkMatch = block.match(linkRegex)
    const snippetMatch = block.match(snippetRegex)
    if (linkMatch) {
      results.push({
        title: (linkMatch[2] ?? linkMatch[1] ?? "").replace(/<[^>]*>/g, "").trim(),
        url: (linkMatch[1] ?? "").replace(/\/url\?q=/, "").split("&")[0],
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "",
        engine,
      })
    }
  }
  return results
}

function handleSearch(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as SearchPayload
  const start = Date.now()
  const max = p.numResults ?? 5
  const allResults: Array<{ title: string; url: string; snippet: string; engine: string }> = []
  const usedEngines: string[] = []

  // 1. DuckDuckGo（免 API Key，通用）
  try {
    const ddgHtml = execSync(`curl -sL "https://html.duckduckgo.com/html/?q=${encodeURIComponent(p.query)}"`, { encoding: "utf-8", timeout: 8000 })
    const ddg = extractLinks(ddgHtml, /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/, /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/, "duckduckgo", max)
    allResults.push(...ddg)
    usedEngines.push("duckduckgo")
  } catch { /* fall through */ }

  // 2. Bing（免 API Key，HTML 解析）
  if (allResults.length < max) {
    try {
      const bingHtml = execSync(`curl -sL "https://www.bing.com/search?q=${encodeURIComponent(p.query)}" -H "User-Agent: Mozilla/5.0"`, { encoding: "utf-8", timeout: 8000 })
      const bing = extractLinks(bingHtml, /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/, /<p[^>]*>([\s\S]*?)<\/p>/, "bing", max - allResults.length)
      allResults.push(...bing)
      usedEngines.push("bing")
    } catch { /* fall through */ }
  }

  // 3. 中文查询时加百度
  if (/[\u4e00-\u9fff]/.test(p.query) && allResults.length < max) {
    try {
      const baiduHtml = execSync(`curl -sL "https://www.baidu.com/s?wd=${encodeURIComponent(p.query)}" -H "User-Agent: Mozilla/5.0"`, { encoding: "utf-8", timeout: 8000 })
      const baidu = extractLinks(baiduHtml, /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/, /<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/, "baidu", max - allResults.length)
      allResults.push(...baidu)
      usedEngines.push("baidu")
    } catch { /* fall through */ }
  }

  return { id: req.id, status: "success", envelope: env, result: { results: allResults.slice(0, max), engines: usedEngines, total: allResults.length, duration: Date.now() - start } }
}

// ── Shell ────────────────────────────────────────────────

interface ShellPayload { command: string; cwd?: string; timeout?: number }
function handleShell(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as ShellPayload
  const start = Date.now()
  const stdout = execSync(p.command, { cwd: p.cwd, encoding: "utf-8", timeout: p.timeout ?? 30000 })
  return { id: req.id, status: "success", envelope: env, result: { stdout: stdout.trim(), stderr: "", exitCode: 0, duration: Date.now() - start } }
}

// ── Read ──────────────────────────────────────────────────

interface ReadPayload { path: string; offset?: number; limit?: number }
function handleRead(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as ReadPayload
  if (!existsSync(p.path)) return { id: req.id, status: "error", envelope: env, error: { code: "FILE_NOT_FOUND", message: `file not found: ${p.path}` } }

  const content = readFileSync(p.path, "utf-8")
  const lines = content.split("\n")
  const offset = p.offset ?? 0
  const limit = p.limit ?? lines.length
  const sliced = lines.slice(offset, offset + limit).join("\n")

  return { id: req.id, status: "success", envelope: env, result: { content: sliced, lines: sliced.split("\n").length, truncated: offset + limit < lines.length } }
}

// ── Write ─────────────────────────────────────────────────

interface WritePayload { path: string; content: string }
function handleWrite(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as WritePayload
  writeFileSync(p.path, p.content, "utf-8")
  return { id: req.id, status: "success", envelope: env, result: { path: p.path, size: p.content.length } }
}

// ── Edit ───────────────────────────────────────────────────

interface EditPayload { path: string; oldString: string; newString: string }
function handleEdit(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as EditPayload
  const content = readFileSync(p.path, "utf-8")
  if (!content.includes(p.oldString)) return { id: req.id, status: "error", envelope: env, error: { code: "STRING_NOT_FOUND", message: `oldString not found in ${p.path}` } }
  const updated = content.replace(p.oldString, p.newString)
  writeFileSync(p.path, updated, "utf-8")
  return { id: req.id, status: "success", envelope: env, result: { path: p.path, replaced: true } }
}

// ── Git ────────────────────────────────────────────────────

interface GitPayload { action: string; args?: Record<string, string> }
function handleGit(req: WorkerRequest, env: Env): WorkerResponse {
  const p = req.payload as GitPayload
  const start = Date.now()
  const cmd = `git ${p.action} ${p.args ? Object.entries(p.args).map(([k, v]) => `${k} ${v}`).join(" ") : ""}`
  const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 })
  return { id: req.id, status: "success", envelope: env, result: { output: output.trim(), duration: Date.now() - start } }
}
