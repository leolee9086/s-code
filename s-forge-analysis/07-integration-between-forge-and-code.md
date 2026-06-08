# S-Forge 与 S-Code 集成方案

基于对 s-forge 内核深度分析，提出 s-forge (大脑) 与 s-code (身体) 的集成方案。

**架构前提**: s-forge 内嵌 s-code 二进制。s-code 以子进程形式被 s-forge 调用。

## 调用模型

```
s-forge (Go)
    │
    │ Sage 决定需要执行代码操作
    │
    ├── 搜索操作 → s-code search-worker (搜索专用子进程)
    │              输入 stdin: { type: "search", query, num }
    │              输出 stdout: JSON 搜索结果
    │
    ├── Shell 操作 → s-code shell-worker (Shell 执行子进程)
    │                输入 stdin: { type: "shell", command, cwd }
    │                输出 stdout: JSON { stdout, stderr, exitCode }
    │
    ├── 文件操作 → s-code fs-worker (文件读写子进程)
    │              输入 stdin: { type: "read|write|edit", path, content }
    │              输出 stdout: JSON 结果
    │
    └── Git 操作 → s-code git-worker (Git 操作子进程)
                    输入 stdin: { type: "git", action, args }
                    输出 stdout: JSON 结果
```

无需 HTTP 服务或 WebSocket，所有通信通过 **stdin/stdout** 完成。

## 子进程协议

### 输入格式 (stdin)

```json
{
  "id": "req-001",
  "type": "search",
  "payload": {
    "query": "Rust 2026",
    "numResults": 5,
    "type": "general"
  },
  "context": {
    "cwd": "/path/to/project",
    "memory": "forge-note-id-xxx"
  }
}
```

### 输出格式 (stdout)

```json
{
  "id": "req-001",
  "status": "success",
  "result": {
    "output": "...",
    "duration": 1234
  }
}
```

或错误:

```json
{
  "id": "req-001",
  "status": "error",
  "error": {
    "code": "TOOL_FAILED",
    "message": "..."
  }
}
```

## 进程生命周期

```
第一次调用时启动 s-code worker
    │
    ▼
worker 进程等待 stdin 输入
    │
    ▼
收到请求 → 执行 → stdout 输出结果
    │
    ▼
等待下一个请求 (保持存活)
    │
    ▼
空闲超时 (30s) 或 s-forge 退出 → worker 退出
```

```go
type SCodeWorker struct {
    cmd     *exec.Cmd
    stdin   io.WriteCloser
    stdout  io.ReadCloser
    mu      sync.Mutex
    idleAt  time.Time
}

func (w *SCodeWorker) Call(req Request) (*Response, error) {
    w.mu.Lock()
    defer w.mu.Unlock()
    
    // 发送请求
    input, _ := json.Marshal(req)
    w.stdin.Write(input)
    w.stdin.Write([]byte("\n"))  // 换行分隔
    
    // 读取响应
    decoder := json.NewDecoder(w.stdout)
    var resp Response
    decoder.Decode(&resp)
    
    w.idleAt = time.Now()
    return &resp, nil
}
```

## 与 Channel 模型的兼容

s-forge 内部的 Channel 模型仍然保留，只是底层的"发送到 external-agent"变为本地子进程调用：

```
Sage → send_channel_message(channelId="s-code")
    → Coordinator 识别 channelId="s-code"
    → 不经过 HTTP，直接调用 SCodeWorker.Call()
    → 返回结果给 Sage
```

对 Sage 来说完全透明——它仍然认为自己在向外部发送消息。

## 集成流程

```
用户 → s-forge MAGI
    │
    ├── 1. MAGI 理解用户意图
    ├── 2. 加载人格档案 (marduk)
    ├── 3. 选举主导 Sage
    ├── 4. 主导 Sage 决定需要执行代码操作
    │
    ├── 5. Sage 调用 send_channel_message
    │      channelId = "s-code"
    │      content = { tool: "search"|"shell"|"read"|..., params }
    │
    ├── 6. Coordinator 识别 s-code channel
    │      调用 SCodeWorker.Call(req)
    │
    ├── 7. s-code 子进程执行
    │      ├── 搜索 → search/selector.ts + 161引擎
    │      ├── Shell → shell 工具 + tree-sitter 解析
    │      ├── 文件 → read/write/edit 工具
    │      └── Git → git 工具
    │
    ├── 8. 结果返回 SCodeWorker → Coordinator → Sage
    │
    └── 9. Sage 综合结果，写记忆笔记 → 用户
```

## Avatar ↔ s-code 工具映射

| s-forge 操作 | s-code 工具 | 说明 |
|-------------|------------|------|
| read_note | read | 读取 s-forge 笔记知识库 |
| search_notes | grep/glob | 在笔记库中搜索 |
| write_note | write | 写入记忆笔记 |
| (via Avatar) | shell | 执行代码操作 |
| (via Avatar) | 161 搜索 | 信息检索 |

## 记忆共享

s-forge 的笔记库可以充当 s-code 的**外部记忆层**：

```
s-code 会话中产生的关键信息
    │
    └──→ 通过 API 写入 s-forge 笔记
          (write_note / 持久化记忆)
    │
s-forge 在下一次交互中
可以从笔记库检索相关信息
    │
    └──→ search_notes → 注入 Sage 上下文
```

这实现了：
- **跨会话记忆**: s-code 的每次操作结果可以在下次 s-forge 对话中被引用
- **情景记忆**: s-forge 的笔记库记录了用户的完整工作和思考历史
- **人格一致**: 用户偏好和习惯通过 marduk 持久化
