import path from "path"
import fs from "fs"

// ── 可配置参数（可通过环境变量覆盖）────────────────────────────
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || "5", 10)
const EXTENSIONS = (process.env.EXTENSIONS || ".ts,.tsx,.js,.jsx,.mjs,.cjs").split(",")
const INDEX_FILES = ["index.ts", "index.js"]

// ── 用法 ──────────────────────────────────────────────────────
const TARGET = process.argv[2]
if (!TARGET) {
  console.error("用法: bun run <script> <filepath>")
  console.error("环境变量:")
  console.error("  MAX_DEPTH=5      最大递归深度")
  console.error("  EXTENSIONS=...   文件扩展名列表（逗号分隔）")
  process.exit(1)
}

// ── 核心逻辑 ──────────────────────────────────────────────────
const root = process.env.O_WORKTREE || process.cwd()
const visited = new Set<string>()
const edges = new Map<string, string[]>()

/** 解析导入路径为绝对路径 */
function resolveImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("/")) return null
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || !specifier.startsWith(".")) return null
  const base = path.dirname(fromFile)
  const candidate = path.resolve(base, specifier)
  for (const ext of EXTENSIONS) {
    const p = candidate + ext
    if (fs.existsSync(p)) return path.normalize(p)
  }
  for (const idx of INDEX_FILES) {
    const p = path.join(candidate, idx)
    if (fs.existsSync(p)) return path.normalize(p)
  }
  return null
}

/** 解析文件中的 import/require 语句 */
function parseImports(filepath: string): string[] {
  let content: string
  try {
    content = fs.readFileSync(filepath, "utf-8")
  } catch (e) {
    console.warn(`[warn] 无法读取 ${filepath}: ${(e as Error).message}`)
    return []
  }
  const imports: string[] = []
  for (const m of content.matchAll(/from\s+["']([^"']+)["']/g)) imports.push(m[1])
  for (const m of content.matchAll(/(?:import|export)\s+["']([^"']+)["']/g)) imports.push(m[1])
  for (const m of content.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)) imports.push(m[1])
  return imports
}

/** 递归遍历依赖树 */
function walk(filepath: string, depth = 0) {
  if (depth > MAX_DEPTH) {
    console.warn(`[warn] 达到最大深度 ${MAX_DEPTH}，截断: ${path.basename(filepath)}`)
    return
  }
  if (visited.has(filepath)) return
  visited.add(filepath)
  const imports = parseImports(filepath)
  const resolved: string[] = []
  for (const imp of imports) {
    const r = resolveImport(filepath, imp)
    if (r) { resolved.push(r); edges.set(filepath, [...(edges.get(filepath) || []), r]) }
  }
  for (const r of resolved) walk(r, depth + 1)
}

// ── 主流程 ────────────────────────────────────────────────────
const absTarget = path.resolve(root, TARGET)
if (!fs.existsSync(absTarget)) {
  console.error(`错误: 文件不存在 - ${absTarget}`)
  process.exit(1)
}

console.log(`\n📦 依赖图: ${absTarget}\n`)
walk(absTarget)

function printGraph(file: string, indent = "", isLast = true, seen = new Set<string>()) {
  if (seen.has(file)) {
    console.log(indent + (isLast ? "└── " : "├── ") + path.relative(root, file) + " 🔄")
    return
  }
  seen.add(file)
  const children = edges.get(file) || []
  const label = file === absTarget ? path.relative(root, file) + " 🎯" : path.relative(root, file)
  console.log(indent + (isLast ? "└── " : "├── ") + label)
  for (let i = 0; i < children.length; i++) {
    printGraph(children[i], indent + (isLast ? "    " : "│   "), i === children.length - 1, new Set(seen))
  }
}

printGraph(absTarget)
console.log(`\n总计 ${visited.size} 个文件，最大深度 ${MAX_DEPTH}`)
