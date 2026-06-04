# CLI / TUI 层

## CLI 入口

`src/index.ts` → yargs 解析命令 → 分发到各 `cmd/` 模块

### 主要命令

| 命令 | 文件 | 功能 |
|------|------|------|
| `run` | `cmd/run.ts` | 交互/非交互模式运行 |
| `serve` | `cmd/serve.ts` | 启动 headless HTTP server |
| `tui` | `cmd/tui/` | TUI 子命令 |
| `attach` | `cmd/tui/attach.ts` | 附加到运行中的 server |
| `acp` | `cmd/acp.ts` | Agent Client Protocol 模式 |
| `mcp` | `cmd/mcp.ts` | MCP 模式 |
| `generate` | `cmd/generate.ts` | 生成 agent 配置 |
| `session` | `cmd/session.ts` | session 管理 |
| `export/import` | `cmd/export.ts` | 导入导出 |

## Run 模式

`cmd/run.ts` 有三种模式：

### 1. 非交互模式（默认）
```
opencode run "prompt"
→ 发送单个 prompt
→ 流式 event 到 stdout
→ session 空闲时退出
```

### 2. 交互模式（`--interactive`）
```
opencode run --interactive
→ 启动 split-footer 直接模式
→ 进程内 server（无外部 HTTP）
```

### 3. Attach 交互模式（`--interactive --attach`）
```
opencode run --interactive --attach
→ 连接到运行中的 opencode server
→ 通过远程 HTTP API 交互
```

### 其他选项
- `--command` — 执行斜杠命令
- `--format json` — raw event streaming
- `--continue / --session` — 恢复 session
- `--fork` — fork 后继续

## TUI 路由

`src/cli/cmd/tui/routes/` 包含 TUI 页面：
- `session/index.tsx` — 主 session 视图（消息列表、工具渲染、输入框）

## Runtime 层

`src/cli/cmd/run/runtime.ts` 管理 run 模式的完整生命周期：
- SDK client 创建
- session 管理
- prompt 队列（`runtime.queue.ts`）
- Event 流处理
- Footer 状态管理

### Stream Transport

`src/cli/cmd/run/stream.transport.ts`：
- 管理 event stream → session data 映射
- tool 渲染（`src/cli/cmd/run/tool.ts`）
- 权限 UI
- Footer 状态

### SDK Event → TUI 渲染

`stream.transport.ts` 监听 SDK event stream，通过 `reduceSessionData()` 将事件转换为 UI commits：

```
sdk.event.subscribe() → Global Event Stream
  → watch() → Stream.runForEach(applyEvent)
    → reduceSessionData(data, event)
      → commits: SessionCommit[]
    → footer.append(commit)
    → Inkrement 重新渲染
```

`session-data.ts` 的 `reduceSessionData` 处理的事件类型：

| SDK Event | 触发条件 | UI 输出 |
|-----------|---------|---------|
| `session.next.shell.started` | shell 工具开始 | startShell commit |
| `session.next.shell.ended` | shell 工具完成 | doneShell commit + 输出 |
| `message.updated` | 消息更新 | 角色记录、token 用量、错误信息 |
| `message.part.delta` | 流式文本 | text.commit (assistant/reasoning) |
| `message.part.updated` (tool/running) | 工具开始执行 | startTool commit (卡片) |
| `message.part.updated` (tool/completed) | 工具执行结束 | output commit + doneTool |
| `message.part.updated` (tool/error) | 工具执行失败 | failTool commit |
| `message.part.updated` (text/reasoning) | 文本/推理更新 | text commit |

每个 commit 通过 `footer.append()` 推送到 Inkrement 渲染器，触发 UI 更新。

## Tool 渲染规则

`src/cli/cmd/run/tool.ts` 定义了每个工具的显示规则：
- `view` — 可见性策略（output/final 是否展示）
- `run` — 非交互模式下的摘要格式
- `scroll` — 滚动条目格式化
- `permission` — 权限 UI 显示
- `snap` — 结构化快照（code block/diff/task card）

## 应用层（`src/cli/`）

- `bootstrap.ts` — 启动引导
- `effect-cmd.ts` — Effect 命令运行器
- `ui.ts` — 终端 UI 工具函数
- `error.ts` — 错误格式化
- `heap.ts` — 堆内存监控
- `upgrade.ts` — 升级检查
