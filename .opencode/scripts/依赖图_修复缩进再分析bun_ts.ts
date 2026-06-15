import path from "path"; import fs from "fs"
const TARGET = process.env.O_DIRECTORY + "/src/tool/bun.ts"
const MAX_DEPTH = 5
const visited = new Set(); const edges = new Map()
function resolve(f, s) {
  if (!s.startsWith(".")) return null
  const b = path.dirname(f); const c = path.resolve(b, s)
  for (const e of [".ts",".tsx",".js",".mjs",".cjs"]) { const p = c+e; if (fs.existsSync(p)) return path.normalize(p) }
  for (const i of ["index.ts","index.js"]) { const p = path.join(c,i); if (fs.existsSync(p)) return path.normalize(p) }
  return null
}
function parse(f) {
  try {
    const c = fs.readFileSync(f,"utf-8")
    return [...c.matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1]).concat(
           [...c.matchAll(/(?:import|export)\s+["']([^"']+)["']/g)].map(m=>m[1]))
  } catch { return [] }
}
function walk(f, d=0) {
  if (d>MAX_DEPTH||visited.has(f)) return; visited.add(f)
  for (const r of parse(f).map(s=>resolve(f,s)).filter(Boolean)) {
    edges.set(f,[...(edges.get(f)||[]),r]); walk(r,d+1) }
}
walk(TARGET)
const root = process.env.O_WORKTREE || ""
console.log(`\n📦 ${path.relative(root, TARGET)}\n`)
function print(f, indent="", last=true, seen=new Set()) {
  if (seen.has(f)) { console.log(indent+(last?"└── ":"├── ")+path.relative(root, f)+" 🔄"); return }
  seen.add(f); const c=edges.get(f)||[]
  const isRoot = f===TARGET
  console.log(indent+(isRoot?"":last?"└── ":"├── ")+path.relative(root, f)+(isRoot?" 🎯":""))
  for (let i=0;i<c.length;i++) print(c[i], indent+(isRoot?"":last?"    ":"│   "), i===c.length-1, new Set(seen))
}
for (const child of edges.get(TARGET)||[]) {
  print(child, "", child===(edges.get(TARGET)||[]).at(-1), new Set())
}
console.log(`\n总计: ${visited.size} 个文件，深度: ${MAX_DEPTH}`)
