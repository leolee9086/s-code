# RingQueue API 端到端设计

## 现存问题

1. `checkpoint()` 定义了但不调用 → WAL 无限增长
2. `markDelivered`/`markFailed` 不做持久化 → 崩溃后重复投递
3. `popBlocking` 命名错误，实质非阻塞
4. `startDispatcher` 100ms 空轮询浪费 CPU
5. 无 Effect Layer → 未注册到任何运行时代码路径
6. 无 HTTP 端点 → 外部无法投递消息

## OpenCode API 结构

```
api.ts → InstanceHttpApi 聚合所有 .addHttpApi(...)
         ├─ instance  (/instance/*)
         ├─ session   (/session/*)
         ├─ injection (/injection/*)
         ├─ tui       (/tui/*)
         ├─ v2        (/api/*)
         └─ ... 其他 16 个分组
```

每个分组分为：
- `groups/<name>.ts` — `HttpApiGroup.make(...)` 端点声明
- `handlers/<name>.ts` — `HttpApiBuilder.group(...)` 实现

## 新增 Queue API 分组

### `groups/queue.ts`

```typescript
export const QueuePaths = {
  push:   "/queue/message",
  status: "/queue/status",
} as const

export const QueueApi = HttpApi.make("queue")
  .add(
    HttpApiGroup.make("queue")
      .add(
        HttpApiEndpoint.post("push", QueuePaths.push, {
          body: Schema.Struct({
            channelId: Schema.String,
            channelType: Schema.String,
            accountId: Schema.String,
            userId: Schema.String,
            nickname: Schema.optional(Schema.String),
            text: Schema.optional(Schema.String),
            timestamp: Schema.optional(Schema.Number),
            ring: Schema.optional(Schema.Number),
            taskType: Schema.String,
            taskPayload: Schema.optional(Schema.Unknown),
          }),
          success: Schema.Struct({
            ok: Schema.Literal(true),
            messageID: Schema.String,
          }),
          error: HttpApiError.BadRequest,
        }),
      )
      .add(
        HttpApiEndpoint.get("status", QueuePaths.status, {
          success: Schema.Struct({
            total: Schema.Number,
            rings: Schema.Array(Schema.Number),
          }),
        }),
      )
      .middleware(Authorization),
  )
```

### `handlers/queue.ts`

```typescript
export const queueHandlers = HttpApiBuilder.group(InstanceHttpApi, "queue", (handlers) =>
  Effect.gen(function* () {
    const queue = yield* QueueService

    const push = Effect.fn("QueueHttpApi.push")(function* (ctx: {
      body: typeof PushBody.Type
    }) {
      const id = queue.push(ctx.body.ring ?? TaskRing.ExternalMessage, ctx.body)
      return { ok: true as const, messageID: id }
    })

    const status = Effect.fn("QueueHttpApi.status")(function* () {
      const rings = Array.from({ length: RING_COUNT }, (_, i) => queue.ringLen(i as TaskRing))
      return { total: queue.len(), rings }
    })

    return handlers.handle("push", push).handle("status", status)
  }),
)
```

### 注册到 API 树

`api.ts`:
```typescript
export const InstanceHttpApi = HttpApi.make("opencode-instance")
  .addHttpApi(QueueApi)   // ← 新增
  ...
```

`server.ts`:
```typescript
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    ...
    queueHandlers,        // ← 新增
  ]),
)
```

### defaultLayer 和 dispatcher

`queue.ts` 新增：

```typescript
export const defaultLayer = Layer.effect(
  QueueService,
  Effect.gen(function* () {
    const q = makeRingQueue()
    // 每轮 dispatcher 结束时 checkpoint
    startDispatcher(q, (rec) => {
      dispatchTask(rec)
      q.checkpoint?.()
    })
    return QueueService.of(q)
  }),
)
```

同时给 `RingQueueInterface` 暴露 `checkpoint` 方法。

### 对外暴露

`POST /queue/message` 端口对外暴露，外部系统（Discord bot、Telegram bot、webhook 等）通过 HTTP 投递消息到队列。队列按 ring 优先级消费，分派到工具执行器。
