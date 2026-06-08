# 人格与身份系统

## 概述

s-forge 的人格系统由 `marduk`（人格档案）和 `dummysys`（身份锚定）两个子系统组成，负责管理 Agent 的**人格特征**和**身份模板**。

## Marduk：人格档案系统

命名来源：EVA 中的 MARDUK 机关（负责选拔 EVA 驾驶员）

### IPIP-NEO-120 人格模型

基于 **大五人格理论** 的专业心理测量：

| 维度 | 代码 | 说明 | 子维度数 |
|------|------|------|---------|
| 神经质 | N | 情绪稳定性 | 6 |
| 外向性 | E | 社交倾向 | 6 |
| 开放性 | O | 对新事物的接受度 | 6 |
| 宜人性 | A | 合作倾向 | 6 |
| 尽责性 | C | 自律和责任感 | 6 |

共 **30 个子维度**，通过 120 道题目测量。

### 数据流

```
用户回答 IPIP-NEO-120 问卷 (120 题)
    ↓
提交原始答案 (IpipNeo120SubmissionPayload)
    ├── 被试元信息 (ID/Name/Gender/Age/Type)
    ├── 答案数组 (120 条 Q+Score)
    └── 人格种子描述 (四轨)
    ↓
Seraph 计分
    ↓
人格基底 (PersonaBase): 5维度分数 + 30子维度分数
```

### 认知立场 (Cognitive Stances)

除了人格特质，marduk 还管理 Agent 的**认知立场**：

```go
type SubjectCognitiveStances struct {
    // Agent 如何认知自己
    SelfDescription    string
    // Agent 如何认知用户
    UserDescription    string
    // Agent 如何看待任务
    TaskOrientation    string
    // Agent 的价值观框架
    ValueFramework     string
}
```

### 人格种子预设

| 预设 | 说明 |
|------|------|
| Jarvis | 专业助手型 |
| Kaoru | 优雅温和型 (薰) |
| Rei | 冷静理性型 (丽) |
| Shikinami | 战斗型 (式波) |

## Dummysys：身份锚定系统

命名来源：EVA 的 Dummy Plug（模拟插入栓）

### Avatar 身份模型

三个预定义的 Avatar 身份模板：

| ID | 名称 | 原型 | 性格标签 |
|----|------|------|---------|
| ZHI-01 | 织 | 妹妹 | 外向活泼、以家人为中心、敏锐商业直觉 |
| REI-01 | 丽 | 人造人 | 冷静理性、系统化思维、高警觉性 |
| KAORU-02 | 薰 | 使徒 | 优雅温和、整体性思维、深度理解 |

### 身份提示词构建

```go
func (id AvatarIdentity) BuildIdentityPrompt() string {
    // 返回结构化身份锚定文本
    // 包含: 名字、原型、性格描述、行为准则
}
```

### Avatar 运行态

```go
type AvatarDescriptor struct {
    config     AvatarConfig   // 配置
    state      AvatarState    // idle / active / destroyed
    llmClient  llm.Client     // LLM 客户端
    context    []ContextMessage // 对话上下文
    reports    []ReportEvent    // 报告事件
    createdAt  time.Time
    lastActiveAt time.Time
}
```

### 记忆暴露模式

| 模式 | 说明 | 用途 |
|------|------|------|
| full | 完全记忆访问 | 信任的 Avatar |
| partial | 部分记忆访问 | 一般任务 |
| distorted | 扭曲记忆访问 | 低信任度任务 |

## 与 s-code 的对应

| s-forge 人格系统 | s-code 对应 |
|-----------------|-------------|
| dummysys 身份模板 | Agent 定义 (build/plan/explore) |
| marduk 人格测量 | Agent 权限配置 (permission) |
| 记忆暴露模式 | 工具权限粒度 |
| 认知立场 | 系统提示 (system prompt) |
| 人格种子 | 预设 prompt 模板 |
