# Hacky 实现、桩代码和占位实现

**按严重程度排序**

## P0 — 运行时不会工作的桩

### 1. `handlers/queue.ts:44` Ring 0 打断是前/注释/占位
```typescript
// Ring 0 需 cancel + 创建 user message + 重启 loop（需暴露 SessionPrompt.loop）
// 目前 Ring 0 先按 Ring 1 处理，避免 prefix 注入导致消息序混乱
Effect.runPromise(injection.setSuffixOnce(sessionID, parts)).catch(() => {})
```
注释说 Ring 0 需要「打断 + 注入 + 重启」三元组，但实际代码用 `setSuffixOnce` 退化为普通入队。 **Ring 0 和 Ring 1 行为完全相同**，优先级分级设计是假象。

### 2. `handlers/queue.ts:37` sessionMapper.resolve 永远返回 undefined
```typescript
const sessionID = rec.conversationToken ? sessionMapper.resolve(rec.conversationToken) : undefined
if (!sessionID) return  // ← 总是 return，消息被静默丢弃
```
`session-mapper.ts` 的 `bind()` 从未被调用（**无人写映射**），`resolve()` 永远返回 `undefined`。所有入站消息都被 dispacher handler 静默丢弃。

### 3. `queue.ts` `popBlocking` 是非阻塞的
```typescript
popBlocking: () => {
  for (let i = 0; i < RING_COUNT; i++) {
    const idx = rings[i].findIndex(m => m.status === "pending")
    if (idx >= 0) { ... return rings[i][idx] }
  }
  return undefined  // ← 非阻塞，队列空时立即返回
}
```
命名 `popBlocking` 但实现是 `try-lock` 语义。所有调用者都把它当阻塞用，但队列空时返回 `undefined` 导致 50ms setTimeout 空转。

### 4. `handlers/queue.ts:26-54` `QueueServiceLive` 重复定义
`handlers/queue.ts:24` 定义 `QueueService`，但 `channel/queue.ts:121` 已经定义了另一个`QueueService(`(现已重命名为 `RingQueue`)。`handlers/queue.ts` 重复定义了同名 Service，运行时 Layer 冲突会静默覆盖。

## P1 — Hacky 实现

### 5. `worker.ts:98-133` 用 curl + HTML 正则替换 161 引擎搜索系统
worker 模式从零重复实现搜索（curl → execSync → HTML regex），完全不使用 s-code 已有的 `packages/opencode/src/search/`（161 引擎、聚合、缓存、去重）。

### 6. `local-adapter.ts:48` `1 | 2` 是类型注解陷阱
```typescript
capabilities: () => 1 | 2  // TypeScript 联合类型，不是位运算
```
每次调用 `1 | 2` 被 JS 解释为位运算 = `3`，但开发者意图可能是 `Capability.Receive | Capability.ProactiveSend`。这是 Hack：用字面量代替枚举组合。

### 7. `worker.ts:142,189` execSync 不管理 stderr/stdin
```typescript
const stdout = execSync(p.command, ...)
// 返回: { stderr: "" }  ← 永远为空，stderr 泄漏到父进程
// stdin 继承父进程，不安全
```

### 8. `queue.ts` `checkpoint` 已定义但不调用
`checkpoint()` 实现原子写 `writeFileSync + renameSync`，但 `push` 只用 `appendFileSync`，`markDelivered/markFailed` 只改内存。**WAL 无限增长，崩溃后消息丢失/重复。**

### 9. `session-mapper.ts` 纯内存无持久化
```typescript
const map = new Map<string, string>()
```
进程重启后所有 `conversationToken ↔ sessionID` 映射丢失。消息队列重启后无法路由到正确的 session。

## P2 — 未完成的集成桩

### 10. `groups/queue.ts` 和 `handlers/queue.ts` 路由不注册
路由定义的端点（`POST /queue/message`、`GET /queue/status`）和 handler 实现了但不挂载：
- `api.ts` 无 `.addHttpApi(QueueApi)`
- `server.ts` 无 `queueHandlers` 提供
- `channel/queue.ts` 无 `defaultLayer` 提供 `QueueService`

**HTTP API 不可达。**

### 11. `adapter.ts` ChannelAdapter 接口无使用者
`ChannelAdapter` 接口定义完整，但无人实现它（除 `local-adapter`）、无人通过 registry 查找它、LLM loop 不通过它发送出站消息。

### 12. `registry.ts` RegistryService 未注册到任何 Layer
```typescript
export class RegistryService extends Context.Service<...>()(...)
```
Service 定义存在但没有 `defaultLayer`，没有任何 `.provide(RegistryService)` 的代码。

### 13. `channel/index.ts:11` 自引用导出
```typescript
export * as Channel from "./index"
```
无意义且可能引起循环依赖。

### 14. `worker.ts` `WorkerCommand` 未注册到 index.ts
`opencode worker` CLI 命令定义了但不存在，用户无法启动 worker 模式。

### 15. `groups/queue.ts:19` ring 字段无校验
```typescript
ring: Schema.optional(Schema.Number)
```
用户可传 `ring: 99`，超出 `RING_COUNT=4` 范围，`push` 直接 `return ""` 静默失败。
