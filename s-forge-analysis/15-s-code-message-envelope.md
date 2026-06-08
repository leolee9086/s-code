# S-Code 消息信封设计（与 S-Forge 兼容）

## 概述

s-code 需要实现与 s-forge 完全兼容的消息信封，作为 `external-agent` 类型 Channel 接入 s-forge 的消息总线。

## 消息层次

```
s-forge MAGI 内部           Channel 层               s-code 进程
────────────────────────────────────────────────────────────
MAGI Message           →   OutboundMessage   →    stdin
ContextMessage         →   InboundMessage    ←    stdout
SageResponse           →   ToolCall Result    ←    stdout
RequestSourceContext   →   信封元数据          →    环境变量
```

## 核心消息结构

### 1. OutboundMessage（s-forge → s-code）

s-forge 通过 `send_channel_message` 工具向 s-code 发送消息：

```jsonc
// 来自 s-forge channel/types.go
{
  "channelId": "s-code-app",        // s-code 渠道实例 ID
  "channelType": "external-agent",  // 渠道类型
  "accountId": "magi",              // 发送方（MAGI）
  "userId": "user-xxx",             // 目标用户
  "text": "执行搜索：Rust 2026",     // 消息内容
  "media": [],                      // 可选附件
  "conversationToken": "sess-xxx"   // 会话令牌
}
```

### 2. InboundMessage（s-code → s-forge）

s-code 处理后返回结果给 s-forge：

```jsonc
// 来自 s-forge channel/types.go
{
  "channelId": "s-code-app",
  "channelType": "external-agent",
  "accountId": "s-code",             // 发送方（s-code）
  "userId": "user-xxx",
  "text": "搜索结果：...",           // 响应内容
  "media": [],
  "conversationToken": "sess-xxx",
  "timestamp": 1780925000000
}
```

### 3. ToolCall 格式（s-forge Sage → s-code）

当 Sage 调用 `send_channel_message` 工具时，发送完整的工具调用参数：

```jsonc
// 来自 send_channel_message 工具定义
{
  "type": "function",
  "function": {
    "name": "send_channel_message",
    "arguments": {
      "channelId": "s-code-app",
      "accountId": "magi",
      "userId": "user-xxx",
      "content": "执行搜索：Rust 2026",
      "motivation": "用户询问 Rust 2026 特性，需要从网络搜索获取最新信息"
    }
  }
}
```

### 4. 治理复核结果（s-code 返回）

s-code 执行后，返回治理复核所需的元数据：

```jsonc
{
  "ok": true,
  "state": "sent",
  "channelId": "s-code-app",
  "accountId": "s-code",
  "userId": "user-xxx",
  "executionSummary": {
    "tool": "search",
    "query": "Rust 2026",
    "resultsCount": 8,
    "durationMs": 2340
  }
}
```

## s-code 端消息处理

### 子进程通信协议

s-code 作为子进程被 s-forge 启动，通过 **stdin/stdout** 接收和发送消息。

```
s-forge → stdin (每行一条 JSON 消息)
s-code  → stdout (每行一条 JSON 响应)
```

### 请求格式（s-code 接收）

```jsonc
// stdin 输入
{
  "id": "req-001",
  "type": "search",         // search | shell | read | write | edit | git | execute
  "envelope": {              // ← s-forge OutboundMessage 兼容
    "channelId": "s-code-app",
    "channelType": "external-agent",
    "accountId": "magi",
    "userId": "user-xxx",
    "conversationToken": "sess-xxx"
  },
  "payload": {
    // 不同 type 有不同的 payload
  }
}
```

#### Payload 按类型

```typescript
// 搜索请求
type SearchPayload = {
  query: string
  numResults?: number
  type?: "general" | "news" | "academic" | "code" | "video"
}

// Shell 执行
type ShellPayload = {
  command: string
  cwd?: string
  timeout?: number
}

// 文件读取
type ReadPayload = {
  path: string
  offset?: number
  limit?: number
}

// 文件写入
type WritePayload = {
  path: string
  content: string
}

// 文件编辑
type EditPayload = {
  path: string
  oldString: string
  newString: string
}

// Git 操作
type GitPayload = {
  action: "status" | "diff" | "log" | "commit" | "push"
  args?: Record<string, string>
}
```

### 响应格式（s-code 返回）

```jsonc
// stdout 输出
{
  "id": "req-001",
  "status": "success",           // success | error
  "envelope": {                  // ← s-forge InboundMessage 兼容
    "channelId": "s-code-app",
    "channelType": "external-agent",
    "accountId": "s-code",
    "userId": "user-xxx",
    "conversationToken": "sess-xxx",
    "timestamp": 1780925000000
  },
  "result": {
    // 不同 type 不同 result
  },
  "memory": {                    // ← 可选，记忆事件块
    "events": [
      {
        "type": "search",
        "summary": "搜索了 Rust 2026",
        "tool": "search",
        "timestamp": 1780925000000
      }
    ]
  }
}
```

