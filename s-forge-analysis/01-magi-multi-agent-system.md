# MAGI 多智能体系统

## 概述

MAGI 是 s-forge 的核心 AI 决策系统，灵感来自 EVA 中的三贤人超级计算机。它包含 **3 个固定 Sage**（Melchior/Balthazar/Casper）以及 **动态创建的 Avatar**。原 Trinity 已被移除，改为通过 **主导者选举 (Dominant Election)** 机制决定由哪个 Sage 主导响应。

## Sage 角色

| Sage | 认知立场 | 性格 | 核心工具 |
|------|---------|------|---------|
| **Melchior** | 理性分析 (Rational-Analytic) | 冷静、逻辑、分析 | 代码分析、逻辑推理、`requires_deliberation` |
| **Balthazar** | 共情直觉 (Empathic-Intuitive) | 温暖、共情、人性化 | 情感分析、意图理解、投票 |
| **Casper** | 务实行动 (Pragmatic-Action) | 果断、实用、行动导向 | 快速响应、行动规划、投票 |

## 核心架构

```
用户输入 → Gateway → Coordinator
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
        Melchior      Balthazar       Casper
        (理性分析)     (共情直觉)      (务实行动)
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                   主导者选举 (Dominant Election)
                    ├─ 根据认知立场匹配当前任务
                    ├─ 各 Sage 投票评分
                    └─ 得分最高者当选主导者
                           │
                           ▼
                    主导 Sage 直接响应
                           │
                    (其他 Sage 通过 peer_review
                     提供补充意见或质疑)
```

## 决策流程

### 主导者选举
```
用户输入 → Coordinator 分析任务情境
    ↓
三贤人并行评估：谁最适合处理当前任务？
    ↓
各贤人投票评分 (基于认知立场匹配度)
    ↓
得分最高者 → 主导 Sage (Dominant)
    ↓
主导 Sage 直接与用户交互
```

### 主导者主导模式
```
主导 Sage 处理用户请求
    │
    ├── 可以调用 tools 完成任务
    ├── 可以调用 peer_review 获取其他 Sage 意见
    └── 可以调用 requires_deliberation 触发投票
    │
    ▼
直接输出最终响应 (不需要 Trinity 综合)
```

### 投票机制（审慎决策）
```
Sage 调用 requires_deliberation
    ↓
其他 Sage 对提案投票 (approve/reject)
    ↓
多数通过 → 执行
未通过 → 重新规划
```

## 核心设计原则

### 1. Sage 无架构感知

每个 Sage **不知道** MAGI 架构的存在，只知道自己是独立 AI 助手。

### 2. 主导者不固定

每次交互都可能选举不同的主导 Sage，取决于任务性质：
- 代码问题 → Melchior 主导
- 用户情绪问题 → Balthazar 主导  
- 紧急响应 → Casper 主导

### 3. Peer Review 机制

非主导 Sage 可以通过 `peer_review` 工具对主导者的决策提出**质疑和补充**，在 `injectPeerDoubts` 中注入到主导者的上下文中。

## 消息总线 (Bus)

Agent 之间**不直接调用**，全部通过 Coordinator 协调：

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| Inbound | 外部 → Coordinator | 用户输入、Cron 触发、系统事件 |
| Outbound | Coordinator → 外部 | Sage 响应、工具调用结果 |
| Status | → WebSocket | Sage 状态推送 (thinking/tool_call/response) |

## 通信协议

| 接口 | 协议 | 用途 |
|------|------|------|
| `POST /api/magi/chat` | OpenAI Chat Completion | 兼容 OpenAI SDK |
| `POST /api/magi/messages` | Claude Messages API | 兼容 Claude SDK |
| `WS /api/magi/ws` | WebSocket | 仅推送状态，不接收输入 |

## Avatar 系统

MAGI 可以动态创建 Avatar 来执行子任务。详见 `04-avatar-task-system.md`。

## 与 s-code 的对应关系

| MAGI 概念 | s-code 对应 |
|-----------|------------|
| Melchior | build agent (开发模式) |
| Balthazar | 无直接对应 (s-code 缺感性层) |
| Casper | explore agent (快速搜索) |
| 主导者选举 | Agent 模式切换 (build/plan/explore) |
| Avatar | task/spawn 子代理 |
| Coordinator | Agent 循环编排 |
| Gateway | CLI/TUI 入口 |
