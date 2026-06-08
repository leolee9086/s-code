# 诊断改进计划：evolve 启动时 validateSession 失败问题

## 问题陈述

`evolve.ts` 启动的二进制的 TUI 线程调用 `validateSession()` 验证续接 session 时失败，报 "Session not found"。
但同进程的 Worker 后台能正确接续 session 并继续 evolve 任务。

## 根因定义

当前无法通过日志确定具体原因，因为存在以下**系统级诊断缺陷**：

### 缺陷 1：validateSession 失败不留上下文

**位置**: `packages/opencode/src/cli/cmd/tui/validate-session.ts:23-28`

```typescript
await createOpencodeClient({
  baseUrl: input.url, directory: input.directory,
  fetch: input.fetch,
}).session.get({ sessionID }, { throwOnError: true })
```

失败时抛出 SDK 的通用 Error，`errorMessage(error)` 只取到字符串描述（如 `Session not found: ses_xxx`），丢失：
- HTTP 状态码（404 还是 500？）
- 响应 body（Error 类型、ref ID）
- 请求 URL 和 sessionID
- 当前 `OPENCODE_CHANNEL` 值
- `Database.path()` 指向的文件

### 缺陷 2：Worker RPC fetch 无入/出站日志

**位置**: `packages/opencode/src/cli/cmd/tui/worker.ts:63-81`

Worker 的 `rpc.fetch()` 直接调用 `Server.Default().app.fetch()` 后只返回 `{ status, body }`，
没有在请求前后记录任何日志。当请求失败时（404 或 500），无法在 Worker 日志中看到：
- 入站请求的方法/URL/headers
- 出站响应的状态码/body 摘要
- 处理耗时

### 缺陷 3：thread.ts 的 catch 块丢弃错误细节

**位置**: `packages/opencode/src/cli/cmd/tui/thread.ts:288-290`

```typescript
} catch (error) {
  sessionNotFound = errorMessage(error)
}
```

`errorMessage(error)` 将 Error 对象转为纯字符串，丢弃了：
- Error 的 `cause` 链
- HTTP 响应状态码
- SDK 错误的结构化数据

### 缺陷 4：Session.get 无诊断上下文

**位置**: `packages/opencode/src/session/session.ts:609-612`

```typescript
const row = yield* db.select().from(SessionTable)
  .where(eq(SessionTable.id, id)).get().pipe(Effect.orDie)
if (!row) return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }))
```

`NotFoundError` 只有 message，不包含：
- 当前数据库文件路径
- 当前 `OPENCODE_CHANNEL`
- SessionID 值
- 当前工作目录

### 缺陷 5：main thread 和 Worker 日志隔离

- main thread 调用 `Log.init()` 后写日志到 `dev.log`
- Worker 也调用 `Log.init()` 后写日志到另一个 `dev.log`（覆盖！）
- 无法关联同一个 validateSession 请求在 main thread 和 Worker 两端的日志

## 改进方案

### A. validateSession 加诊断日志（入口）

在 `validate-session.ts` 中，在请求前后记录关键上下文：

```typescript
import * as Log from "@opencode-ai/core/util/log"
const log = Log.create({ service: "validate-session" })

export async function validateSession(input: { ... }) {
  if (!input.sessionID) return
  log.info("validating session", {
    sessionID: input.sessionID,
    url: input.url,
    directory: input.directory,
    channel: process.env.OPENCODE_CHANNEL ?? "(unset)",
  })
  try {
    await ...session.get({ sessionID }, { throwOnError: true })
    log.info("session validated")
  } catch (error) {
    log.error("session validation failed", {
      sessionID: input.sessionID,
      error: errorMessage(error),
      cause: error instanceof Error ? error.cause : undefined,
    })
    throw error
  }
}
```

### B. Worker fetch 加入/出站日志

在 `worker.ts` 的 `rpc.fetch` 中，记录请求和响应摘要：

```typescript
async fetch(input: { ... }) {
  const start = Date.now()
  log.info("fetch", {
    method: input.method,
    url: input.url,
    sessionID: input.url.match(/\/session\/([^/?]+)/)?.[1],
  })
  const response = await Server.Default().app.fetch(request)
  const body = await response.text()
  log.info("fetch response", {
    status: response.status,
    duration: Date.now() - start,
    bodyPreview: body.slice(0, 200),
  })
  return { status: response.status, ... }
}
```

### C. thread.ts catch 块记录完整错误

在 `thread.ts:288` 处，将 SDK 错误的完整结构记录下来：

```typescript
} catch (error) {
  const msg = errorMessage(error)
  log.warn("validateSession failed", {
    sessionID: args.session,
    error: msg,
    cause: error instanceof Error ? error.cause : undefined,
    dbPath: Database.path(),
    channel: process.env.OPENCODE_CHANNEL,
  })
  sessionNotFound = msg
}
```

### D. Worker RPC 的服务器端用 `OPENCODE_CHANNEL` 记录数据库路径

当 Worker 处理 `rpc.fetch` 时，如果需要访问 `session.get`，在 Session 层记录 `Database.path()`：

```typescript
// session.ts:609
const get = Effect.fn("Session.get")(function* (id: SessionID) {
  const row = yield* db.select().from(SessionTable)
    .where(eq(SessionTable.id, id)).get().pipe(Effect.orDie)
  if (!row) {
    log.warn("session not found", { sessionID: id, dbPath: Database.path() })
    return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }))
  }
  return fromRow(row)
})
```

### E. 日志通道关联（可选）

在 `thread.ts` 中为每个 validateSession 请求生成一个请求 ID，通过 `x-request-id` header 透传到 Worker。
Worker 在处理请求时记录这个 request ID，两端日志可关联。

```typescript
const requestID = crypto.randomUUID().slice(0, 8)
// 在 SDK client 的 headers 中传
headers: { "x-request-id": requestID }
// Worker 的 rpc.fetch 记录:
log.info("fetch request", { requestID, url, ... })
// 响应时:
log.info("fetch response", { requestID, status, ... })
```

## 实施优先级

1. **A + B** — 最基础，事件发生时能定位错误类型（404 vs 500 等）
2. **C** — 确保 main thread 捕获到错误时记录数据库上下文
3. **D** — 服务端确认 Session.get 发生在哪个数据库
4. **E** — 可选增强，用于端到端追踪