#### Result 按类型

```typescript
type SearchResult = {
  results: Array<{
    title: string
    url: string
    snippet: string
    engine: string
  }>
  engines: string[]
  total: number
  duration: number
}

type ShellResult = {
  stdout: string
  stderr: string
  exitCode: number
  duration: number
}

type ReadResult = {
  content: string
  lines: number
  truncated: boolean
}

type WriteResult = {
  path: string
  size: number
}

type EditResult = {
  path: string
  replaced: boolean
}
```

### 错误响应

```jsonc
{
  "id": "req-001",
  "status": "error",
  "envelope": { /* ... */ },
  "error": {
    "code": "TOOL_FAILED",      // TOOL_FAILED | TIMEOUT | PERMISSION_DENIED | INVALID_PARAMS
    "message": "命令执行超时",
    "details": {}
  }
}
```

## s-code 端 Channel Adapter（Go 侧）

当 s-forge 内嵌 s-code 二进制时，Go 侧的 SCodeWorker 实现 `ChannelAdapter` 接口：

```go
// scode/adapter.go
type SCodeAdapter struct {
    worker *SCodeWorker
}

func (a *SCodeAdapter) ID() string {
    return "s-code-app"
}

func (a *SCodeAdapter) Start(ctx context.Context) error {
    // 启动 s-code 子进程
    return a.worker.Start(ctx)
}

func (a *SCodeAdapter) Stop(ctx context.Context) error {
    return a.worker.Stop(ctx)
}

func (a *SCodeAdapter) SendMessage(ctx context.Context, msg *channel.OutboundMessage) error {
    // 将 s-forge 的 OutboundMessage 转为 s-code 请求
    req := &SCodeRequest{
        Envelope: msg,
        Payload:  parseMessagePayload(msg),
    }
    
    resp, err := a.worker.Call(req)
    if err != nil {
        return err
    }
    
    // 处理响应（提取记忆事件、更新状态等）
    a.handleResponse(resp)
    return nil
}

func (a *SCodeAdapter) Status() channel.ChannelStatus {
    return channel.ChannelStatus{
        ID:        "s-code-app",
        Connected: a.worker.IsAlive(),
    }
}

func (a *SCodeAdapter) TrustConfig() *channel.TrustConfig {
    return &channel.TrustConfig{
        DefaultTrust:     channel.TrustHigh,
        AllowMessageFrom: []string{"*"},
    }
}

func (a *SCodeAdapter) Capabilities() channel.ChannelCapability {
    return channel.CapReceive | channel.CapProactiveSend
}
```

## 兼容性矩阵

| 信封字段 | s-forge 定义 | s-code 实现 | 兼容 |
|---------|-------------|-------------|------|
| `channelId` | `string` | `s-code-app` | ✅ |
| `channelType` | `external-agent` | `external-agent` | ✅ |
| `accountId` | 发送方身份 | `magi` / `s-code` | ✅ |
| `userId` | 用户标识 | 透传 | ✅ |
| `text` | 消息内容 | 透传 | ✅ |
| `media` | `[]MediaAttachment` | 可选支持 | ✅ |
| `conversationToken` | 会话令牌 | 透传 | ✅ |
| `timestamp` | Unix 毫秒 | Unix 毫秒 | ✅ |
| `motivation` | 工具调用动机 | 忽略（仅用于治理） | ✅ |
| `nickname` | 发送方昵称 | s-code 不依赖 | ✅ |
| `identityId` | 身份标识 | 可选支持 | ✅ |

## 与 s-forge 治理系统的兼容

s-code 不需要实现治理逻辑，但需要在响应中提供足够信息供 s-forge 的 `action_tool_governance.go` 评估：

```jsonc
{
  "ok": true,
  "state": "sent",
  "executionSummary": {
    "tool": "search",
    "action": "web_search",
    "target": "Rust 2026",
    "reason": "用户询问 Rust 2026 特性",
    "outcome": "返回 8 条结果"
  }
}
```

s-forge 的治理系统会使用此信息判断操作是否合规，是否需要进行投票复核。

## 实现步骤

1. **定义消息类型** — s-code 端 TypeScript 类型化 `SCodeRequest` / `SCodeResponse`
2. **实现 stdin/stdout 协议** — s-code worker 模式读取 stdin，写入 stdout
3. **实现 Payload 路由** — 按 `type` 分发到 s-code 的工具系统
4. **实现 Envelope 透传** — 保持 `channelId`/`accountId`/`userId`/`conversationToken` 在请求-响应中一致
5. **实现记忆事件输出** — 进程退出前输出 `---MEMORY---` 块
6. **s-forge 端实现 SCodeAdapter** — 实现 `ChannelAdapter` 接口
