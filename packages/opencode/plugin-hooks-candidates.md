# Plugin Hook Candidates

> 扫描现有代码中尚未暴露为 plugin hook 的关键代码位置。
> 记录每个候选点的位置、当前行为、以及与插件交互的潜在价值。

## 约定

- **现有 hooks**: `packages/plugin/src/index.ts` 中 `Hooks` 接口定义的 ~23 个 hooks
- Hook 调用模式: `yield* plugin.trigger("hook.name", input, output)`
- 插件通过 `@opencode-ai/plugin` 的 `Hooks` 接口注册回调

---

## 1. session/processor.ts — LLM 流处理

### 1.1 Tool Result 接收前 (tool-result event, L562)

**位置**: `session/processor.ts:562-658`

**当前行为**: 当 LLM 返回 tool-result 事件时，processor 将原始输出格式化为 `{ title, metadata, output, attachments }` 并保存到数据库。没有 hook 让插件预览或修改工具结果。

**潜在 hook**: `"tool.result.before"`
- input: `{ sessionID, toolCallID, toolName, args }`
- output: `{ title, metadata, output, attachments }` → 插件可修改/过滤/增强结果

### 1.2 工具执行失败 (failToolCall, L234)

**位置**: `session/processor.ts:234-251`

**当前行为**: 工具执行出错时将状态标记为 `error` 并记录错误消息。没有 hook 让插件拦截或处理错误。

**潜在 hook**: `"tool.execute.error"`
- input: `{ sessionID, toolCallID, toolName, error }`
- output: `{ handled?: boolean; retry?: boolean }` → 插件可决定是否重试

### 1.3 处理流程错误 (halt 方法, L938)

**位置**: `session/processor.ts:938-974`

**当前行为**: 处理出错时记录日志、发布 EventV2 事件。没有 hook 让插件拦截或自定义错误处理。

**潜在 hook**: `"session.process.error"`
- input: `{ sessionID, error, errorType: "overflow" | "provider" | "unknown" }`
- output: `{ suppressDefault?: boolean }` → 插件可覆盖默认错误行为

### 1.4 Step Finish (step-finish 事件, L705)

**位置**: `session/processor.ts:705-768`

**当前行为**: 一步 LLM 调用结束时计算 usage、更新 message、条件触发 compaction。没有 hook。

**潜在 hook**: `"session.step.finish"`
- input: `{ sessionID, finishReason, usage: { tokens, cost }, needsCompaction }`
- output: `{}` → 插件可用于用量跟踪/计费

### 1.5 内容过滤器触发 (text-end 内容过滤, L832)

**位置**: `session/processor.ts:832-838`

**当前行为**: 文本生成结束后检查 content_filter，命中时抛出错误。没有 hook 通知插件过滤命中。

**潜在 hook**: `"session.content.filter.hit"`
- input: `{ sessionID, field: "text" | "reasoning", matchedPattern }`
- output: `{}` → 插件可记录违规/告警

---

## 2. session/prompt.ts — 会话循环

### 2.1 循环退出/中断 (L1460, L1729, L1785)

**位置**: `session/prompt.ts:1460`

**当前行为**: 循环在多种条件下退出（无工具调用、错误、用户中断等）。`loop.continue` 仅用于 forever 模式，非 forever 模式退出没有 hook。

**潜在 hook**: `"session.loop.exit"`
- input: `{ sessionID, reason: "no-tool-calls" | "error" | "user-interrupt" | "forever-exit" | "structured-output", round, error? }`
- output: `{}` → 插件可监控循环终止原因

### 2.2 循环开始/初始化 (runLoop, L1339)

**位置**: `session/prompt.ts:1339`

**当前行为**: 循环开始时设置 status、加载消息、检查 forever/evolve 模式。没有 hook。

**潜在 hook**: `"session.loop.start"`
- input: `{ sessionID, isForeverMode, isEvolveMode, round: 0 }`
- output: `{}` → 插件可初始化每个循环所需的状态

### 2.3 Round 处理开始 (每轮循环开始, L1349)

**位置**: `session/prompt.ts:1349`

**当前行为**: 每轮循环设置 busy 状态、加载消息。没有每轮开始的 hook。

**潜在 hook**: `"session.round.start"`
- input: `{ sessionID, round, lastFinish?, hasToolCalls? }`
- output: `{}` → 插件可追踪轮次

### 2.4 Shell 命令执行完成 (shellImpl, L629)

**位置**: `session/prompt.ts:629-659`

**当前行为**: Shell 命令执行完成后将输出写入数据库。没有 hook 让插件查看或修改 shell 结果。

**潜在 hook**: `"shell.execute.after"`
- input: `{ sessionID, command, output, exitCode }`
- output: `{ output?: string }` → 插件可审查/修改 shell 输出

### 2.5 Command 执行后 (command handler, L2123-2143)

**位置**: `session/prompt.ts:2123-2143`

**当前行为**: `command.execute.before` 已存在，但执行完成后没有 `command.execute.after` hook。

**潜在 hook**: `"command.execute.after"`
- input: `{ command, sessionID, arguments, result: { messageID } }`
- output: `{}` → 插件可追踪命令执行结果

