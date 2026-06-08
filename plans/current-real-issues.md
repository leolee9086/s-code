# 当前真正存在的问题（重新阅读后）

## 已修复（不再存在）

- ✅ `queue.ts:61` — 已重命名为 `popNonBlocking`（之前叫 `popBlocking` 名实不符）
- ✅ `queue.ts:191` — 注释改为 "marked as failed"（之前写 "will retry"）
- ✅ `local-adapter.ts:49` — 改为 `Capability.Receive | Capability.ProactiveSend`（之前是 `1 | 2`）
- ✅ `worker.ts` — 文件已删除（ENOENT）
- ✅ `queue.ts:83` — `notify` 死代码已移除
- ✅ `queue.ts:176-188` — `waitForTask` 死代码已移除

## 仍存在的问题

### 1. `session-mapper.ts:16` — 纯内存 Map，bind 无人调用

```typescript
const map = new Map<string, string>()
```

`bind()` 方法从未被任何代码调用。所有外部消息的 `conversationToken` 无法映射到 sessionID。

`handlers/queue.ts:45-46`：
```typescript
const rawID = rec.conversationToken ? mapper.resolve(rec.conversationToken) : undefined
if (!rawID) { log.warn("drop msg: no session binding", ...); return }
```

resolve 永远返回 undefined，所有消息被静默丢弃。

### 2. `queue.ts:117-119` — 条件变量注释承认未实现

```typescript
// 条件变量：push 后通知等待的 pop（消除空轮询，未实现）
// 当前 popBlocking 为简单非阻塞扫描，dispatcher 用 Effect.sleep 补偿
```

`popNonBlocking` 队列空时返回 undefined。`runDispatcher` 用 `Effect.sleep("50 millis")` 空轮询。

### 3. `queue.ts:184` — loop 永不停止

```typescript
let loop = true
while (loop) { ... }
```

无 `loop = false` 路径。无停止/暂停机制。

### 4. Handler 失败永久丢失

```typescript
if (ok) q.markDelivered(task.id)
else q.markFailed(task.id, "handler rejected")
```

无重试逻辑。handler 失败一次就永久标记失败。

### 5. Ring 0 打断不存在

`handlers/queue.ts:52` 对所有 ring 统一 `setSuffixOnce`。Ring 0 和 Ring 3 行为相同。
