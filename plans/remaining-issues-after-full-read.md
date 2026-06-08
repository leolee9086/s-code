# 完整阅读后的剩余问题

## 已删除的文件（不再存在）

| 文件 | 状态 |
|------|------|
| `channel/local-adapter.ts` | ❌ 已删除 |
| `channel/http-adapter.ts` | ❌ 已删除 |
| `cli/cmd/worker.ts` | ❌ 已删除 |
| `channel/subprocess-transport.ts` | ❌ 需确认 |
| `channel/index.ts` 自引用导出 | ❌ 需确认 |

## channel/ 模块当前状态

| 文件 | 状态 |
|------|------|
| `channel/queue.ts` | ✅ RingQueue + 重试 + 去重 + DispatcherControl |
| `channel/session-mapper.ts` | ✅ SessionMapper + Layer + bind/resolve/unbind |
| `channel/registry.ts` | ✅ 有 `defaultLayer` + `registerAdapter` 辅助 |
| `channel/adapter.ts` | ✅ ChannelAdapter 接口 |
| `channel/types.ts` | ✅ InboundMessage + OutboundMessage + WorkerRequest/Response |
| `channel/channel.ts` | ✅ Forever Mode 父子进程通信 Adapter |

## 仍然发现的真正问题

### 1. `registry.ts:60` `defaultLayer` 使用 `Layer.succeed` 但 `makeRegistry()` 访问 module-level `adapters` Map

```typescript
const adapters = new Map<string, ChannelAdapter>()  // module-level

export const defaultLayer = Layer.succeed(RegistryService, makeRegistry())
```

`makeRegistry()` 每次创建新对象但闭包捕获的是同一个 `adapters` Map。多个 Service 实例共享同一底层 Map，这应该是预期的（全局注册表），但 `registerAdapter`（第 63-68 行）也直接操作同一个 Map。**没有问题，但需要确保不会在测试中泄漏状态。**

### 2. `registry.ts:63-68` `registerAdapter` 返回 `Layer.Layer<never>` 但不保证 id 唯一

```typescript
export const registerAdapter = (adapter: ChannelAdapter): Layer.Layer<never> =>
  Layer.effectDiscard(Effect.sync(() => { adapters.set(adapter.id, adapter) }))
```

s-forge 的 `registry.go:18-20` 在重复 id 时 `panic`。这里静默覆盖。调用方不知道自己的适配器被覆盖。

### 3. `types.ts:49-61` `InboundMessage.userId` 是 required 但不是所有场景都有 userId

```typescript
userId: string  // required
```
对比 s-forge `types.go:8`：
```go
UserID string `json:"userId"`  // 没有 omitempty
```
一致。但 `handlers/queue.ts:81` 的 push handler 传入 `userId` 来自 `ctx.payload.userId`，如果外部调用不传 userId 则 `""`。**无校验。**

### 4. `queue.ts:84` `seen` Set 内存泄漏

```typescript
const seen = new Set<string>()
```

`markDelivered` / `markFailed` 时加入 `seen`。但如果外部系统从不重复发送，`seen` Set 持续增长，从不裁剪。**所有历史消息的 dedupeKey 永驻内存。**

### 5. 出站消息发送路径不存在

`adapter.ts` 定义了 `ChannelAdapter.send(msg: OutboundMessage)`，`registry.ts` 定义了 `get(id)` 和 `defaultLayer`。但**没有任何代码将 LLM 响应路由到 adapter.send()**。即使外部消息成功注入 LLM loop，LLM 产生的回复也只写入 session messages，无法通过 adapter 送回外部来源。

需要：LLM 调用的工具（如 `send_channel_message`）或 session loop 的 hook，在产生回复后调用 `registry.get(channelId) → adapter.send(outboundMsg)`。

### 6. `handlers/queue.ts:81` ring 由 `as TaskRing` 转换但 `groups/queue.ts:20` Schema 已有 `Schema.Int.check(Schema.isBetween({minimum:0, maximum:3}))` 验证

Schema 层已保证 ring 在 0-3 内。`as TaskRing` 在此处安全但多余。

### 7. 50ms 空轮询（`queue.ts:217`）

仍未修复。
