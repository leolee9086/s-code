import path from "path"
import fs from "fs"
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || "5", 10)
const EXTENSIONS = (process.env.EXTENSIONS || ".ts,.tsx,.js,.jsx,.mjs,.cjs").split(",")
const INDEX_FILES = ["index.ts", "index.js"]
const TARGET = process.argv[2]
if (!TARGET) { console.error("用法: bun run <script> <filepath>\n环境变量: MAX_DEPTH=5, EXTENSIONS=..."); process.exit(1) }
const root = process.env.O_WORKTREE || process.cwd()
const visited = new Set<string>()
const edges = new Map<string, string[]>()
function resolveImport(fromFile, specifier) {
  if (specifier.startsWith("/")) return null
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || !specifier.startsWith(".")) return null
  const base = path.dirname(fromFile); const candidate = path.resolve(base, specifier)
  for (const ext of EXTENSIONS) { const p = candidate + ext; if (fs.existsSync(p)) return path.normalize(p) }
  for (const idx of INDEX_FILES) { const p = path.join(candidate, idx); if (fs.existsSync(p)) return path.normalize(p) }
  return null
}
function parseImports(filepath) {
  let content
  try { content = fs.readFileSync(filepath, "utf-8") } catch (e) { console.warn(`[warn] 无法读取: ${filepath}`); return [] }
  const imports = []
  for (const m of content.matchAll(/from\s+["']([^"']+)["']/g)) imports.push(m[1])
  for (const m of content.matchAll(/(?:import|export)\s+["']([^"']+)["']/g)) imports.push(m[1])
  return imports
}
function walk(filepath, depth = 0) {
  if (depth > MAX_DEPTH) { console.warn(`[warn] 深度 ${MAX_DEPTH} 截断: ${path.basename(filepath)}`); return }
  if (visited.has(filepath)) return; visited.add(filepath)
  for (const r of parseImports(filepath).map(i => resolveImport(filepath, i)).filter(Boolean)) {
    edges.set(filepath, [...(edges.get(filepath) || []), r]); walk(r, depth + 1)
  }
}
const absTarget = path.resolve(root, TARGET)
if (!fs.existsSync(absTarget)) { console.error(`错误: ${absTarget} 不存在`); process.exit(1) }
console.log(`\n📦 ${absTarget}\n`); walk(absTarget)
function printGraph(file, indent = "", isLast = true, seen = new Set()) {
  if (seen.has(file)) { console.log(indent + (isLast ? "└── " : "├── ") + path.relative(root, file) + " 🔄"); return }
  seen.add(file); const children = edges.get(file) || []
  console.log(indent + (isLast ? "└── " : "├── ") + (file === absTarget ? path.relative(root, file) + " 🎯" : path.relative(root, file)))
  for (let i = 0; i < children.length; i++) printGraph(children[i], indent + (isLast ? "    " : "│   "), i === children.length - 1, new Set(seen))
}
printGraph(absTarget)
console.log(`\n总计 ${visited.size} 个文件`)