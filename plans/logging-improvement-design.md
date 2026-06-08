# 日志系统改进设计：基于 Effect Logger

## 现状问题

当前日志系统由手写的 `packages/core/src/util/log.ts` 驱动，存在三个核心缺陷：

### 缺陷 1：日志不足

```typescript
// validate-session.ts:23-28
await createOpencodeClient({...}).session.get({ sessionID }, { throwOnError: true })
// 失败时只抛出 Error，没有任何日志
```

关键位置（validateSession、RPC fetch、Session.get）缺乏诊断日志。

### 缺陷 2：多通道日志混杂

```typescript
// Log.init():70-72
logpath = path.join(Global.Path.log, options.dev ? "dev.log" : ...)
```

main thread 和 Worker 都写 `dev.log`（Worker 的 `Log.init` 覆盖 main 的同文件）。

### 缺陷 3：日志输出目标不可配置

`Log.init(options)` 只能是写文件或写 stderr（`--print-logs`），不能同时输出。

## Effect Logger 架构

Effect 生态提供了完整的日志抽象，本项目已在用但只用了浅层：

```typescript
// 已存在的基础设施
packages/core/src/effect/logger.ts    // 桥接层：Effect → 自定义 Log
packages/core/src/util/log.ts          // 自定义日志实现（需要替换的下层）
```

### 核心接口

```typescript
// Effect 原生
Effect.logInfo("msg")                    // 日志
Effect.logDebug("msg", { key: "val" })   // + 结构化数据
Effect.annotateLogs(effect, { key })     // Fiber 级元数据

// Logger 定制
Logger.make((opts: Logger.Options) => void)  // 自定义 sink
Logger.layer([logger])                       // 注入 Runtime

// 元数据
opts.message      // 日志消息
opts.logLevel     // "Trace"|"Debug"|"Info"|"Warn"|"Error"|"Fatal"
opts.date         // 时间戳
opts.fiber.getRef(References.CurrentLogAnnotations)  // Fiber 级结构化数据
opts.cause        // Effect Cause

// 多目标组合
Logger.mergeAll([fileLogger, stderrLogger, otlpLogger])
```

## 改进方案

### 1. 多目标 Logger（替代手写 Log）

```typescript
// packages/core/src/effect/logger.ts

// 文件 sink（按进程角色隔离）
const fileSink = Logger.make((opts) => {
  const role = process.env.OPENCODE_PROCESS_ROLE ?? "main"
  const file = path.join(Global.Path.log, `opencode-${role}.log`)
  writeToFile(file, formatEffectLog(opts))
})

// stderr sink（可格式化）
const stderrSink = Logger.make((opts) => {
  if (opts.logLevel === "Error" || flags.printLogs) {
    process.stderr.write(formatPretty(opts))
  }
})

// OTLP sink（已有，不动）
const otlpSink = OtlpLogger.make({ url, resource, headers })

// 组合
export const layer = Logger.mergeAll([fileSink, stderrSink, otlpSink])
```

关键改进点：
- **按角色隔离**：`OPENCODE_PROCESS_ROLE` 区分 main/worker，写入不同文件
- **多目标同时输出**：文件 + stderr + OTLP 互不冲突
- **级别过滤**：Error 自动写 stderr，其他级别按需

### 2. validateSession 加诊断日志

```typescript
// validate-session.ts
import { EffectLogger } from "@opencode-ai/core/effect/logger"
const log = EffectLogger.create({ service: "validate-session" })

export async function validateSession(input: { ... }) {
  if (!input.sessionID) return

  const requestID = crypto.randomUUID().slice(0, 8)
  
  // 开始记录
  yield* log.info("validating session", {
    requestID,
    sessionID: input.sessionID,
    url: input.url,
    directory: input.directory,
    channel: process.env.OPENCODE_CHANNEL ?? "(unset)",
    dbPath: Database.path(),
  })

  try {
    const result = await sdk.session.get({ sessionID }, { throwOnError: true })
    yield* log.info("session validated", { requestID })
    return result
  } catch (error) {
    yield* log.error("session validation failed", {
      requestID,
      sessionID: input.sessionID,
      error: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
      httpStatus: (error as any)?.response?.status,
      httpBody: (error as any)?.response?.body,
    })
    throw error
  }
}
```

### 3. Worker fetch 入/出站日志

```typescript
// worker.ts
const log = EffectLogger.create({ service: "worker.fetch" })

async fetch(input: { url, method, headers, body }) {
  const requestID = headers["x-request-id"] ?? crypto.randomUUID().slice(0, 8)
  const start = Date.now()
  
  yield* log.info("request", {
    requestID, method: input.method,
    url: input.url,
    sessionID: input.url.match(/\/session\/([^/?]+)/)?.[1],
  })

  const response = await Server.Default().app.fetch(request)
  const body = await response.text()
  
  yield* log.info("response", {
    requestID,
    status: response.status,
    duration: Date.now() - start,
    bodyPreview: body.slice(0, 200),
  })

  return { status: response.status, body, headers: ... }
}
```

### 4. Session.get 加诊断上下文

```typescript
// session.ts
const get = Effect.fn("Session.get")(function* (id: SessionID) {
  const row = yield* db.select().from(SessionTable)
    .where(eq(SessionTable.id, id)).get().pipe(Effect.orDie)
  if (!row) {
    yield* Effect.logWarning("session not found in database", {
      sessionID: id,
      dbPath: Database.path(),
      channel: process.env.OPENCODE_CHANNEL,
    })
    return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }))
  }
  return fromRow(row)
})
```

## 迁移路径

### Phase 1：改进已有 Log 模块（最小改动）

1. 修改 `Log.init()` — 写入 `opencode-{role}.log` 而非 `dev.log`
2. 所有 Effect logger 调用由 `packages/core/src/effect/logger.ts` 桥接到新的多目标系统
3. 在关键位置加结构化日志（validateSession、Session.get、RPC fetch）

### Phase 2：Effect Logger 原生化（深度集成）

1. 用 `Logger.mergeAll` 替代手写 `Log` 
2. 逐步迁移 `Log.create({ service })` 调用到 `EffectLogger.create({ service })`
3. 利用 Effect 的 Fiber 级 `annotateLogs` 关联请求链路

## 不引入外部依赖

Effect 的 Logger + `@effect/opentelemetry` 的 `OtlpLogger` 已覆盖全部需求。无需要 Pino/Winston。
