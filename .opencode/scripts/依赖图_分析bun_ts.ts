import path from "path"; import fs from "fs"
const TARGET = process.env.O_DIRECTORY + "/src/tool/bun.ts"
const MAX_DEPTH = 5
const visited = new Set(); const edges = new Map()
function resolve(f, s) {
  if (!s.startsWith(".")) return null
  const b = path.dirname(f); const c = path.resolve(b, s)
  for (const e of [".ts",".tsx",".js",".jsx",".mjs"]) { const p = c+e; if (fs.existsSync(p)) return path.normalize(p) }
  for (const i of ["index.ts","index.js"]) { const p = path.join(c,i); if (fs.existsSync(p)) return path.normalize(p) }
  return null
}
function parse(f) {
  try {
    const c = fs.readFileSync(f,"utf-8")
    return [...c.matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1]).concat([...c.matchAll(/(?:import|export)\s+["']([^"']+)["']/g)].map(m=>m[1]))
  } catch { return [] }
}
function walk(f, d=0) {
  if (d>MAX_DEPTH||visited.has(f)) return; visited.add(f)
  for (const r of parse(f).map(s=>resolve(f,s)).filter(Boolean)) { edges.set(f,[...(edges.get(f)||[]),r]); walk(r,d+1) }
}
walk(TARGET)
function print(f,i="",l=true,s=new Set()) {
  if (s.has(f)) { console.log(i+(l?"└── ":"├── ")+path.relative(process.env.O_WORKTREE||"",f)+" 🔄"); return }
  s.add(f); const c=edges.get(f)||[]; console.log(i+(l?"└── ":"├── ")+(f===TARGET?path.relative(process.env.O_WORKTREE||"",f)+" 🎯":path.relative(process.env.O_WORKTREE||"",f)))
  for (let i=0;i<c.length;i++) print(c[i],i+(l?"    ":"│   "),i===c.length-1,new Set(s))
}
console.log(`\n📦 ${TARGET}\n`); print(TARGET); console.log(`\n总计 ${visited.size} 个文件`)
