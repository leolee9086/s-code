# 提交 0d6cb4e9e 的架构错误

审查文件：adapter.ts, index.ts, registry.ts, session-mapper.ts, local-adapter.ts, queue.ts, subprocess-transport.ts, types.ts, worker.ts, groups/queue.ts, handlers/queue.ts

## 架构错误

### 1. 注册表无消费者——孤立的死代码

`registry.ts:30` 的 module-level Map 和 `RegistryService` Context Service 定义后，没有任何代码 import 或提供这个 Service。

**后果**：ChannelAdapter 可以注册但永远无法被使用——LLM loop 不会通过 Registry 查找适配器来发送出站消息。

### 2. SessionMapper 无消费者——孤立的死代码

`session-mapper.ts:16` 的 `const map = new Map()` + `SessionMapperLive` Layer 定义后同样无人引用。conversationToken ↔ sessionID 的映射关系对消息路由至关重要，但**没有人读这个映射**。

### 3. Worker 模式重复实现搜索系统

`worker.ts:98-133` 用 `curl | execSync` 手动 HTML 解析 DuckDuckGo/Bing/百度。s-code 已有**161 引擎的搜索系统**（`packages/opencode/src/search/`）。worker 模式应复用 `search/selector.ts` + `search/aggregator.ts` 等基础设施。

**后果**：
- 维护双份搜索逻辑
- 缺少缓存、去重、多引擎聚合等能力
- 新增搜索引擎时要改两个地方

### 4. Worker Shell/Git 处理有安全问题

`worker.ts:142` `handleShell` 不捕获 stderr：
```typescript
const stdout = execSync(p.command, ...)
// 返回: { stderr: "" } ← 永远为空
```
`worker.ts:189` `handleGit` 字符串拼接参数：
```typescript
const cmd = `git ${p.action} ${p.args ? Object.entries(p.args).map(([k, v]) => `${k} ${v}`).join(" ") : ""}`
```
`p.args` 的值未转义，恶意输入可注入 shell 命令。

### 5. local-adapter.ts capabilities 返回值是字面量

`local-adapter.ts:48`：
```typescript
capabilities: () => 1 | 2
```
这不是位掩码运算，而是一个 TypeScript 联合类型注解。`1 | 2` 在 JS 中是位运算 `1|2 = 3`，每次调用都重新计算。应使用 `Capability.Receive | Capability.ProactiveSend`。

### 6. queue.ts 和 types.ts——无运行时集成

同之前分析：`makeRingQueue()` 无人调用、`runDispatcher()` 无人启动、`DispatchHandler` 未实现。`MessageRecord` 的 `taskType` 字段无调度器消费。

### 7. groups/queue.ts 和 handlers/queue.ts——路由不注册

HTTP API 端点定义了但从未挂载：
- `groups/queue.ts` 未在 `api.ts` 中以 `.addHttpApi(QueueApi)` 注册
- `handlers/queue.ts` 未在 `server.ts` 的 `instanceApiRoutes` Layer.provide 列表中出现
- `queue.ts` 的 `defaultLayer` 不存在，无法被 `createRoutes` 提供

### 8. `index.ts` 自引用导出

`channel/index.ts:11`：
```typescript
export * as Channel from "./index"
```
这是自引用导出，会导致模块解析循环。所有导出已通过 `export * from "..."` 透传，此条多余且有害。

### 9. Worker 模式未注册到 CLI

`worker.ts:17` 定义了 `WorkerCommand`，但 `packages/opencode/src/index.ts` 没有 import 它，`opencode worker` 命令不可用。

### 10. socket empty stdin cmd

`worker.ts` 的 `handleShell`（line 142）和 `handleGit`（line 189）使用 `execSync` 不带 `stdin: "pipe"`，子进程继承父进程的 stdin，可能导致意外的 stdin 继承问题。OpenCode 的 `packages/opencode/src/tool/shell.ts` 已经实现了完整的 shell 执行器（含 timeout、stderr 捕获、stdin 管理），worker 应该复用它而非 `execSync`。

### 11. 没有 Bridge 模式

s-forge 有 `channel/bridge.go`（`Push(ctx, msg) → handler`）将 Adapter 入站消息连接到 Coordinator。s-code 完全缺失这一层：Adapter 可注册但无法路由消息到 LLM loop。`registry.ts` 只有 from-ID-to-adapter 的查找，没有 from-adapter-to-handler 的投递。
