# opencode 项目架构

## 一、仓库结构

```
s-code/
├── packages/
│   ├── core/          # 核心抽象层：session 模型、数据库、event、provider 定义
│   ├── opencode/      # CLI + TUI + 业务逻辑：tool/agent/session/prompt/server
│   ├── sdk/           # TypeScript SDK，供外部集成调用
│   ├── app/           # 桌面应用
│   ├── web/           # Web UI
│   ├── plugin/        # 插件 SDK
│   ├── cli/           # 独立 CLI 包（包装 opencode）
│   ├── ui/            # UI 组件库
│   ├── llm/           # LLM 调用封装（AI SDK 包装）
│   ├── effect-drizzle-sqlite/ + effect-sqlite-node/  # Effect × Drizzle 适配层
│   └── ...
├── .opencode/         # opencode 自身配置 + 工具定义 (tool/*.ts)
├── specs/             # 内部规范文档（Effect 模式等）
└── s-temp/            # evolve 模式临时目录（.evolve-msg.txt 等）
```

## 二、包依赖关系

```
sdk (面向外部)
  └── core (session schema, event, provider, database)
        └── opencode (所有业务逻辑)
              ├── cli (命令行入口)
              ├── server (HTTP API + WebSocket)
              └── plugin (插件系统)
```

- **core** (`@opencode-ai/core`)：纯定义层，schema、interface、数据库 drizzle schema，无 TUI/CLI 依赖
- **opencode** (`@opencode-ai/opencode`)：所有业务实现，依赖于 core
- **sdk** (`@opencode-ai/sdk`)：外部调用 opencode 的 HTTP 客户端

## 三、服务注册模式（Effect 体系）

项目全面采用 **Effect v4** 的 `Context.Service` 模式。每个功能模块是一个 Effect Service：

```ts
export interface Interface { ... }              // 接口定义
export class Service extends Context.Service<Service, Interface>()("@opencode/XXX") {}  // 服务标识
export const layer = Layer.effect(Service, ...)  // 实现层
export const defaultLayer = ...                  // 默认层（提供依赖）
```

### 关键 Services

| Service | Tag | 功能 |
|---------|-----|------|
| `SessionPrompt.Service` | `@opencode/SessionPrompt` | 消息 prompt → agent loop |
| `SessionProcessor.Service` | `@opencode/SessionProcessor` | LLM 调用 + tool call 循环 |
| `SessionCompaction.Service` | `@opencode/SessionCompaction` | 上下文压缩 |
| `ToolRegistry.Service` | `@opencode/ToolRegistry` | 工具注册/按 agent 过滤 |
| `Session.Service` | `@opencode/Session` | Legacy session CRUD |
| `SessionV2.Service` | `@opencode/v2/Session` | V2 session CRUD |
| `Agent.Service` | `@opencode/Agent` | Agent 类型管理 |
| `LLM.Service` | `@opencode/LLM` | LLM 流式调用 |
| `Plugin.Service` | `@opencode/Plugin` | 插件 hooks |
| `Config.Service` | `@opencode/Config` | 配置加载 |
| `Command.Service` | `@opencode/Command` | 斜杠命令 |
| `Injection.Service` | `@opencode/Injection` | 消息前缀/后缀注入 |
| `Permission.Service` | `@opencode/Permission` | 权限评估 |

### 层的组合

每个服务的 `layer` 声明其依赖，`defaultLayer` 提供所有递归依赖：

```ts
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const depA = yield* DepA.Service  // 依赖在 layer type 参数中声明
  const depB = yield* DepB.Service
  return Service.of({ ... })
}))

export const defaultLayer = layer.pipe(
  Layer.provide(DepA.defaultLayer),
  Layer.provide(DepB.defaultLayer),
)
```

### InstanceState（实例级状态）

`InstanceState` 是 per-directory（每个项目目录）的懒初始化缓存：

```ts
const state = yield* InstanceState.make<State>((ctx) => init(ctx))
// ctx.directory 作为 cache key
// 同一个目录多次调用 init 只执行一次
// 目录被 dispose 时自动清理
```

用于：ToolRegistry、Agent、Command、Config、Session 等需要 per-project 状态的模块。

## 四、Session 生命周期

```
用户输入 → SessionPrompt.prompt() → createUserMessage() → loop()
                                                                  ↓
loop() → runLoop(sessionID)  ←────────────── 状态恢复/续接
              │
              ├─ tasks.pop() → "subtask" (已移除) | "compaction"
              │
              ├─ overflow? → compaction.create() + continue
              │
              ├─ SessionTools.resolve() → 获取 agent 可用 tools
              │
              ├─ SessionProcessor.process() → LLM 调用 + tool calls
              │        │
              │        ├─ LLM stream → tool calls → 执行 → 继续
              │        └─ finish: "stop" | "tool-calls" | "error"
              │
              ├─ result === "stop" → break
              ├─ result === "compact" → compaction.create()
              └─ result === "continue" → loop 继续
```

### 关键数据流

1. **User Input** → `SessionPrompt.prompt(input)`
   - 创建 user message + parts
   - 调用 `loop({ sessionID })`

2. **Loop** → `SessionPrompt.runLoop(sessionID)`
   - `while(true)`:
     - 获取 session messages (`filterCompacted`)
     - 检查 tasks（compaction）
     - 获取 agent
     - 通过 `SessionTools.resolve` 获取 tools（含 plugin 注入）
     - 创建 `SessionProcessor.handle`
     - 调用 `handle.process(streamInput)`
     - 根据 result 决定 break/continue

