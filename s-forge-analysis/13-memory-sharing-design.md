# S-Forge 笔记库作为 S-Code 外部记忆

## 概述

s-forge 的笔记系统（SiYuan）是**情景记忆层**，s-code 的会话历史是**工作记忆**。两者需要打通：s-code 执行中的重要信息应回流到 s-forge 笔记库持久化，s-forge 的笔记库应在 s-code 任务中作为上下文提供。

## 记忆层次

```
┌────────────────────────────────────────────────┐
│      S-Forge 笔记库 (情景记忆/长期记忆)          │
│                                                  │
│  • 用户偏好和习惯                                │
│  • 项目上下文和历史                              │
│  • 重要决策和理由                                │
│  • 人格画像 (marduk)                            │
│  • 跨会话的知识积累                              │
└────────────────────┬───────────────────────────┘
                     │ 注入上下文
                     ▼
┌────────────────────────────────────────────────┐
│      S-Code 会话 (工作记忆)                     │
│                                                  │
│  • 当前会话的工具调用链                          │
│  • 文件修改记录                                  │
│  • 搜索结果                                      │
│  • git 操作                                      │
└────────────────────┬───────────────────────────┘
                     │ 回流关键信息
                     ▼
┌────────────────────────────────────────────────┐
│      S-Forge 笔记库 (更新)                      │
│                                                  │
│  • 记录 s-code 执行摘要                         │
│  • 更新用户偏好 (从交互中学习)                   │
│  • 写入日记 (write_diary_entry)                 │
└────────────────────────────────────────────────┘
```

## 架构前提

s-forge 内嵌 s-code 二进制。s-code 的子进程在退出前通过 stdout 的最后一块数据返回记忆同步事件。

## 记忆回流流程

```
s-code 子进程完成操作（搜索/Shell/文件编辑）
    │
    ├── 主要结果通过 stdout 即时返回
    │
    └── 进程退出前，追加记忆事件块:
         ...stdout 正常输出...
         ---MEMORY---
         {"events": [...], "summary": "..."}
         ---MEMORY_END---
    │
    ▼
s-forge SCodeWorker 解析 stdout
    │
    ├── 拆分为: 操作结果 + 记忆事件
    ├── 记忆事件 → write_diary (写入笔记日记)
    ├── 更新用户偏好档案 (LearnFromExecution)
    └── 关联到相关笔记区块
```

### s-code 端记忆导出 (进程退出前触发)

```typescript
// s-code: 在 worker 进程退出前触发记忆导出
process.on("beforeExit", async () => {
  const events = session.collectMemoryEvents()
  if (events.length === 0) return
  
  const summary = await summarizeEvents(events)
  
  // 通过 stdout 追加记忆块
  console.log("---MEMORY---")
  console.log(JSON.stringify({
    sessionId: session.id,
    events: events.map(e => ({
      type: e.type,
      summary: e.summary,
      files: e.files,
      tool: e.tool,
      timestamp: e.timestamp,
    })),
    summary,
  }))
  console.log("---MEMORY_END---")
})
```

### s-forge 端记忆接收

```go
// 在 SCodeWorker 解析 stdout 时提取记忆事件
func (w *SCodeWorker) parseResponse(stdout []byte) (*Response, []MemoryEvent, error) {
    parts := strings.Split(string(stdout), "---MEMORY---\n")
    if len(parts) < 2 {
        // 无记忆事件
        var resp Response
        json.Unmarshal([]byte(parts[0]), &resp)
        return &resp, nil, nil
    }
    
    // 第一部分: 操作结果
    var resp Response
    json.Unmarshal([]byte(parts[0]), &resp)
    
    // 第二部分: 记忆事件
    memoryPart := strings.TrimSuffix(parts[1], "---MEMORY_END---\n")
    var memData MemorySyncData
    json.Unmarshal([]byte(memoryPart), &memData)
    
    // 处理记忆事件
    for _, event := range memData.Events {
        switch event.Type {
        case "edit":
            w.forge.WriteDiary(fmt.Sprintf(
                "通过 s-code 修改了文件 %s\n变更摘要: %s",
                strings.Join(event.Files, ", "), event.Summary,
            ))
        case "search":
            w.forge.RecordSearchHistory(event.Summary)
        case "shell":
            w.forge.WriteDiary(fmt.Sprintf(
                "执行命令: %s", event.Summary,
            ))
        case "git":
            w.forge.WriteDiary(fmt.Sprintf(
                "Git 操作: %s", event.Summary,
            ))
        }
    }
    
    // 更新用户画像
    w.forge.LearnFromExecution(memData.Events)
    
    return &resp, memData.Events, nil
}
```

## 记忆注入流程

```
s-forge 开始新会话
    │
    ├── 加载用户人格档案 (marduk)
    ├── 搜索最近相关笔记
    ├── 提取与当前任务相关的记忆
    │
    ▼
将记忆注入到 Sage 系统提示
    │
    ▼
Sage 综合记忆 + 当前输入 → 决策
    │ 需要执行代码操作
    ▼
通过 Avatar → s-code 执行
```

### 相关记忆检索

```go
func (m *MemoryManager) RetrieveRelevant(ctx context.Context, task string, limit int) ([]MemoryItem, error) {
    // 1. 关键词搜索笔记
    keywordResults := m.searchNotes(task, limit)
    
    // 2. 提取最近相关日记 (7天内)
    diaryResults := m.searchDiary(task, 7)
    
    // 3. 合并去重
    return merge(keywordResults, diaryResults)
}
```

## 用户画像学习

s-forge 从 s-code 的执行历史中学习用户偏好：

```go
func (p *ProfileManager) LearnFromExecution(events []MemoryEvent) {
    for _, e := range events {
        switch {
        case strings.Contains(e.Summary, "prettier"):
            p.IncrementTrait("code_style", "prettier")
        case strings.Contains(e.Summary, "eslint"):
            p.IncrementTrait("code_style", "eslint")
        case strings.Contains(e.Summary, "TypeScript"):
            p.IncrementTrait("language_pref", "typescript")
        }
    }
}
```

积累的数据最终反映在人格档案中，影响后续的搜索偏好、工具选择等。

## 接口规范

### s-forge → s-code 记忆注入

```
注入到 s-code 的系统提示中:
<memory_context>
  用户偏好: TypeScript, React, Prettier
  上次任务: 重构了 auth 模块
  项目结构: /src/components, /src/utils, /src/hooks
  最近搜索: "Rust 2026 new features"
</memory_context>
```

### s-code → s-forge 记忆同步

```
POST /api/memory/sync
{
  "sessionId": "ses_xxx",
  "events": [
    {
      "type": "edit",
      "files": ["src/auth/login.ts"],
      "summary": "重构了登录逻辑",
      "timestamp": 1780923000000
    }
  ]
}
```

### 配置示例

```jsonc
// s-code 端的 s-forge 集成配置
{
  "forge": {
    "url": "http://localhost:6806",
    "memory": {
      "sync_events": true,
      "sync_interval_ms": 30000,
      "inject_memory": true
    }
  }
}
```
