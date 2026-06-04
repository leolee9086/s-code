# Server & HTTP API

## 架构概览

```
server.ts (listen)
  → Effect-based HTTP server (effect/unstable/http)
    → HttpRouter + HttpApi middleware
      → typed routes (HttpApiBuilder.layer)
      → raw fallback route (UI)
```

## HTTP API 组

定义在 `packages/opencode/src/server/routes/instance/httpapi/groups/`，以 `HttpApiGroup` 声明端点元数据：

| Group | Prefix | 功能 |
|-------|--------|------|
| Config | `/config` | 读/写配置 |
| Control | `/control` | 实例控制 |
| Event | `/event` | SSE 事件流 |
| Experimental | `/experimental` | 实验特性 |
| File | `/file` | 文件读/写 |
| Global | `/global` | 全局路由 |
| Injection | `/injection` | 消息注入 |
| Instance | `/instance` | 实例元信息 |
| MCP | `/mcp` | MCP 工具 |
| Permission | `/permission` | 权限审批 |
| Project | `/project` | 项目管理 |
| Provider | `/provider` | Provider 管理 |
| Pty | `/pty` | 终端 |
| Question | `/question` | 用户提问 |
| Session | `/session` | session CRUD + summarize |
| Sync | `/sync` | 同步 |
| TUI | `/tui` | TUI 状态 |
| V2 | `/api/session` | V2 session API |
| Workspace | `/workspace` | 工作区 |

## Middleware 层

- `authorization.ts` — 鉴权
- `workspace-routing.ts` — 工作区路由上下文
- `instance-context.ts` — 实例上下文
- `compression.ts` — 压缩
- `cors-vary.ts` — CORS
- `error.ts` — 错误处理
- `fence.ts` — 请求隔离
- `schema-error.ts` — Schema 错误处理

## V2 Session API

定义在 `groups/v2/` 和 `handlers/v2/`：

| 端点 | 功能 |
|------|------|
| `GET /api/sessions` | 列出 sessions |
| `GET /api/session/:sessionID/messages` | 获取消息 |
| `GET /api/session/:sessionID/context` | 获取上下文（compaction 后）|
| `POST /api/session/:sessionID/prompt` | 发送 prompt |
| `POST /api/session/:sessionID/shell` | 执行 shell |
| `POST /api/session/:sessionID/skill` | 执行 skill |
| `POST /api/session/:sessionID/compact` | 触发压缩 |
| `POST /api/session/:sessionID/wait` | 等待空闲 |
| `POST /api/session/:sessionID/resume` | 恢复 session |

## ACP (Agent Client Protocol)

ACP 是 opencode 暴露给外部 IDE 集成的协议（类似于 MCP 但用于 AI agent 交互）。

`packages/opencode/src/acp/service.ts` 处理：
- `initialize` — 初始化连接
- `newSession` / `loadSession` / `closeSession` — session 管理
- `prompt` — 发送消息
- `cancel` — 取消请求
- `/compact` 命令直接调用 `sdk.session.summarize()`
- 其他自定义命令通过 `input.sdk.session.prompt()` 执行

## Layer 组合（server.ts:188-247）

```ts
createRoutes(corsOptions?)
  → mergeAll(
      rootApiRoutes,     // /global/* + control
      eventApiRoutes,    // SSE
      ptyConnectApiRoutes, // WebSocket
      instanceRoutes,    // 所有 instance API
      docRoute,          // OpenAPI /doc
      uiRoute,           // 回退 UI
    )
  → Layer.provide([...所有服务层])
    → HttpRouter.toWebHandler(routes)
```

## 启动流程

```ts
server.ts:listen(opts)
  → listenEffect(opts)
    → HttpServer.serve(app, { port, hostname })
    → 返回 Listener { hostname, port, url, stop }
```
