# 当前实现状态验证（重新阅读后）

## 已修复的

| 之前的问题 | 当前代码 | 修复 |
|-----------|---------|------|
| `delivering` crash 丢失 | `queue.ts:94` 注释改为不跳过 delivering | ✅ 崩溃恢复时重新处理 |
| 无重试 | `queue.ts:169-183` `markFailed` retryCount < MAX_RETRIES 时重置为 `pending` | ✅ 最多重试 3 次 |
| 无去重 | `queue.ts:84` `seen = Set<string>()` + 第 128 行 dedupeKey 检查 | ✅ dedupeKey 去重 |
| 无停止机制 | `queue.ts:198,204` `DispatcherControl` + `control.stopped` | ✅ 可停止 |
| 条件变量注释 | 保留但不再是死代码（`popNonBlocking` 仍轮询） | ⚠️ 仍为 50ms 轮询 |
| Ring 0 打断 | `handlers/queue.ts:54-55` Ring 0 用 `setPrefix`（立即生效）vs Ring 1-3 用 `setSuffixOnce` | ✅ 区分优先级 |
| session 绑定 | `handlers/queue.ts:84-86` `POST /queue/message` 支持 `sessionID + conversationToken` 同时传入 | ✅ 外部调用方可在一请求中完成绑定 |
| `bindSession` 暴露 | `handlers/queue.ts:66` QueueServiceInterface 包含 `bindSession` | ✅ 映射可写 |

## 剩余问题

### 1. 出站消息发送完全缺失（最大缺口）

LLM 响应仍只写入 session messages，**没有任何路径送回外部。** 需要：
- `send_channel_message` 等效工具 — LLM 调用后通过 `ChannelRegistry.get(channelId)` → `adapter.send(outboundMsg)` 发送
- 或：LLM 响应后自动通过 `conversationToken` 找到来源 adapater 并回发

### 2. 50ms 空轮询（`queue.ts:217`）

`popNonBlocking` 返回 `undefined` 时 `Effect.sleep("50 millis")`。

### 3. WAL 完整性

`appendFileSync` + `checkpoint` (每 50 ops) 的模型在 crash 于 `appendFileSync` 和 `seen.add` 之间的窗口可能丢失去重记录。

### 4. 无 `recoverStaleClaims` 

`delivering` 状态消息在 crash 恢复时不跳过（已修复），但没有超时恢复机制。如果 handler 永远不返回（fiber 泄漏），消息会卡在 `delivering`。

### 5. 无 WAL 裁剪

`delivered`/`failed` 消息的行只在 `checkpoint` 全量重写时清理。空闲队列从不 checkpoint，WAL 只增不减。

## 与 openclaw 对比差距还剩

| 能力 | openclaw | s-code |
|------|---------|--------|
| 入队去重 | `onConflict` | ✅ `dedupeKey` + `seen` Set |
| 重试 | `release` | ✅ `retryCount < MAX_RETRIES` |
| 出站发送 | `send.ts` + adapter.send() | ❌ **完全缺失** |
| claim 恢复 | `recoverStaleClaims` | ❌ 无 |
| WAL 裁剪 | `prune` TTL | ❌ 无 |
| 消息生命周期 hooks | ✅ | ❌ 无 |
| 自动回复引擎 | `auto-reply/thinking.ts` | ❌ 无 |
