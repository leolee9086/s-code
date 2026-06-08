# 外部 MCP 工具集成指南

> 如何通过 MCP (Model Context Protocol) 将外部 AI 工具能力集成到 s-code 中。

本文档基于对 10 个 AI 代理项目的分析，提供具体的 MCP 集成方案。

---

## MCP 配置总览

S-Code 的 MCP 配置位于 `opencode.jsonc` 的 `mcp` 字段，支持两种类型：

| 类型 | 传输协议 | 适用场景 |
|------|---------|---------|
| `local` | STDIO | 本地运行的工具（CodeGraph、Headroom） |
| `remote` | HTTP/SSE | 远程服务（browser-use Cloud、自建服务） |

---

## 集成方案

### 1️⃣ CodeGraph — 代码知识图谱

**用途**: 预索引 AST 知识图谱，替代反复的 grep/glob/read，减少 47% token 消耗。

**安装**:
```bash
# 全局安装 CodeGraph CLI
npm install -g @colbymchenry/codegraph

# 在项目中初始化索引
cd /path/to/your/project
codegraph init
codegraph index
```

**`opencode.jsonc` 配置**:
```jsonc
{
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["npx", "@colbymchenry/codegraph", "serve", "--mcp"],
      "timeout": 60000
    }
  }
}
```

**可用工具**: `codegraph_explore`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_files`, `codegraph_status`

**场景示例**: 修复 bug 前运行 `codegraph_impact` 查看影响范围，运行 `codegraph_explore` 理解模块结构。

---

### 2️⃣ Headroom — AI 上下文压缩

**用途**: 在 LLM 调用前压缩上下文，减少 60-95% token 消耗。CCR 可逆压缩保证信息不丢失。

**安装**:
```bash
pip install headroom-ai
```

**方案 A：MCP Server**（按需压缩）
```jsonc
{
  "mcp": {
    "headroom": {
      "type": "local",
      "command": ["headroom", "mcp", "serve"],
      "timeout": 30000
    }
  }
}
```

**方案 B：透明代理**（零代码改动）
```bash
# 启动代理，s-code 的 LLM 调用经过代理自动压缩
headroom proxy --port 8787
# 然后在 s-code 中将 provider base URL 指向代理
```

**可用工具**: `headroom_compress`, `headroom_retrieve`, `headroom_stats`

---

### 3️⃣ Browser-Use — 浏览器自动化

**用途**: AI 代理自动操作浏览器（登录、填写表单、抓取数据、端到端测试）。

**安装**:
```bash
pip install browser-use
playwright install chromium
```

**`opencode.jsonc` 配置**:
```jsonc
{
  "mcp": {
    "browser-use": {
      "type": "local",
      "command": ["python", "-m", "browser_use.mcp"],
      "timeout": 120000
    }
  }
}
```

**可用能力**: 导航、点击、输入、截图、JS 执行、DOM 查询

**场景示例**: "帮我登录 GitHub 创建 PR" → `browser_navigate` → `browser_click` → `browser_type`

---

### 4️⃣ Goose — ACP 子代理

**用途**: 将 Goose 作为 s-code 的子代理，利用其 15+ provider 和 Recipe 自动化能力。

**`opencode.jsonc` 配置** (通过 MCP)：
```jsonc
{
  "mcp": {
    "goose": {
      "type": "local",
      "command": ["goose", "mcp", "start"],
      "timeout": 300000
    }
  }
}
```

**或通过 ACP 集成**（更深度）：
Goose 支持 Agent Client Protocol，s-code 可以通过 ACP 将任务委托给 Goose。

---

### 5️⃣ Screenpipe — 个人工作记忆

**用途**: 查询开发者的屏幕历史——"我上周看到的那个函数在哪？"

**安装**:
```bash
# 安装 screenpipe 桌面应用
npx screenpipe
```

**`opencode.jsonc` 配置**:
```jsonc
{
  "mcp": {
    "screenpipe": {
      "type": "local",
      "command": ["npx", "-y", "screenpipe-mcp"],
      "timeout": 30000
    }
  }
}
```

**场景示例**: Agent 在回答前先查询屏幕历史获取上下文 → 减少重复提问。

---

### 6️⃣ 多工具组合配置

```jsonc
{
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["npx", "@colbymchenry/codegraph", "serve", "--mcp"],
      "timeout": 60000
    },
    "headroom": {
      "type": "local",
      "command": ["headroom", "mcp", "serve"],
      "timeout": 30000
    },
    "browser-use": {
      "type": "local",
      "command": ["python", "-m", "browser_use.mcp"],
      "timeout": 120000
    },
    "screenpipe": {
      "type": "local",
      "command": ["npx", "-y", "screenpipe-mcp"],
      "timeout": 30000
    }
  }
}
```

---

## 集成后能力矩阵

```
集成前 (s-code 原生)        集成后 (s-code + MCP)
┌────────────────────┐     ┌────────────────────────────┐
│ 搜索 (161引擎)      │     │ ✅ 搜索 + CodeGraph 知识图谱  │
│ Shell 执行          │     │ ✅ + browser-use 浏览器      │
│ 文件读写编辑        │     │ ✅ + Headroom 上下文压缩      │
│ Git 操作            │     │ ✅ + Screenpipe 工作记忆      │
│ MCP 客户端          │     │ ✅ (本身已是)                  │
│ 进化模式            │     │ ✅ (唯一)                      │
└────────────────────┘     └────────────────────────────┘
```

**关键指标预估**（基于各项目自述基准测试）：
| 指标 | 优化幅度 | 实现方式 |
|------|---------|---------|
| Token 消耗 | **减少 47-95%** | CodeGraph 知识图谱 + Headroom 压缩 |
| 工具调用 | **减少 58%** | CodeGraph 知识图谱代替 grep/glob |
| 任务时间 | **减少 22%** | 知识图谱 + 浏览器自动化 |
| 成本 | **降低 16-60%** | Token 节省直接降低 API 费用 |

---

## 集成测试清单

- [ ] CodeGraph MCP 工具注册成功 (`codegraph_status`)
- [ ] Headroom 压缩效果验证 (对比前后 token 数)
- [ ] Browser-use 浏览器启动和导航 (CDP 端口可用)
- [ ] Screenpipe 本地搜索 (查询最近记录)
- [ ] 多工具同时加载无冲突 (MCP 状态正常)

---

*本指南基于 2026-06-08 的分析结果*
