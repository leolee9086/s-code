# S-Code vs OpenClaw 入站消息队列对比

## OpenClaw 的 `ingress-queue.ts`（`channels/message/`）

OpenClaw 的入站队列是基于 **SQLite** 的持久化队列，核心设计：

| 方法 | 功能 |
|------|------|
| `enqueue(id, payload)` | 写入 SQLite，`onConflict` 防重 |
| `claimNext()` | 原子 claim（`pending → claimed`），避免双发 |
| `complete(id)` | 标记完成（`claimed → completed`），清除 payload |
| `release(id)` | 释放回队列（`claimed → pending`），attempts+1 |
| `fail(id, reason)` | 永久标记失败 |
| `recoverStaleClaims()` | 恢复过期 claim |
| `prune()` | TTL 裁剪 |

**关键设计差异：**

| 维度 | OpenClaw ingress-queue | s-code RingQueue |
|------|----------------------|------------------|
| 持久化 | SQLite 事务（`kysely`） | 内存 + WAL append-only |
| 去重 | `onConflict` 内置 | 无 |
| 消费模型 | `claim → complete/release/fail` | `popNonBlocking → markDelivered/markFailed` |
| 重试 | `release` 递增 attempts | 无（handler 失败一次就永久失败） |
| 恢复 | `recoverStaleClaims` | 无（WAL 恢复所有未 delivered 消息） |
| 裁剪 | `prune` TTL 控制 | 无（WAL 只 checkpoint 不裁剪） |
| 阻塞等待 | 无（调用方轮询 `claimNext`） | 50ms `Effect.sleep` 轮询 |

## 核心缺口：s-code 无法完成 openclaw 同等能力

### 1. 无去重能力

OpenClaw 的 `enqueue` 用 `onConflict(["queue_name", "event_id"]).doNothing()` 保证同一消息不会被重复入队。

s-code `queue.ts:122-141` 的 `push` 无去重。即使 `id` 相同（`q-${Date.now()}-${seq}` 保证唯一），但如果是外部系统重试发送相同消息，RingQueue 会接受多次。

### 2. 无 claim 模式（消费安全）

OpenClaw 的 `claimNext()` 用 SQLite 事务将消息状态改为 `claimed` + 生成 `claim_token`。只有持有 token 的消费者可以 `complete/release/fail`。

s-code 的 `popNonBlocking` 直接将状态改为 `delivering`（等价于 claimed），但之后：
- 如果在 `onMessage` 完成后才 `markDelivered`（当前已修复顺序）——OK
- 但 crash 在 `markDelivered` 和 `checkpoint` 之间 → WAL 中是 `delivering` → WAL 恢复时跳过 `delivering`（`line 90: if (status === "delivering") continue`）→ 消息丢失

OpenClaw 的 `recoverStaleClaims` 可以恢复超时 claim，s-code 没有恢复机制。

### 3. 无重试机制

OpenClaw: `release` 递增 `attempts`，消费者可以判断是否超过最大重试次数再决定要不要 `fail`。

s-code: handler 失败一次就 `markFailed` + 永久丢失。

### 4. 无持久化完整性

OpenClaw 所有操作在 SQLite 事务中完成，crash-safe。

s-code WAL 的实现：
- `push`：`appendFileSync`（追加一行）
- `markDelivered/markFailed`：仅改内存 + `maybeCheckpoint`（每 50 次 ops 全量 checkpoint）
- `checkpoint`：`writeFileSync(tmp) + renameSync`（原子，但只在 ops≥50 时调用）
- 如果在 `markDelivered` 后、`maybeCheckpoint` 触发前 crash → WAL 中该消息状态仍是 `delivering` → 恢复时跳过（`line 90`）→ 消息丢失

### 5. 无裁剪机制

WAL 文件只通过 `checkpoint` 全量重写（每 50 次 ops）。如果队列长期空闲，`delivered` 的行不会清理。OpenClaw 的 `prune` 可以按 TTL 和最大条目数裁剪。

### 总结

| 能力 | OpenClaw ingress-queue | s-code RingQueue |
|------|----------------------|------------------|
| 持久化 | SQLite 事务 ✅ | 内存+WAL ⚠️ |
| 去重 | `onConflict` ✅ | 无 ❌ |
| 消费安全 | claim token ✅ | delivering 状态 ⚠️ |
| 崩溃恢复 | recoverStaleClaims ✅ | skip delivering ❌ |
| 重试 | release + attempts ✅ | 无 ❌ |
| 裁剪 | prune TTL ✅ | 无 ❌ |
| 阻塞等待 | 无（轮询 claimNext） | 50ms Effect.sleep ⚠️ |
