# bun 工具：脚本命名混淆修复 + 启动期可复用脚本提示 — 详细修复计划

> 本文档仅描述修复方案，不含任何代码改动。
> 关联问题：① `description` 字段同时承担"审核上下文"和"文件名生成"两个相互冲突的职责；
> ② `scriptIndexList()` 只写不读，启动期系统提示不告知已存在的可复用脚本。

---

## 目录

1. [问题回顾](#1-问题回顾)
2. [设计目标与约束](#2-设计目标与约束)
3. [修复一：拆分 description / name 双字段](#3-修复一拆分-description--name-双字段)
4. [修复二：启动期注入可复用脚本清单](#4-修复二启动期注入可复用脚本清单)
5. [受影响代码位点总表](#5-受影响代码位点总表)
6. [边界情况与错误处理](#6-边界情况与错误处理)
7. [逐步骤实施计划](#7-逐步骤实施计划)
8. [验收清单](#8-验收清单)

---

## 1. 问题回顾

### 问题一：description 与脚本文件名混淆

[`src/tool/bun.ts:15-17`](../packages/opencode/src/tool/bun.ts) 中 `description` 参数的注解：

```typescript
description: Schema.String.annotate({
  description: "脚本功能描述（5-10 个字），用于审核上下文和生成可复用的脚本文件名",
})
```

**单个字段承担两个对文本形态要求相反的职责**：

| 职责 | 消费方 | 期望文本形态 | 代码位点 |
|------|--------|-------------|---------|
| ① 审核上下文 | `bun-review.txt` 中 `${description}`、`bun-review.ts` 渲染 | 自然语言句子，语义清晰 | `bun-review.ts:20`、`bun-review.ts:85`、`bun-review.ts:99` |
| ② 文件名生成 | `toFilename()` + `bun#${filename}` 标题 + `scriptIndexSave(id)` | snake_case 标识符，无空格/标点 | `bun.ts:29-36`、`bun.ts:115`、`bun.ts:126`、`bun.ts:183` |

`toFilename()` 的转换逻辑（`bun.ts:29-36`）：

```typescript
function toFilename(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_")  // 空格/标点 → _
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 60) || "script"
}
```

**实际后果**：

- 模型为审核清晰传 `"读取并解析用户的 CSV 配置文件"` → 文件名 `读取并解析用户的_csv_配置文件.ts`（中英混排、语义被截断、`bun#` 标题不可读）
- 模型为文件名清晰传 `parse_csv_config` → `bun-review.txt` 中 `${description}` 是无语义 snake_case，审核员失去自然语言上下文
- `.slice(0, 60)` 截断可能让两个不同描述产生相同文件名，叠加 `bun.ts:113` 注释"同名脚本自动覆盖"，会**静默覆盖既有脚本**

### 问题二：启动期不提示可用脚本

**索引基础设施齐全，但读取端从未接线**：

- 写入端存在且被调用：`scriptIndexSave()`（`bun.ts:232-248`），落盘到 `Global.Path.data/script-index.json`
- 读取函数存在但**零调用方**：

```typescript
// bun.ts:250
export async function scriptIndexList(): Promise<...> { ... }
```

全仓库 `findstr` 确认：唯一匹配是它自身的定义，没有任何文件 import 或调用它。

- 系统提示无任何脚本提示：检查 `src/session/prompt/*.txt` 全部 14 个文件（default/anthropic/gpt/gemini/kimi/codex/trinity/beast/…），搜索 `script`/`bun`/`可用`/`复用` **零命中**
- 系统提示组装点 `prompt.ts:1628-1634` 只拼接 `env / instructions / skills`，无脚本清单分支
- 没有兜底的 `.opencode/scripts/` 目录扫描

**结论**：索引只写不读，启动期模型完全不知道已存在哪些可复用脚本，复用机制实际"能存不能用"。

---

## 2. 设计目标与约束

### 目标

1. **职责分离**：审核上下文与文件名生成使用各自独立的字段，互不干扰
2. **向后兼容**：不破坏既有 `script-index.json` 数据结构（仅在缺失字段时降级处理）
3. **启动期可见性**：模型在每轮系统提示中看到当前 worktree 下已存在的可复用脚本清单
4. **零静默覆盖**：消除描述截断导致同名覆盖的风险

### 约束

- 不引入新的 npm 依赖
- 系统提示注入必须可失败降级（脚本目录读取失败不应阻塞会话）
- 注入内容必须可截断（脚本数量过多时不撑爆上下文）
- 遵循现有 `SystemPrompt` 服务的 `Effect.fn` + `Effect<string | undefined>` 返回模式（参照 `skills` 函数 `system.ts:256-268`）

---

## 3. 修复一：拆分 description / name 双字段

### 3.1 方案选择

采用**新增独立 `name` 字段**方案，保留 `description` 专职审核上下文：

| 字段 | 职责 | 类型要求 | 生成规则 |
|------|------|---------|---------|
| `description` | 仅审核上下文（自然语言） | 自然语言句子 | 原样透传给 `bun-review.txt` 的 `${description}` |
| `name`（新增） | 仅脚本文件名/标题/索引 id | snake_case 标识符 | 经 `toFilename()` 规范化 |

**为何不反向（保留 name 删除 description）**：`bun-review.txt` 已被大量优化，`${description}` 占位符是审核质量的关键信号；保留它降低改动面。

**为何不合并（让 LLM 自己权衡）**：职责冲突的本质就是单字段无法同时满足两种形态，合并无法解决。

### 3.2 Parameters Schema 改动

**位点**：`bun.ts:13-24`

将 `description` 的注解改为专职审核上下文，并新增 `name` 参数：

```typescript
const Parameters = Schema.Struct({
  code: Schema.String.annotate({ description: "要执行的 TypeScript/JavaScript 代码" }),
  description: Schema.String.annotate({
    description: "脚本功能的自然语言描述（一句话），仅用于安全审核上下文，不影响文件名",
  }),
  name: Schema.String.annotate({
    description:
      "脚本的 snake_case 标识符（仅小写字母、数字、下划线，如 parse_csv_config），" +
      "用作保存的文件名和索引键。必须语义化且稳定，便于后续复用与覆盖更新。",
  }),
  packages: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "需要安装的 npm 包，自动解析传递依赖并进行安全检查",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "工作目录（必须传入绝对路径，不传则使用当前会话目录）",
  }),
})
```

### 3.3 toFilename() 收紧校验

**位点**：`bun.ts:29-36`

现状 `toFilename` 接受任意自然语言（含中文 `\u4e00-\u9fff`），这正是命名混乱的根源。修复后它只应作为**防御性归一化**，而非主转换器：

```typescript
/**
 * 防御性归一化 name → 文件名片段。
 * name 应已是 snake_case；此函数只做兜底清洗，不做语义翻译。
 */
function toFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")   // 非 [a-z0-9_] 统一变 _（移除中文保留区间）
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 60) || "script"
}
```

**关键变更**：移除 `\u4e00-\u9fff` 保留区间——文件名必须 ASCII snake_case，中文描述若误传入会被转成 `_`，而非保留为乱码文件名。

### 3.4 调用点改动

| 位点 | 现状 | 修复后 |
|------|------|--------|
| `bun.ts:115`（文件名） | `toFilename(params.description \|\| "script")` | `toFilename(params.name \|\| "script")` |
| `bun.ts:126`（索引 id） | `script_${filename...}` | 不变（filename 已由 name 派生） |
| `bun.ts:129`（索引 description） | `params.description` | 不变（索引中记录自然语言描述，便于检索） |
| `bun.ts:183`（标题） | `bun#${filename}` | 不变（filename 已可读） |
| `bun.ts:184`（metadata.scriptId） | 不变 | 不变 |
| `bun-review.ts:20` | `description` 填 `${description}` | 不变（继续用 description） |
| `bun-review.ts:85`（review session title） | `(description \|\| code).slice(0,60)` | 不变 |
| `bun-review.ts:114/122`（拦截标题） | `description \|\| "bun"` | 不变 |

**净效果**：审核链路全用 `description`（自然语言），落盘/索引/标题全用 `name`（snake_case），二者彻底解耦。

### 3.5 工具 description 文案同步

**位点**：`bun.ts:213`

```
"- 脚本自动保存到 .opencode/scripts/ 目录，以 description 命名",
```

改为：

```
"- 脚本自动保存到 .opencode/scripts/ 目录，以 name（snake_case）命名；description 仅用于审核",
```

---

## 4. 修复二：启动期注入可复用脚本清单

### 4.1 注入位置选择

三个候选位置，对比：

| 候选 | 位点 | 优点 | 缺点 | 选择 |
|------|------|------|------|------|
| A. `SystemPrompt.environment()` | `system.ts:60-254` | 每轮自动注入，与 env 同生命周期 | env 是静态环境信息，混入动态脚本清单语义不符 | ❌ |
| B. 新增 `SystemPrompt.scripts()` 函数 | `system.ts` Interface + layer | 语义清晰，与 `skills()` 完全对称 | 需扩展 Interface | ✅ |
| C. 单独系统提示 .txt 文件 | `session/prompt/*.txt` | 无需改 TS | .txt 是静态模板，无法承载动态脚本列表 | ❌ |

**采用方案 B**：在 `SystemPrompt` 服务中新增 `scripts()` 函数，与 `skills()`（`system.ts:256-268`）结构对称。

### 4.2 SystemPrompt 服务 Interface 扩展

**位点**：`system.ts:47-50`

```typescript
export interface Interface {
  readonly environment: (model: Provider.Model, sessionID?: SessionID) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly scripts: () => Effect.Effect<string | undefined>   // 新增
}
```

返回 `string | undefined`：无脚本或读取失败时返回 `undefined`，组装端按 `skills` 同样方式条件展开（`prompt.ts:1634` 的 `...(skills ? [skills] : [])` 模式）。

### 4.3 scripts() 函数实现

**位点**：`system.ts` layer 内，紧跟 `skills` 函数之后（`system.ts:268` 之后）

**职责**：
1. 读取当前 worktree 下 `.opencode/scripts/` 目录
2. 过滤出 `.ts` 文件
3. 按 mtime 倒序取最近 N 条（N 默认 20，避免上下文爆炸）
4. 渲染为系统提示片段

**实现要点（伪代码，描述逻辑而非最终代码）**：

```
scripts: Effect.fn("SystemPrompt.scripts")(function* () {
  const ctx = yield* InstanceState.context          // 取 worktree
  const scriptsDir = path.join(ctx.worktree, ".opencode", "scripts")

  // 1. 读目录（允许失败 → 返回 undefined，不阻塞会话）
  let entries: Dirent[]
  try {
    entries = await fs.readdir(scriptsDir, { withFileTypes: true })
  } catch {
    return undefined                                 // 目录不存在 = 无脚本
  }

  // 2. 过滤 .ts 文件，收集 { name, mtime }
  const files = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".ts")) continue
    const stat = await fs.stat(path.join(scriptsDir, e.name)).catch(() => null)
    if (stat) files.push({ name: e.name.replace(/\.ts$/, ""), mtime: stat.mtimeMs })
  }
  if (files.length === 0) return undefined

  // 3. mtime 倒序，截断到 MAX（默认 20）
  files.sort((a, b) => b.mtime - a.mtime)
  const top = files.slice(0, 20)

  // 4. 渲染
  return [
    "以下是当前工作区已保存的可复用 bun 脚本（位于 .opencode/scripts/）：",
    ...top.map(f => `  - ${f.name}`),
    "",
    "优先复用已有脚本：若任务与上述脚本功能匹配，先用 Read 工具查看其内容，",
    "确认可用后通过 bun 工具用相同 name 调用（同名会覆盖更新），避免重复造轮子。",
  ].join("\n")
}),
```

**设计决策**：

- **为何扫目录而非读 `script-index.json`**：索引只写不读已是缺陷，且索引是全局的（`Global.Path.data`，跨 worktree），而脚本文件本身就在 worktree 内。直接扫目录确保清单与实际文件一致，避免索引漂移（已删除文件仍出现在索引中）。
- **为何不用 `scriptIndexList()`**：它读全局索引，会混入其他 worktree 的脚本；且它是死代码，依赖它会强化"只写不读"的反模式。**本计划建议保留 `scriptIndexList` 但标注其用途变更**（见 4.5）。
- **为何用 `fs.readdir` 而非项目已有的 `FSUtil`**：`scripts()` 在 `SystemPrompt` 层，与 `prompt.ts` 同级；`system.ts` 已直接 import `fs`（`system.ts:2`），保持一致。若团队偏好 FSUtil，可替换为 `fsys.readdir`，需在 layer 中注入 `FSUtil.Service`。

### 4.4 组装端接线

**位点**：`prompt.ts:1628-1634`

现状：

```typescript
const [skills, env, instructions, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  sys.environment(model, sessionID),
  instruction.system().pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
const system = [...env, ...instructions, ...(skills ? [skills] : [])]
```

修复后：

```typescript
const [skills, scriptsList, env, instructions, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  sys.scripts(),                                          // 新增，与 skills 并列
  sys.environment(model, sessionID),
  instruction.system().pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
const system = [
  ...env,
  ...instructions,
  ...(skills ? [skills] : []),
  ...(scriptsList ? [scriptsList] : []),                  // 新增
]
```

**为什么放在 skills 之后**：脚本清单是项目级动态信息，语义权重低于 env/instructions/skills，放在末尾便于在上下文紧张时优先截断。

### 4.5 scriptIndexList 的处置

`scriptIndexList()`（`bun.ts:250`）当前是死代码。修复二选择**扫目录而非读索引**，因此它仍不会被 `scripts()` 调用。

**建议**：
- **不删除**：它作为公开 API 可能被插件或未来功能使用（如跨 worktree 脚本检索）
- **补充 doc 注释**：明确其读全局索引、可能含其他 worktree 脚本的特性，避免误用
- **可选增强**（不在本计划范围）：在 `scriptIndexSave` 中写入 `worktree` 字段，`scriptIndexList` 增加 worktree 过滤参数

---

## 5. 受影响代码位点总表

| 文件 | 位点 | 改动类型 | 说明 |
|------|------|---------|------|
| `src/tool/bun.ts` | `13-24` | 修改 | Parameters：description 注解改专职审核；新增 `name` 字段 |
| `src/tool/bun.ts` | `29-36` | 修改 | `toFilename`：移除中文保留区间，改 ASCII-only 归一化 |
| `src/tool/bun.ts` | `115` | 修改 | `toFilename(params.description)` → `toFilename(params.name)` |
| `src/tool/bun.ts` | `126` | 不变 | 索引 id 由 filename 派生（已间接用 name） |
| `src/tool/bun.ts` | `129` | 不变 | 索引中记录 description（自然语言，便于检索） |
| `src/tool/bun.ts` | `183` | 不变 | 标题 `bun#${filename}`（已可读） |
| `src/tool/bun.ts` | `213` | 修改 | 工具 description 文案：说明以 name 命名 |
| `src/tool/bun.ts` | `250` | 补注释 | `scriptIndexList` 标注用途（读全局索引，不用于启动注入） |
| `src/session/bun-review.ts` | 全文 | 不变 | 继续用 description 作审核上下文 |
| `src/session/system.ts` | `47-50` | 修改 | Interface 新增 `scripts(): Effect<string \| undefined>` |
| `src/session/system.ts` | `268` 之后 | 新增 | `scripts()` 函数实现（扫目录 + 渲染） |
| `src/session/prompt.ts` | `1628-1634` | 修改 | `Effect.all` 增加 `sys.scripts()`；system 数组条件展开 |

**不动的地方**：
- `bun-review.txt`：`${description}` 占位符语义不变
- `script-index.json` 数据结构：不变（id/description/path/sessionID/createdAt），无需迁移
- `.opencode/scripts/` 目录布局：不变
- 现有脚本文件：不受影响（`name` 缺失时降级为 `"script"`）

---

## 6. 边界情况与错误处理

### 6.1 命名相关

| 场景 | 处理 | 理由 |
|------|------|------|
| 模型未传 `name` | `params.name` 为空字符串 → `toFilename("")` → `"script"` | 降级，不阻塞执行 |
| 模型传了带中文的 `name` | `toFilename` 移除中文保留区间 → 中文转 `_` | 强制 ASCII；配合工具 description 引导模型传 snake_case |
| 两个不同任务传相同 `name` | 同名文件覆盖（`bun.ts:113` 注释已有此行为） | 这是"覆盖更新"特性，符合复用预期；不再是描述截断导致的意外覆盖 |
| `.ts` 后缀被误包含在 `name` 中 | `toFilename` 不处理 `.`（`[^a-z0-9_]` 会把 `.` 转 `_`）→ `parse_csv.ts` → `parse_csv_ts` | 可接受；工具 description 应说明不带后缀 |

### 6.2 启动注入相关

| 场景 | 处理 | 理由 |
|------|------|------|
| `.opencode/scripts/` 不存在 | `readdir` 抛 ENOENT → catch → 返回 `undefined` | 新项目无脚本，不注入 |
| 目录存在但为空 | `files.length === 0` → 返回 `undefined` | 同上 |
| 目录有 100 个脚本 | mtime 排序后 `slice(0, 20)` | 防上下文爆炸；MAX 可配置化（见 6.3） |
| `readdir` 因权限失败 | catch → 返回 `undefined` | 不阻塞会话启动 |
| 单个文件 `stat` 失败 | `catch(() => null)` 跳过该文件 | 部分损坏不影响整体 |
| 子 session（task/审核）调用 | `scripts()` 仍读当前 worktree | 脚本是 worktree 级资源，子 session 应可见 |
| worktree 切换 | `ctx.worktree` 每轮重新求值（`scripts()` 在 loop 内每轮调用） | 自动反映新 worktree 的脚本 |

### 6.3 可配置化（可选增强，非必须）

`MAX = 20` 可提升为 config 项。但本计划默认硬编码，理由：
- `skills()`（`system.ts:256-268`）也未做数量配置，保持对称
- 避免过度设计；若需配置可后续追加 `Config` schema

### 6.4 性能考量

- `scripts()` 每轮 LLM 调用都执行一次（与 `skills`/`environment` 同频）
- 单次成本：1 次 `readdir` + 至多 20 次 `stat`，典型 < 5ms
- 若未来脚本数极多（>1000），可考虑缓存 + mtime 失效；当前规模无需

---

## 7. 逐步骤实施计划

按依赖顺序排列，每步可独立验证。

| 步骤 | 文件 | 改动 | 验证方法 |
|------|------|------|---------|
| 1 | `src/tool/bun.ts` | Parameters 新增 `name` 字段；`description` 注解改专职审核 | `bun typecheck` 通过 |
| 2 | `src/tool/bun.ts` | `toFilename` 移除中文保留区间，改 ASCII-only | 单测：`toFilename("parse_csv")` → `"parse_csv"`；`toFilename("解析CSV")` → `"csv"`（中文转 `_` 后清理） |
| 3 | `src/tool/bun.ts` | `bun.ts:115` 改 `toFilename(params.name \|\| "script")` | 调用 bun 工具传 `name: "parse_csv"`，确认文件名为 `parse_csv.ts` |
| 4 | `src/tool/bun.ts` | 工具 description 文案（`bun.ts:213`）说明 name 命名 | 检查工具描述渲染 |
| 5 | `src/tool/bun.ts` | `scriptIndexList` 补 doc 注释 | 代码审查 |
| 6 | `src/session/system.ts` | Interface 新增 `scripts()` 签名 | `bun typecheck` 通过 |
| 7 | `src/session/system.ts` | 实现 `scripts()` 函数（扫目录 + 渲染） | 单测：空目录返回 undefined；有文件返回含文件名的字符串 |
| 8 | `src/session/prompt.ts` | `Effect.all` 增加 `sys.scripts()`；system 数组展开 | 启动会话，确认系统提示含脚本清单 |
| 9 | 全局 | 端到端验证 | 见验收清单 |

**步骤 1-5（修复一）与步骤 6-8（修复二）相互独立**，可并行开发或分两个 PR。

---

## 8. 验收清单

### 修复一（命名分离）

- [ ] 调用 bun 工具时 `description` 为自然语言句子（如 "读取并解析用户的 CSV 配置文件"），`name` 为 snake_case（如 `parse_csv_config`）
- [ ] 落盘文件名为 `parse_csv_config.ts`（由 name 派生），不含中文
- [ ] 工具返回标题为 `bun#parse_csv_config.ts`（可读）
- [ ] `script-index.json` 中该条目 `description` 字段为自然语言，`id` 含 snake_case 文件名
- [ ] `bun-review.txt` 渲染时 `${description}` 为自然语言句子（审核上下文清晰）
- [ ] `name` 缺失时降级为 `script.ts`，不报错
- [ ] 两个任务传相同 `name` 时为预期覆盖，而非描述截断导致的意外覆盖

### 修复二（启动注入）

- [ ] 在含 `.opencode/scripts/*.ts` 的 worktree 启动会话，系统提示中出现"已保存的可复用 bun 脚本"清单
- [ ] 清单按 mtime 倒序，最多 20 条
- [ ] `.opencode/scripts/` 不存在或为空时，系统提示中无该片段（无报错）
- [ ] 脚本数 > 20 时只显示最近 20 条
- [ ] `readdir` 失败（如权限）时会话仍能正常启动
- [ ] worktree 切换后，下一轮系统提示反映新 worktree 的脚本

### 回归

- [ ] 既有 `script-index.json` 数据无需迁移即可继续工作
- [ ] `bun-review.ts` 审核链路行为不变（仍用 description）
- [ ] `bun-security.ts` 依赖检查不受影响
- [ ] `registry.ts` 中 BunTool 注册不受影响
- [ ] auto-plan 的 `blocked_tools`（`prompt.ts:1649` 含 `"bun"`）不受影响
