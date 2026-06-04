# Session 数据流详解

## prompt.ts 完整链路

### 入口

```
SessionPrompt.prompt(input)
  → 1. sessions.get(sessionID)
  → 2. revert.cleanup(session)         // 清理回退状态
  → 3. createUserMessage(input)        // 创建 user msg + parts
  → 4. sessions.touch(sessionID)
  → 5. loop({ sessionID })             // 进入循环
```

### Loop 状态机

```
SessionPrompt.runLoop(sessionID)
  while(true):
    1. status.set("busy")
    2. filterCompacted(sessionID)       // 过滤已 compaction 消息
    3. latest(msgs) → {user, assistant, finished, tasks}
    4. tasks.pop() → compaction | subtask(已移除)
    5. 检查 overflow → 自动 compaction
    6. SessionReminders.apply()
    7. SystemPrompt.skills() + .environment() + .system()
    8. check prefix/suffix injection
    9. SessionTools.resolve()           // 获取 tools
    10. SessionProcessor.create() → handle
    11. handle.process(streamInput)
    12. check result:
        - "stop" → break
        - "compact" → 创建 compaction task → continue
        - "continue" → continue while(true)
    13. injection.consumeSuffix()
    14. compaction.prune()
```

### Processor 内部

```
handle.process(streamInput)
  → LLM.Service.stream()              // LLM 流
    → 流式接收 text + tool_calls
      → text → updateTextPart()
      → tool_call → updateToolCall() → executeTool()
        → wait tool call done
      → LLM 继续 stream（tool call 结果作为后续输入）
    → loop 直到 LLM 返回 "stop"
  → 检查 needsCompaction
  → 返回 "compact" | "stop" | "continue"
```

### Tools 解析

```
SessionTools.resolve(input)
  → ToolRegistry.tools({ model, agent })
    → 根据 modelID/providerID/agent.permission 过滤
    → 为每个 tool 添加 plugin "tool.definition" hook
    → 返回 Tool.Def[]（含 execute）
  → 每个 tool 包装为 AI SDK tool 格式
    → tool() → execute 在 EffectBridge.run 中执行
  → 添加 MCP tools
```

## Session 类型体系

### legacy.ts（packages/core/src/session/legacy.ts）

核心消息类型：
- `User` — 用户消息（含 model, agent, format）
- `Assistant` — 助手消息（含 tokens, cost, finish, mode）
- `Part` — 消息部件（TextPart, ToolPart, FilePart, CompactionPart, ...）
- `WithParts` — 消息 + 部件组合（`{ info, parts }`）

### schema.ts（packages/opencode/src/session/schema.ts）

- `SessionID` — Branded string
- `MessageID` — Ascending ID（时间戳+random）
- `PartID` — 同上

### session.ts（packages/opencode/src/session/session.ts）

Legacy session CRUD：
- `Info` — id, slug, projectID, directory, title, parentID, model, revert, summary, ...
- `messages(sessionID)` — 获取消息列表
- `updateMessage/updatePart` — 写入消息/部件

### message-v2.ts

消息处理工具：
- `filterCompacted(msgs)` — 按 compaction 标记过滤并重排
- `latest(msgs)` — 获取最新 user/assistant/finished/tasks
- `toModelMessagesEffect(msgs, model)` — 转为 LLM 消息格式
- `stream(sessionID)` — 从数据库流式读取消息

## Compaction

自动触发：`overflow.ts` 检测 token 超限 → `compaction.create({ auto: true })`
手动触发：用户发送 compaction part 或调用 HTTP API

`select()` 决定保留哪些轮次：
- `headTurns` — 从头保留的前 N 轮
- `tailTurns` — 从尾保留的后 N 轮
- 预算 = `cfg.compaction.preserve_recent_tokens`（default 2000-8000 tokens）

压缩过程：
1. 用 compaction agent 调用 LLM 生成 summary
2. head 部分保留原始消息
3. tail 部分保留原始消息
4. 中间部分替换为 summary

## Injection API

`Injection.Service` 管理消息注入：
- `setPrefix` — 首轮注入
- `setSuffix` — 每轮注入
- `setSuffixOnce` — 仅下一轮注入
- `consumePrefix/consumeSuffix` — prompt.ts 中读取消费
- `onRoundComplete` — 每轮结束回调

HTTP API 端点（`packages/opencode/src/server/routes/instance/httpapi/`）：
- `POST /injection/prefix/:sessionID`
- `POST /injection/suffix/:sessionID`
- `DELETE /injection/:sessionID`
