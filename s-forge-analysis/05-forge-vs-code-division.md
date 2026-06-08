# S-Forge 与 S-Code 分工边界

## 核心理念

```
s-forge (大脑)          s-code (身体)
─────────────────────────────────────
人格/身份              执行/动作
情景记忆               肌肉记忆
信息收集/分析           代码操作
元决策                  原子操作
```

## 分工明细

| 能力 | 归属 | 理由 |
|------|------|------|
| **环境信息收集** | s-forge | SiYuan 笔记库作为长期记忆；感知用户上下文 |
| **任务理解与拆解** | s-forge | MAGI 多智能体共识决策 |
| **人格/身份管理** | s-forge | dummysys + marduk 人格系统 |
| **代码文件读写** | s-code | `read`/`write`/`edit` 工具 |
| **Shell 执行** | s-code | `shell` 工具，tree-sitter 解析 |
| **搜索 (161 引擎)** | s-code | 元搜索引擎 |
| **Git 操作** | s-code | `git`/`revert`/`review` |
| **对话管理** | s-code | Session 系统 |
| **用户偏好记忆** | s-forge | 人格档案 + 认知立场 |
| **质量监控/评估** | s-forge | Seraph ATF 监控 |
| **MCP 工具集成** | s-code | MCP 客户端 |

## 数据流

```
s-forge MAGI 获取用户请求
    │
    ├── 分析请求类型
    ├── 选举主导 Sage
    ├── 加载用户人格/偏好档案 (marduk)
    └── 调用身份锚定 (dummysys)
    │
    ▼
需要执行代码操作？
    │
    ├── 是 → 通过 Avatar 调用 s-code API
    │         s-code 执行: shell/文件/git/搜索
    │         返回结果 → Avatar → MAGI
    │
    └── 否 → 直接回答 (基于知识库)
    │
    ▼
MAGI 综合结果 → 输出
```

## 接口设计

s-forge 与 s-code 通过 **HTTP API** 通信：

```
s-forge (Avatar) ──POST /api/s-code/execute──→ s-code
                    ←── JSON response ───────
```

Avatar 通过调用 `send_channel_message` 工具将任务发送到 s-code 的 channel。

## 双方优势互补

| s-forge 擅长的 | s-code 擅长的 |
|---------------|--------------|
| 理解用户人格和偏好 | 精确的代码编辑 |
| 长期情景记忆 | 大范围搜索 |
| 多角度分析决策 | 强大的工具链 |
| 知识管理 | Shell 安全解析 |
| 质量监控 | Git 操作 |
