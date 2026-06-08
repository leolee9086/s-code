# 注释欺诈与伪实现扫描

## channel/ 模块

### 1. `queue.ts:212` 注释说 "will retry" 但实际永久丢失

```typescript
Effect.catch((err) =>
  Effect.sync(() => { log.warn("handler failed, will retry", { id: task.id, err }); return false })
)
if (ok) q.markDelivered(task.id)
else q.markFailed(task.id, "handler rejected")
```

注释承诺重试。实现永久失败。**注释与行为矛盾。**

### 2. `queue.ts:4-6` 注释声称 "参考 s-forge"

文件头写"参考 s-forge: kernel/api/magi_priority_queue.go (DispatcherRingQueue)"。实际上 s-forge 的 `DispatcherRingQueue` 使用 Go channel 原生阻塞 + 条件变量唤醒，而本实现是 50ms 空轮询。**参考但不实现关键机制（阻塞等待）。**

### 3. `queue.ts:58-66` `RingQueueInterface` 包含 `popBlocking` 接口

接口命名 `popBlocking` 暗示阻塞语义。实现不阻塞。**接口签名与实际行为不一致。**

### 4. `queue.ts:192-193` dispatcher 注释声称 "不逃逸运行时"

```typescript
// dispatcher 本身是一个 Effect，在 Effect 运行时内运行。
// onMessage 返回 Effect<void>，由 dispatcher 通过 yield* 调用。
// 无需 runPromise、无需自制 runtime。
```

虽然 `runDispatcher` 确实是 Effect，但 `handlers/queue.ts:41` 用 `Effect.forkScoped` 启动后无法停止。**Effect 运行时正确，但生命周期管理缺失。**

### 5. `queue.ts:118-119` 注释承认未实现

```typescript
// 条件变量：push 后通知等待的 pop（消除空轮询，未实现）
```

这是代码中**最诚实的注释**，但暴露了一个从未完成的优化。

## session-mapper.ts

### 6. `session-mapper.ts:3-5` 注释声称 "dispatch handler 据此路由"

```typescript
// conversationToken → sessionID 映射。
// 外部消息通过 conversationToken 指向目标 session，dispatch handler 据此路由。
```

`bind()` 从未被调用。无人将 token→sessionID 写入映射。dispatch handler 永远 route 不到目标。**注释描述的完整功能从未实现。**

## handlers/queue.ts

### 7. `handlers/queue.ts:3-5` 文件头注释声称 "端到端链路"

```typescript
// 端到端链路:
//   POST /queue/message → RingQueue.push() → runDispatcher → handler → LLM
```

链路在技术上完成（HTTP→Queue→Dispatcher→Injection→LLM），但：
- `sessionMapper.resolve()` 永远返回 `undefined` → handler 在 `!rawID` 丢弃消息
- 即使有 token，`bind` 无人调 → resolve 永远 undefined
- Ring 0 不打断 → 所有 ring 都是排队

### 8. `groups/queue.ts:19` `ring` 字段无 validation Schema

```typescript
ring: Schema.optional(Schema.Number)
```

`Schema.Number` 接受任何数字。负数和 >3 的值只能由 handler 层校验。Schema 层已设 `InvalidRequestError` 错误类型但未利用 Schema 的 `filter`/`pipe` 能力。**声明了 `error: InvalidRequestError` 但不在 Schema 中加 `Schema.filter` 约束。**

## 其他模块

### 9. `channel/local-adapter.ts:48` capabilities 字面量

```typescript
capabilities: () => 1 | 2
```

`1 | 2` 是 TypeScript 联合类型注解，运行时被 JS 解释为 `(1 | 2) === 3`（位运算）。注释说 "Receive | ProactiveSend"。**类型注解在运行时被求值为 3，但开发者意图是 `Capability.Receive | Capability.ProactiveSend`。**

### 10. 确认仍存在的旧问题

| 旧问题 | 状态 |
|--------|------|
| `worker.ts` — 用 curl 替代 161 引擎搜索 | 仍存在，无变化 |
| `worker.ts:189` — git 字符串拼接注入漏洞 | 仍存在 |
| `s-forge-analysis/` 设计文档与实现脱节 | 仍存在 |
| `channel/adapter.ts` + `registry.ts` — 无人消费 | 仍存在 |
| `channel/types.ts` — `InboundMessage` 等仅被已删除的 `worker.ts` 使用 | 仍存在 |
