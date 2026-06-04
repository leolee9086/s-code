# 工具系统

## 架构

```
Tool.define(id, init Effect)
  → Info { id, init: () => Def { description, parameters, execute } }
  → registry.ts: Tool.init(info) → Def { id, execute(parsed), ... }
  → 注册到 builtin 列表
  → SessionTools.resolve() → AI SDK tool() 格式
  → LLM 调用时提供给 Model
```

## 工具定义模式

```ts
export const MyTool = Tool.define(
  "tool-id",
  Effect.gen(function* () {
    const depA = yield* DepA.Service   // 工具依赖在此 yield（在 init 阶段）
    return {
      description: DESCRIPTION,          // 文本文件导入
      parameters: Parameters,            // Effect Schema
      execute: (args, ctx) => Effect.gen(function* () {
        // args: Schema.Type<typeof Parameters>
        // ctx: Tool.Context { sessionID, agent, abort, messages, metadata, ask }
        return { title, metadata, output }
      }).pipe(Effect.orDie),
    }
  }),
)
```

## 完整工具列表

### 读工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `read` | filePath, offset?, limit?, includeMeta? | AppFileSystem, LSP, Reference, Instruction | 读文件/目录，支持图片 (jpeg/png/gif/webp)，max 50KB，超长行截断 |
| `grep` | pattern, path?, include? | Ripgrep, Reference | 正则搜索，2000 字符行限制 |
| `glob` | pattern, path? | Ripgrep, Reference | 通配符文件匹配 |

### 写工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `edit` | filePath, oldString, newString, replaceAll?, mtime, proof | LSP, Format, FileWatcher, Snapshot | 替换编辑 + LSP 格式化 + proof 验证，文件级锁避免并发冲突 |
| `write` | filePath, content | LSP, Format, File, FileWatcher | 写入新文件，空文件可覆盖，非空文件拒绝覆盖 |
| `apply_patch` | patchText | git | git apply 打补丁 |

### 执行工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `shell` | command, description, timeout?, workdir? | ChildProcessSpawner, Config | shell 执行，超时控制，git guard 保护已暂存变更 |
| `bash` (同 shell) | 同上 | 同上 | shell 子工具，额外解析命令并匹配权限规则 |

### 查询工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `webfetch` | url, format?, timeout? | HttpClient | HTTP 内容获取，HTML→Markdown 转换，5MB 上限 |
| `websearch` | query, numResults?, livecrawl?, type?, contextMaxCharacters? | Provider | 网络搜索（通过 provider 的 websearch API）|
| `lsp` | filePath, query? | LSP | LSP 诊断/补全查询 |
| `session_query` | query, channel? | Database | 只读 SQL 查询 session 数据库 |
| `session_message_read` | id, channel? | Database | 读取 session 消息完整内容 |

### 交互工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `question` | questions[] | Question | 向用户提问并等待回答 |
| `todo` | todos[] | Todo | 创建/更新任务列表 |

### 任务工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `task` | description, prompt, background? | Scope | 平行执行多个 prompt（Effect.forkIn + Fiber.join），每个 prompt 在独立子 session 中运行 |
| `skill` | name | Skill, Ripgrep | 加载 skill 系统提示 |

### 辅助工具

| 工具 | 参数 | 依赖 | 行为 |
|------|------|------|------|
| `plan` | (无) | 无 | Plan 模式入口/出口 |
| `invalid` | (schema: Unknown) | 无 | 捕获无效 tool call，报友好错误 |

### 注册条件

```ts
// 条件性注册：
question: questionEnabled ? [tool.question] : []
search: always (但 tools() 中按 provider 过滤)
lsp: flags.experimentalLspTool ? [tool.lsp] : []
patch: modelID 含 gpt- 且不是 oss/gpt-4 时启用（否则用 edit/write）
plan: flags.experimentalPlanMode && cli ? [tool.plan] : []
```

## 工具执行包装

`Tool.wrap()` 在每个工具外包裹一层：

```ts
wrap(id, init, truncate, agents):
  1. 编译 Schema.decodeUnknownEffect (参数解码)
  2. 替换 execute:
     → decode(args) → 执行原始 execute
     → 检查 intercepted → 替换输出
     → truncate.output() → 截断过长的输出
     → 返回 ExecuteResult { title, metadata, output, attachments }
```

## 工具过滤

`ToolRegistry.tools({ model, agent })`：
1. 按 modelID/providerID 过滤（如 websearch 只对 opencode provider 启用）
2. 按 model 能力过滤（如 gpt-4 以下用 edit/write，以上用 apply_patch）
3. 添加 plugin 的 `tool.definition` hook
4. 按 agent name 添加 task/skill 描述

## 执行权限

每个工具在其 `execute` 中调用 `ctx.ask({ permission, patterns, always, metadata })`：
- `permission` — 工具名（如 "read", "shell"）或分类（如 "edit" 覆盖 edit/write/apply_patch）
- `patterns` — 参数中的路径/模式（权限评估用）
- `always` — 用户选择"始终允许"时加入 pattern