3. **Processor** → `process(streamInput)`
   - 调 `LLM.Service.stream()` → stream text + tool calls
   - tool call → `executeTool()` → 更新 part state
   - 所有 tool call 完成 → 再次调 LLM（循环直到 stop）
   - 返回 `"compact"` | `"stop"` | `"continue"`

## 五、Tool 系统

### 工具定义

```ts
// src/tool/tool.ts
export interface Def<P, M> {
  id: string
  description: string
  parameters: Schema                // Effect Schema
  execute(args, ctx): Effect<ExecuteResult<M>>
}
```

### 工具注册

```ts
// src/tool/registry.ts
// 所有工具在 ToolRegistry layer 中 yield（初始化）并缓存到 InstanceState
const task = yield* TaskTool          // Effect init
tool.task = Tool.init(task)           // 编译 schema + wrap execute
builtin: [ tool.read, tool.task, ...] // 注册到列表
```

### 工具执行链路

```
LLM 输出 tool calls
  → SessionProcessor 捕获
    → 更新 part state 为 "running"
      → 执行 tool.execute(args, ctx)
        → truncate output
          → 更新 part state 为 "completed"
```

### 内置工具列表

| ID | 文件 | 功能 |
|----|------|------|
| read | `read.ts` | 读文件 |
| glob | `glob.ts` | 文件匹配 |
| grep | `grep.ts` | 文本搜索 |
| edit | `edit.ts` | 替换编辑 |
| write | `write.ts` | 写入新文件 |
| shell | `shell.ts` | shell 命令 |
| task | `task.ts` | 新 session 平行任务 |
| question | `question.ts` | 向用户提问 |
| webfetch | `webfetch.ts` | HTTP 获取 |
| websearch | `websearch.ts` | 网络搜索 |
| skill | `skill.ts` | 加载技能 |
| bash | `shell/bash.ts` | bash 执行 |
| glob | `bun.ts` | TypeScript 代码执行 |
| ... | | |

## 六、Agent 系统

```ts
// src/agent/agent.ts
export const Info = Schema.Struct({
  name: Schema.String,
  mode: Schema.Literals(["subagent", "primary", "all"]),
  permission: PermissionLegacy.Ruleset,
  model: Schema.optional(...),
  prompt: Schema.optional(...),
  steps: Schema.optional(...),
})
```

内置 agents：`build`（默认）、`plan`（plan mode）、`compaction`（压缩专用、hidden）、`title`、`summary`

- `mode: "primary"` — 可做默认 agent (build, plan)
- `mode: "subagent"` — 只可被 Task 工具调用（explore、general，已移除）
- `mode: "all"` — 用户自定义 agent

## 七、Config 系统

配置加载流程：

```
opencode.json (项目)
  → opencode.jsonc (项目)
    → 环境变量覆盖
      → 远程 URL 配置
        → 合并到 Info
```

配置 schema 定义在 `packages/opencode/src/config/config.ts`，包含：
- `model`、`small_model`、`default_agent`
- `agent` — 自定义 agent
- `command` — 自定义斜杠命令
- `permission` — 权限规则
- `compaction` — 压缩配置（head_turns, tail_turns, preserve_recent_tokens）
- `experimental` — 实验特性

## 八、Evolve 循环

```
evolve 工具
  → typecheck (tsgo --noEmit)
  → build (bun run build)
  → write .evolve-msg.txt (续进消息)
  → spawn 新进程
  → 自杀

新进程启动
  → prompt.ts loop() 检测 isEvolveMode()
  → 读取 .evolve-msg.txt
  → 创建 synthetic user message
  → 正常 runLoop 处理
  → 进化模式强制规则：只能调用 evolve() 工具结束
```

文件协议在 `src/evolve/file-protocol.ts`：
- `writeEvolveMessage(msg)` → `.evolve-msg.txt`
- `readEvolveMessage()` → 读取并删除
- `isEvolveMode()` → 检查 `S_CODE_EVOLVE=1` 环境变量

## 九、数据存储

- **数据库**：SQLite（通过 drizzle-orm + bun:sqlite）
- **表结构**（定义在 `packages/core/src/session/sql.ts`）：
  - `session`：会话（id, project_id, directory, title, model, ...）
  - `message`：消息（id, session_id, role, type, data JSON）
  - `part`：消息部件（id, message_id, type, data JSON）
- **Migration**：`packages/core/src/data-migration.sql.ts`
- **JSON 迁移**：旧 JSON 存储 → SQLite 的迁移工具

## 十、V2 Session API

`packages/core/src/session.ts` 定义了 `SessionV2.Service`：
- `list/create/get/messages`
- `context` — 获取 compaction 后的上下文消息
- `prompt/shell/skill` — 入口（目前 compact 已实现，prompt 返回 `OperationUnavailableError`）
- `compact` — 触发压缩
- `wait` — 等待 session 空闲

## 十一、关键数据流总结

```
用户输入
  → CLI index.ts → yargs → RunCommand
    → runtime.ts → SDK client
      → server HTTP API / 进程内调用
        → SessionPrompt.prompt()
          → SessionPrompt.runLoop()
            → SessionTools.resolve() → 获取 tools
            → SessionProcessor.process()
              → LLM.stream() → text + tool calls
                → Tool.execute()
                → 继续 LLM stream
            → 结果写入 session messages
      → event stream → TUI 渲染
```

