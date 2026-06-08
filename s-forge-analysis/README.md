# S-Forge + S-Code 完整集成路线图

## 总体架构

```
┌───────────────────────────────────────────────────────────┐
│                      S-Forge (大脑)                        │
│                                                           │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌─────────────┐  │
│  │ MAGI    │  │ Marduk   │  │ Seraph │  │ Dummysys    │  │
│  │ 三贤人  │  │ 人格档案  │  │ ATF监控 │  │ 身份锚定    │  │
│  │ 主导选举 │  │ 认知立场  │  │ 评分   │  │ 织/丽/薰   │  │
│  └────┬────┘  └──────────┘  └────────┘  └─────────────┘  │
│       │                                                    │
│  ┌────┴────────────────────────────────────────────────┐  │
│  │          Channel 通信层                              │  │
│  │  send_channel_message → { external-agent: s-code }   │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────┬────────────────────────────────┘
                           │ 内嵌 s-code 二进制 (子进程 stdin/stdout)
                           ▼
┌───────────────────────────────────────────────────────────┐
│                      S-Code (身体)                         │
│                                                           │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌─────────────┐  │
│  │ Agent   │  │ 工具系统  │  │ 搜索   │  │ 外部记忆    │  │
│  │ 循环    │  │ read/write│  │161引擎 │  │ s-forge笔记 │  │
│  │ Effect  │  │ shell/git │  │元搜索  │  │ 同步/注入    │  │
│  └─────────┘  └──────────┘  └────────┘  └─────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## 能力分配

| 能力 | 归属 | 实现状态 |
|------|------|---------|
| 多 Agent 共识决策 | s-forge MAGI | ✅ 已有 |
| 人格测量 (IPIP-NEO-120) | s-forge Marduk | ✅ 已有 |
| 身份模板 (织/丽/薰) | s-forge Dummysys | ✅ 已有 |
| 质量监控 (ATF) | s-forge Seraph | ✅ 已有 |
| 代码文件操作 | s-code | ✅ 已有 |
| Shell 执行 | s-code | ✅ 已有 |
| Git 操作 | s-code | ✅ 已有 |
| 161 引擎搜索 | s-code | ✅ 已有 |
| Web 搜索 (s-forge调用) | s-code → s-forge | 📝 设计完成 |
| 记忆共享 | s-forge ↔ s-code | 📝 设计完成 |
| 定时任务 | s-forge Cron | 🔧 需扩展 |
| 浏览器自动化 | s-code + MCP | 📝 设计完成 |

## 实现阶段

### Phase 1: 子进程通信
- [ ] s-code 编译为独立二进制 (`--mode search` / `--mode shell` 等)
- [ ] s-forge 实现 SCodeWorker (子进程管理 + stdin/stdout 协议)
- [ ] s-forge 内嵌 s-code 二进制 (打包到分发中)

### Phase 2: 搜索共享
- [ ] s-code 搜索 worker 模式 (搜索专用子进程入口)
- [ ] s-forge search_web 工具 → 调用 s-code 子进程
- [ ] 查询意图检测 (Go 正则)
- [ ] 缓存层 (LRU + SQLite)

### Phase 3: 记忆共享
- [ ] s-code 进程退出前记忆事件导出 (stdout MEMORY 块)
- [ ] s-forge 解析记忆事件 → write_diary + 用户画像学习
- [ ] s-forge 记忆注入 (→ s-code 上下文)
- [ ] 用户画像自动学习

### Phase 4: 深度集成
- [ ] s-forge SCodeWorker 池 (多 worker 管理)
- [ ] 共享 npm 包提取 (搜索适配器)
- [ ] s-forge 人格影响 s-code 行为

## 关键设计文档索引

| 文档 | 说明 |
|------|------|
| `00-architecture-overview.md` | s-forge 整体架构总览 |
| `01-magi-multi-agent-system.md` | MAGI 三贤人 + 主导者选举 |
| `05-forge-vs-code-division.md` | 分工边界总表 |
| `07-integration-between-forge-and-code.md` | 集成通信协议 |
| `08-web-search-design.md` | s-forge 搜索能力方案 |
| `12-shared-search-engine-design.md` | 搜索代码共享 (推荐方案) |
| `13-memory-sharing-design.md` | 记忆共享设计 |

## 文件汇总

14 份文档，总计 ~61KB，覆盖 s-forge 全部分析与 s-forge/s-code 集成设计。
