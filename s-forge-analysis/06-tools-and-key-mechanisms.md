# S-Forge 深度分析 — 工具集与关键机制

## 工具集 (Toolset)

s-forge 的工具按功能分组，由 `ToolMeta` 控制可用性：

### 渠道工具 (`toolset_channel.go`)
| 工具 | 功能 | 元特性 |
|------|------|--------|
| `send_channel_message` | 发送消息到外部 Channel | 发送外部消息、需要同级投票 |
| `send_prepared_message` | 发送预设消息 | 发送外部消息 |
| `wanna_speak_*` | 三贤人流式输出 (start/continue/stop) | 流式通信 |

### Forge 工具 (`toolset_forge.go`)
| 工具 | 功能 |
|------|------|
| `create_avatar` | 创建动态 Avatar |
| `list_avatar` | 列出活跃 Avatar |
| `modify_avatar` | 修改 Avatar 配置 |
| `destroy_avatar` | 销毁 Avatar |

### 笔记工具 (`toolset_note.go`)
| 工具 | 功能 |
|------|------|
| `search_notes` | 搜索笔记库 |
| `read_note` | 读取笔记内容 |
| `write_note` | 写入笔记 |
| `modify_note` | 修改笔记 |

### Speak 工具 (`toolset_speak.go`)
| 工具 | 功能 |
|------|------|
| `speak` | Sage 输出最终响应 (旧版 Trinity 用，现在各 Sage 可用) |

## 关键机制

### 1. 工具元数据系统

每个工具通过 `ToolMeta` 声明其能力和约束：

```go
type ToolMeta struct {
    // 副作用声明（原子化布尔字段）
    ReadsNotes      bool  // 读取笔记
    ReadsFilesystem bool  // 读取文件系统
    ReadsWebContent bool  // 读取网络内容
    ModifiesNotes   bool  // 修改笔记
    ExecutesCommand bool  // 执行系统命令
    
    // 执行策略
    RequiresPeerVote bool  // 需要同级投票
    
    // 可用场景
    AvailableDirectReply bool  // 正常回复时可用
    AvailableSleepHB     bool  // 睡眠心跳时可用
    AvailableWorkHB      bool  // 工作心跳时可用
    
    // 平台
    Mode      ToolMode      // core/forge
    Platforms ToolPlatform  // 桌面/Docker/Android/iOS
}
```

### 2. Motivation 参数

所有行动工具统一添加 `motivation` 参数（`AddMotivationParam`），强制 Sage 说明执行理由，用于行动工具复核。

### 3. 心跳系统

s-forge 有独特的心跳机制：
- **睡眠心跳**: Sage 空闲时的低速思考
- **工作心跳**: Sage 活跃时的高速状态更新
- **心跳记录**: `wanna_sleep_record` 记录当前状态
- **心跳计划**: `wanna_sleep_plan` 制定下一步计划

## Donation 提醒机制

s-forge 包含一个独特的 `Donation Tool` 提醒策略：
- 如果超过一定轮次未调用捐助相关工具
- Coordinator 会自动插入提醒提示
- 是一种"软性引导"设计模式

## 与 s-code 工具系统的对比

| 维度 | s-forge | s-code |
|------|---------|--------|
| 工具元数据 | ToolMeta (副作用声明) | Permission (权限声明) |
| 执行治理 | Motivation 参数 + 投票 | Permission allow/ask/deny |
| 上下文管理 | ContextStrategy (token%/消息数/轮数) | 会话压缩 (head_tail) |
| 平台适配 | ToolPlatform (bitmask) | 条件编译 |
| 工具分组 | Toolset (channel/forge/note/speak) | 按文件组织 |
| 心跳 | 睡眠/工作双模式 | 无 |
| 记忆暴露 | ExposureMode (full/partial/distorted) | 无 |