### 2.6 Compaction 溢出触发 (overflow 检查, L1493)

**位置**: `session/prompt.ts:1493-1500`

**当前行为**: 检查到 token 溢出时自动创建 compaction。没有 hook 让插件干预。

**潜在 hook**: `"session.compaction.overflow"`
- input: `{ sessionID, tokens, model }`
- output: `{ skip?: boolean }` → 插件可决定是否跳过自动 compaction

### 2.7 Agent 切换/模型切换 (L787, L795)

**位置**: `session/prompt.ts:787-810`

**当前行为**: 当用户消息的 agent 或 model 与 session 当前记录不一致时发布 EventV2 事件。没有 plugin hook。

**潜在 hook**: `"session.model.switched"` / `"session.agent.switched"`
- input: `{ sessionID, agent?, model? }`
- output: `{}` → 插件可监控切换

---

## 3. session/compaction.ts — 会话压缩

### 3.1 Compaction 创建时 (create, L607)

**位置**: `session/compaction.ts:607-638`

**当前行为**: compaction 创建时写入一条用户消息带 `type: "compaction"` 的 part 并发布事件。没有 hook。

**潜在 hook**: `"session.compaction.create"`
- input: `{ sessionID, agent, model, auto, overflow }`
- output: `{ skip?: boolean }` → 插件可阻止 compaction

### 3.2 Compaction 处理失败 (process 返回 "stop", L476)

**位置**: `session/compaction.ts:476-485`

**当前行为**: compaction 处理失败时设置 error 信息并返回 "stop"。没有 hook。

**潜在 hook**: `"session.compaction.failed"`
- input: `{ sessionID, reason: "overflow" | "error", error? }`
- output: `{}` → 插件可告警

### 3.3 Pruning (prune, L315)

**位置**: `session/compaction.ts:315-359`

**当前行为**: 删除旧工具调用的输出来释放上下文。没有 hook。

**潜在 hook**: `"session.prune.after"`
- input: `{ sessionID, prunedCount, freedTokens }`
- output: `{}` → 插件可监控上下文清理

---

## 4. tool/shell.ts — Shell 工具执行

### 4.1 Shell 命令超时/终止 (L575-581)

**位置**: `tool/shell.ts:575-581`

**当前行为**: 超时或被中断时更新 metadata 标记。没有 hook。

**潜在 hook**: `"shell.execute.error"`
- input: `{ sessionID, command, error: "timeout" | "abort" | "exit", exitCode? }`
- output: `{}` → 插件可监控 shell 异常

### 4.2 Shell 输出截断 (L596-607)

**位置**: `tool/shell.ts:596-607`

**当前行为**: 输出被截断时保存到文件。没有 hook。

**潜在 hook**: `"shell.output.truncated"`
- input: `{ sessionID, command, outputFile, originalSize }`
- output: `{}` → 插件可记录截断事件

---

## 5. provider/provider.ts — 提供商管理层

### 5.1 模型解析失败 (getModel, L1788)

**位置**: `provider/provider.ts:1788-1810`

**当前行为**: 模型不存在时抛出 `ModelNotFoundError`。没有 hook 让插件提供替代模型。

**潜在 hook**: `"provider.model.notfound"`
- input: `{ providerID, modelID, sessionID? }`
- output: `{ fallbackModel?: { providerID, modelID } }` → 插件可提供备用模型

### 5.2 Provider 初始化/列表

**潜在 hook**: `"provider.list.after"`
- input: `{ providers: [...] }`
- output: `{ providers: [...] }` → 插件可修改 provider 列表或排序

---

## 6. session/llm.ts — LLM 请求层

### 6.1 LLM 流创建前/运行时选择 (stream, L359)

**位置**: `session/llm.ts:359-383`

**当前行为**: stream 方法创建 AbortController、选择运行时（native/AI SDK）、转换流事件。没有 hook。

**潜在 hook**: `"llm.stream.start"`
- input: `{ sessionID, model, agent, runtime: "native" | "ai-sdk" }`
- output: `{}` → 插件可追踪 LLM 调用

---

## 7. session/tools.ts — 工具调度

### 7.1 MCP 工具执行后输出处理 (L237-258)

**位置**: `session/tools.ts:237-258`

**当前行为**: MCP 工具结果中的 content 被解析为 textParts 和 attachments。没有 hook 让插件修改这个转换。

**潜在 hook**: `"tool.mcp.result.transform"`
- input: `{ sessionID, toolName, callID, content }`
- output: `{ textParts, attachments }` → 插件可自定义 MCP 结果解析

---

## 8. Permission 系统

### 8.1 Permission "always" 批准追加 (L158-164)

**位置**: `permission/index.ts:158-164`

**当前行为**: 用户选择 "always" 时，规则被追加到 approved 列表。没有 hook 通知插件哪些权限被永久批准。

**潜在 hook**: `"permission.always.approved"`
- input: `{ sessionID, permission, pattern }`
- output: `{}` → 插件可记录权限审计

---

## 9. Session 生命周期

### 9.1 Session 创建 (create, L716)

**位置**: `session/session.ts:716-738`

