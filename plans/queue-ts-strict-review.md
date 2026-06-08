# 审查更新

编译错误已修复：
- ✅ `handlers/queue.ts:16` → 改为正确的 `import { SessionMapper, SessionMapperLive }`（line 17）
- ✅ `handlers/queue.ts:34` → `SessionMapper` 正确导入
- ✅ `queue.ts:197-198` → `_waitForSignal` hack 已移除，`runDispatcher` 签名干净

## 依旧存在的问题

### 1. `queue.ts:83` `notify` 是死代码

```typescript
let notify: (() => void) | null = null
```
声明但从无写入，从无读取。`signal()` 函数已被删除（之前调用 signal 的代码被移除），但 `notify` 变量保留。

### 2. `queue.ts:118-119` 条件变量注释承认未实现

```typescript
// 条件变量：push 后通知等待的 pop（消除空轮询，未实现）
// 当前 popBlocking 为简单非阻塞扫描，dispatcher 用 Effect.sleep 补偿
```

队列空时每 50ms `Effect.sleep` 摇一摇事件循环，无信号通知。

### 3. `queue.ts:185-187` `waitForTask` 是死代码

```typescript
export function waitForTask(q: RingQueueInterface): Promise<MessageRecord> { ... }
```
导出但从未被任何文件 import。用 `Promise` + `setTimeout` 的原始风格，不走 Effect。

### 4. `queue.ts:201` `loop` 永不停止

```typescript
let loop = true
while (loop) { ... }
```
无 `loop = false` 路径。只能在 fiber 层 `interrupt`，但 `runDispatcher` 内部无 `onInterrupt` 清理逻辑。

### 5. `queue.ts:205-212` handler 失败永久丢失

```typescript
const ok = yield* onMessage(task).pipe(
  Effect.catch((err) =>
    Effect.sync(() => { log.warn("handler failed, will retry", ...); return false })
  ),
)
if (ok) q.markDelivered(task.id)
else q.markFailed(task.id, "handler rejected")
```

`catch` 注释说 "will retry" 但只返回 `false` → `markFailed` 永久丢消息。注释与实际行为矛盾。

### 6. `session-mapper.ts:16` 纯内存映射永不持久化

```typescript
const map = new Map<string, string>()
```
进程重启后 token↔sessionID 映射全丢。`bind()` 无人调用（谁负责在 session 创建时注册 token？），dispatcher handler 的 resolve 永远返回 `undefined`。所有消息被 `handlers/queue.ts:46` 的 `if (!rawID) return` 静默丢弃（有日志）。

### 7. Ring 0 打断不存在

`handlers/queue.ts:52` 对所有 ring 统一 `setSuffixOnce`。Ring 0 行为与 Ring 3 完全一致。
