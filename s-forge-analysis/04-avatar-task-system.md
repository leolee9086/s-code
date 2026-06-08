# Avatar 动态任务执行系统

## 概述

Avatar 是 s-forge 中的动态 Agent 实例，由 MAGI 系统创建用于执行特定任务。命名来源于 EVA 中的虚拟插入栓（Dummy Plug）。

## Avatar 生命周期

```
创建 (MAGI 调用 create_avatar 工具)
  │
  ▼
初始化 (分配 Channel、身份、LLM 客户端)
  │
  ▼
运行 (独立上下文、独立循环)
  │
  ▼
报告 (任务完成时回调)
  │
  ▼
销毁 (资源清理)
```

## Avatar 类型

### 按 Channel 分类

| Channel | 用途 | 特点 |
|---------|------|------|
| `guardian` | 守护型 | 长期运行，持续监控 |
| `external-agent` | 外部 Agent | 与 s-code 等外部系统交互 |
| `system-cron` | 定时任务 | 周期性执行 |
| `unknown` | 通用 | 临时任务 |

### 按身份模型分类

| 模型 | 适用场景 |
|------|---------|
| 织 (ZHI-01) | 需要亲和力、社交性的任务 |
| 丽 (REI-01) | 需要理性分析、系统化思维的任务 |
| 薰 (KAORU-02) | 需要整体性思考、深度理解的任务 |

## Avatar 配置

```go
type AvatarConfig struct {
    AvatarRoleID            string          // 角色 ID
    AvatarNumber            int             // 编号
    Channel                 AvatarChannel   // 通道
    SystemPrompt            string          // 系统提示词
    ExposureMode            ExposureMode    // 记忆暴露模式
    HeartbeatIntervalRounds int             // 心跳间隔
    ReportCallback          ReportCallback   // 报告回调
    Identity                AvatarIdentity  // 身份
    NoteID                  string          // 关联笔记块 ID
}
```

## 关键特性

### 1. 隔离上下文

每个 Avatar 拥有独立的上下文，互不干扰。这避免了：
- 任务间信息泄漏
- 上下文窗口污染
- 会话历史混杂

### 2. 记忆暴露控制

通过 `ExposureMode` 控制 Avatar 可以访问的记忆范围：
- **full**: 完全访问（信任的 Avatar）
- **partial**: 部分访问（一般任务）
- **distorted**: 扭曲访问（低信任任务）

### 3. 报告回调

Avatar 在完成任务后通过 `ReportCallback` 向创建者（MAGI）报告结果。报告包含：
- 任务执行摘要
- 关键发现
- 输出文件/数据
- 统计信息

### 4. 心跳机制

Avatar 定期发送心跳信号，允许 MAGI 监控其存活状态。超时未收到心跳的 Avatar 会被自动销毁。

## Avatar 与 s-code 的交互

```
s-forge (Avatar)
    │
    │  通过 API 调用
    ▼
s-code (工具执行)
    │
    │  Shell/文件/Git 操作
    ▼
实际代码库
```

交互流程：

1. MAGI 分析用户需求，拆解为子任务
2. 创建 Avatar，指定任务描述和约束
3. Avatar 通过 API 调用 s-code 执行代码操作
4. s-code 执行实际的文件读写、Shell 命令、Git 操作
5. 执行结果返回 Avatar
6. Avatar 汇总结果，回调 MAGI
7. MAGI 综合所有信息，通过 Trinity 输出

## 与 s-code spawn 的对比

| 特性 | s-forge Avatar | s-code spawn |
|------|---------------|-------------|
| 创建方式 | MAGI 工具调用 | task tool |
| 上下文 | 独立完整上下文 | 继承父 session |
| 身份 | 可选身份模型 (织/丽/薰) | 固定角色 |
| 通信 | 通过 Bus/Channel | 通过 session 消息 |
| 报告 | ReportCallback | 工具返回 |
| 生命周期 | 创建→运行→报告→销毁 | 任务完成即结束 |
| 心跳 | ✅ 有心跳监控 | ❌ 无 |
| 记忆暴露 | ✅ 三级控制 | ❌ 无 |