**当前行为**: Session 被创建时发布 EventV2 `Created` 事件。没有 plugin hook。

**潜在 hook**: `"session.created"`
- input: `{ sessionID, projectID, title?, parentID? }`
- output: `{}` → 插件可初始化和 session 绑定的状态

### 9.2 Session 删除 (remove, L655)

**位置**: `session/session.ts:655-676`

**当前行为**: Session 被删除时没有 hook 通知插件。

**潜在 hook**: `"session.deleted"`
- input: `{ sessionID }`
- output: `{}` → 插件可清理相关资源

---

## 10. CLI 命令层（未覆盖区域）

### 10.1 Session 管理操作 (list/delete/fork)

**位置**: `cli/cmd/session.ts`

**当前行为**: Session 的 CRUD 操作没有通知插件。Session 删除/分叉时插件无法清理资源。

**潜在 hook**: `"session.deleted"` 已在 9.2 中提过，同样适用于 CLI 层面。

### 10.2 CLI 统计信息

**位置**: `cli/cmd/stats.ts`

**当前行为**: 显示统计信息时没有 hook。

**潜在 hook**: `"cli.stats"` — 插件可贡献自定义统计指标

### 10.3 通用 CLI 命令执行

**位置**: `cli/cmd/cmd.ts`

**当前行为**: CLI 命令入口没有通用 hook 让插件拦截或增强命令。

**潜在 hook**: `"cli.command.before"` / `"cli.command.after"`
- input: `{ command, args, flags }`
- output: `{ modifiedArgs?, skip?, customResponse? }` → 可扩展 CLI 功能

---

## 11. 存储/数据层

### 11.1 Storage 读写操作

**位置**: `storage/storage.ts`

**当前行为**: 数据被写入存储时没有 hook 通知插件。

**潜在 hook**: `"storage.write"` / `"storage.read"`
- input: `{ key, value?, size? }`
- output: `{}` → 插件可监控存储操作或同步数据

---

## 12. Server/HTTP API

### 12.1 API 请求处理

**位置**: `server/routes/instance/httpapi/server.ts`

**当前行为**: Server 调用 `Plugin.defaultLayer` 但从未调用 `plugin.trigger()`。HTTP API 请求处理过程中没有 hook。

**潜在 hook**: `"server.request.before"` / `"server.request.after"`
- input: `{ method, path, headers? }`
- output: `{ modifiedHeaders?, earlyResponse? }` → 插件可注入自定义 header 或拦截请求

---

## 13. 其他未覆盖模块

以下模块已接入 `Plugin.Service` 但没有任何 `trigger()` 调用，可能存在 hook 机会：
- **`evolve/`** — 进化模式进入/退出事件
- **`prefix-command/`** — 前缀命令处理
- **`image/`** — 图片处理流程
- **`background/job.ts`** — 后台任务生命周期

---

## 现有 Hook 覆盖度总结

| 模块 | 已有 Hooks | 缺失关键点 |
|------|-----------|-----------|
| session/processor.ts | `experimental.text.complete` | tool result 前, error, step finish, filter hit |
| session/prompt.ts | `loop.continue`, `loop.inject`, `chat.message`, `command.execute.before`, `experimental.chat.messages.transform`, `shell.env` | loop exit, round start, command.after, shell.after, overflow, switch |
| session/compaction.ts | `experimental.session.compacting`, `experimental.compaction.autocontinue`, `experimental.chat.messages.transform` | create, failed, prune |
| session/llm.ts | `chat.params`, `chat.headers`, `experimental.chat.system.transform` | stream start (低优先级) |
| session/tools.ts | `tool.execute.before`, `tool.execute.after` | MCP result transform |
| tool/shell.ts | `shell.env` | shell error, output truncated |
| tool/registry.ts | `tool.definition` | 覆盖充分 |
| provider/provider.ts | `experimental.provider.small_model` | model not found, provider list |
| agent/agent.ts | `experimental.chat.system.transform` | 覆盖充分 |
| permission/ | `permission.ask` (已有) | always approved notify |
| cli/cmd/ | 无 | 所有 CLI 命令 |
| storage/ | 无 | 存储读写 |
| server/httpapi | 无 | API 请求处理 |
| evolve/ | 无 | 模式进入/退出 |
| background/job.ts | 无 | 任务生命周期 |

---

## 优先级建议

### P0 (高价值，易实现)
1. **`tool.execute.error`** — processor.ts L234, tool 执行失败通知
2. **`session.loop.exit`** — prompt.ts L1460, 循环退出通知（非 forever 模式）
3. **`session.process.error`** — processor.ts L938, 处理流程异常

### P1 (中价值)
4. **`tool.result.before`** — processor.ts L562, 工具结果修改
5. **`command.execute.after`** — prompt.ts L2143, 命令执行后
6. **`session.step.finish`** — processor.ts L705, 每步完成

### P2 (低价值/探索性)
7. **`shell.execute.error`** — 超时/中断
8. **`session.compaction.create`** — compaction 创建时
9. **`session.created`/`session.deleted`** — session 生命周期
10. **`provider.model.notfound`** — 模型解析失败
