# S-Code 相对于 OpenCode 的变更说明

> 基于 commit `f52c68457c5486f549bc5ebf709756e0331e934c`（OpenCode 原始上游）到当前 HEAD 的所有变更统计：  
> **379 个文件变更，+37,572 / -1,614 行**

---

## 目录

1. [进化模式（Evolve Mode）](#1-进化模式evolve-mode)
2. [永续模式（Forever Mode）](#2-永续模式forever-mode)
3. [搜索系统重构](#3-搜索系统重构)
4. [HTTP API 扩展](#4-http-api-扩展)
5. [会话注入与内容过滤](#5-会话注入与内容过滤)
6. [会话压缩增强](#6-会话压缩增强)
7. [中文本地化](#7-中文本地化)
8. [插件系统增强](#8-插件系统增强)
9. [构建系统改进](#9-构建系统改进)
10. [配置变更](#10-配置变更)
11. [测试覆盖](#11-测试覆盖)

---

## 1. 进化模式（Evolve Mode）

**核心思路**：让 AI 可以修改自身代码 → 构建新二进制 → 替换当前进程 → 继续下一轮迭代，形成一个自我进化的闭环。

需要拉取git仓库源码。

### 新增模块

- **`packages/opencode/src/evolve/file-protocol.ts`** — 基于文件系统的 IPC 协议。通过 `.evolve-msg.txt` 文件在构建迭代间传递续接消息。提供 `isEvolveMode()` / `evolveScope()` / `isInEvolveScope()` 安全作用域控制。

- **`.opencode/tool/evolve.ts`** — 进化工具插件，执行完整周期：类型检查 → 构建（`bun run build --single --skip-install --skip-embed-web-ui`）→ 写入续接消息 → 启动新二进制 → 自杀。交替使用 `dist-tick`/`dist-toc` 输出目录以避免 Windows 文件锁冲突。

- **`packages/opencode/src/prefix-command/index.ts`** — 前缀命令服务，支持中英文前缀匹配：`进化:`、`exit-evolve`、`exit-forever` 等。

- **`packages/opencode/src/config/prefix.ts`** — 前缀命令配置模式。

### 核心文件变更

| 文件 | 变更 |
|------|------|
| `packages/opencode/src/cli/cmd/tui/thread.ts` | 增加进化/永续模式循环支持 |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | 增加会话注入处理 |
| `packages/opencode/src/session/tools.ts` | 注册新工具（spawn, relayMessage, forever-sleep） |
| `packages/opencode/src/tool/registry.ts` | 工具注册扩展 |
| `packages/opencode/src/session/system.ts` | 系统提示中增加永续模式说明 |

---

## 2. 永续模式（Forever Mode）

**核心思路**：AI 作为永续运行的守护进程，持续监听外部条件（文件变化、定时器）并自主决策下一步操作。

### 新增模块

- **`packages/opencode/src/forever/forever.ts`** — 核心模块，包含 `ForeverConfigShape` 类型、`isForeverMode()`/`setForeverMode()` 环境标志管理、`checkBudget()` 预算检查（最大轮次/成本/时长/休眠限制）。

- **`packages/opencode/src/forever/condition.ts`** — 条件引擎：
  - `FileWatchDriver` — 每 2 秒轮询文件系统变化
  - `TimerDriver` — 基于间隔的定时器
  - 支持 `any`/`all`/`sequence` 三种策略组合
  - 指数退避 + 随机抖动重试

- **`packages/opencode/src/forever/relay.ts`** — 父子进程中继引擎：
  - 子 session 路由表管理
  - HTTP 消息注入（通过 `Injection.Service`）
  - 90 秒心跳超时检测 + 自动清理

- **`packages/opencode/src/forever/prompt.ts`** — 动态提示解析器，支持 `inline`/`file`/`http` 三种提示来源。

- **`packages/opencode/src/forever/state.ts`** — 基于 JSON 文件的状态持久化，追踪预算（轮次、成本、时间戳）。

- **`packages/opencode/src/config/forever.ts`** — 永续模式配置模式（条件、提示源、预算限制）。

### 配套 CLI 和中继

| 新文件 | 说明 |
|--------|------|
| `packages/opencode/src/cli/cmd/spawn.ts` | `--spawn` 子进程入口，注册到父进程中继后进入永续循环 |
| `packages/opencode/src/server/routes/relay/index.ts` | 中继 HTTP 端点（register/unregister/inject/heartbeat/shutdown/interrupt） |
| `packages/opencode/src/tool/spawn.ts` | `spawn` 工具（创建子 agent 会话） |
| `packages/opencode/src/tool/relay-message.ts` | `relayMessage` 工具（跨进程消息转发） |
| `packages/opencode/src/tool/forever-sleep.ts` | 空桩工具（安全性审查后的保留接口） |
| `packages/opencode/src/forever/examples/forever-counter-plugin.ts` | 示例插件 |

---

## 3. 搜索系统重构

**核心思路**：完全重写 WebSearch 系统，从单一搜索接口升级为多引擎元搜索引擎（受 SearXNG 启发），支持 161+ 搜索引擎适配器。

### 新增目录 `packages/opencode/src/search/`

| 文件 | 说明 |
|------|------|
| `engine.ts` | 核心类型系统（SearchResult、EngineConfig、SearchEngine 接口、错误类型、健康状态追踪） |
| `aggregator.ts` | 结果聚合器（URL 去重、标题 Levenshtein 相似度合并、加权多引擎评分、域名多样性保证、情感检测） |
| `executor.ts` | 并发执行器（最大并发 10、熔断器模式、指数退避 1min/5min/15min + 抖动） |
| `selector.ts` | 引擎选择器（~150+ 引擎注册，基于 queryType/timeRange/lang/引擎特定 flag 选择） |
| `cache.ts` | LRU 内存缓存（默认 100 条，60 秒 TTL，命中/未命中统计） |
| `persistent-cache.ts` | SQLite 持久缓存（Bun:sqlite，两级缓存架构：内存 → SQLite → 引擎） |
| `query-intent.ts` | 查询意图检测（正则模式识别代码/学术/购物/视频/新闻/天气/翻译/货币类别，含中文模式） |
| `price-compare.ts` | 购物比价模块（价格提取、多平台统计、结构化比价报告格式） |
| `proxy.ts` | 系统代理检测（环境变量 + 常见代理端口探测 7890/1080/1081/8080） |
| `index.ts` | 模块导出 |
| `engines/` | **161 个引擎适配器文件** |

### 搜索引擎适配器分类

| 类别 | 引擎数 | 示例 |
|------|--------|------|
| 通用搜索 | 12 | DuckDuckGo、Bing、Google、Brave、Yandex、Naver、Startpage、Qwant、Yahoo、Mojeek、Seznam、Yep |
| 中文搜索 | 4 | 百度、搜狗、360 搜索、夸克 |
| 视频 | 12 | YouTube、Bilibili、AcFun、爱奇艺、Niconico、Dailymotion、Vimeo、PeerTube 等 |
| 新闻 | 6 | Bing News、Google News、Reuters、Yahoo News、Tagesschau、ANSA |
| 学术 | 11 | Arxiv、Semantic Scholar、Google Scholar、Wikipedia、Crossref、OpenAlex 等 |
| 代码/技术 | 11 | GitHub、GitLab、HuggingFace、PyPI、npm、Crates.io、Docker Hub 等 |
| 电商比价 | 13 | 京东、淘宝、拼多多、苏宁、国美、什么值得买、Amazon、eBay 等 |
| 社交 | 7 | Reddit、Twitter/X、Mastodon、微博、豆瓣、知乎、小红书 |
| 音乐/音频 | 5 | SoundCloud、Spotify、Deezer、Mixcloud、Freesound |
| 图片 | 14 | Google Images、Bing Images、Pinterest、Flickr、Pixiv、Wallhaven 等 |
| 其他 | 20+ | IMDb、Steam、天气、货币转换、词典、图标搜索等 |
| 站点限定搜索 | 23 | 微博/贴吧/知乎专栏/CSDN/掘金/V2EX 等通过 site: 语法实现的搜索 |

### `packages/opencode/src/tool/websearch.ts` 增强

- 从单一 fetch 升级为完整的元搜索架构
- 新增参数：`numResults`、`livecrawl`（实时爬取模式）、`type`（搜索类型）、`contextMaxCharacters`、`timeRange`、`lang`、`queryType`（通用/新闻/视频/学术/代码/购物）、`platforms`（购物指定平台）
- **自动调用智能化**：系统级 websearch 调用改为使用搜索工具，`packages/opencode/src/tool/websearch.txt` 描述也相应更新

---

## 4. HTTP API 扩展

### 新增注入 API（`handlers/injection.ts`）
- `POST /api/injection/prefix/:sessionID` — 设置前缀消息（在下一次 LLM 调用前注入）
- `POST /api/injection/suffix/:sessionID` — 设置后缀消息（每次 LLM 响应后注入）
- `DELETE /api/injection/:sessionID` — 清除所有注入状态

### Session API 新增端点
- `POST /session/:sessionID/forever` — 触发永续模式循环
- `DELETE /session/:sessionID/message/:messageID/part/:partID` — 删除单条 part
- `PATCH /session/:sessionID/message/:messageID/part/:partID` — 更新单条 part

### HttpApi 架构重构
- 将原有的路由实现重构为 Effect HttpApi 框架
- 新增 `groups/`（22 个分组）、`middleware/`、`handlers/` 目录结构
- 新增 WebSocket 连接追踪、实例生命周期管理、全局 API 前缀兼容

---

## 5. 会话注入与内容过滤

### `packages/opencode/src/session/injection.ts`（新增 141 行）
- 通用消息注入系统，用于 session agent 循环
- 支持 `setPrefix`（首次 LLM 调用前注入）、`setSuffix`（每次 LLM 响应后注入）、`setSuffixOnce`（一次性后缀）、`onRoundComplete`（轮次完成回调，返回 `InjectionDecision`）
- 被进化模式和永续模式的中继系统使用

### `packages/opencode/src/content-filter/`（新增目录）
- `phrase-ban.ts` — 运行时违禁词管理（`ban()`/`unban()`/`check()`/`clear()`），`Ref<BannedMap>` 状态，通过 `GlobalBus` 发送 `session.banned_phrases` 事件，支持宽限期（警告 → 拦截）
- `directive.ts` — `禁止:`/`ban:`/`允许:`/`unban:` 前缀指令解析器
- `filter.ts` — 组合内容过滤器（正则模式检查 + 运行时违禁词）

---

## 6. 会话压缩增强

### `packages/opencode/src/session/compaction.ts`（660 行 → 增强版）
- **双锚点压缩策略**：
  - `head_turns` — 保留最前 N 轮用户消息原文（默认 2）
  - `tail_turns` — 保留最近 N 轮用户消息原文（默认 0）
  - 使用 `head_end_id` / `tail_start_id` 标记追踪保留范围
- 插件可自定义压缩行为（`experimental.session.compacting` 注入上下文/替换提示）
- 自动续接：压缩后自动重放用户消息或注入合成 "continue" 消息
- 溢出处理：检测上下文溢出时自动请求压缩，剥离媒体内容
- 裁剪模式（`prune`）：移除旧的工具输出，保护近期轮次和摘要分隔

### `packages/opencode/src/config/config.ts` 新增配置项
- `compaction.auto` — 自动压缩（默认 true）
- `compaction.prune` — 启用裁剪（默认 true）
- `compaction.head_turns` — 保留前 N 轮原文（默认 2）
- `compaction.tail_turns` — 保留后 N 轮原文（默认 0）
- `compaction.preserve_recent_tokens` — 保留的最近 token 数
- `compaction.reserved` — 压缩安全缓冲 token

---

## 7. 中文本地化

系统级语言迁移，包括但不限于：

- **系统提示翻译**（commit `994c301db`）：所有 model-specific 提示文件（`default.txt`、`gpt.txt`、`gemini.txt`、`claude.txt`、`kimi.txt`、`codex.txt` 等）和通用提示（`plan-mode.txt`、`max-steps.txt`、`plan.txt`）从英文翻译为中文
- **工具描述中文化**：`read.txt`、`grep.txt`、`glob.txt`、`edit.txt`、`write.txt`、`shell.txt`、`websearch.txt`、`webfetch.txt`、`task.txt`、`question.txt` 等所有工具提示文件均更新为中文
- **`.opencode/command/` 全部中文化**：commit、changelog、ai-deps、issues、learn、rmslop、spellcheck、translate 均为中文描述
- **前缀命令**支持中文前缀（`进化:`、`永续:`、`禁止:`、`允许:`）
- **搜索工具**输出中文类别标签（综合信息、视频、代码/技术、学术、新闻、图片、购物比价、社交、音乐/音频）

---

## 8. 插件系统增强

### `packages/plugin/src/index.ts`
- **新增 hook `loop.continue`** — 每轮会话循环调用，返回 `shouldContinue` / `reason` / `sleepMs` / `conditionState`，用于永续模式决策
- **新增 hook `loop.inject`** — 每轮循环前调用，注入合成用户消息，替换硬编码的进化模式系统提醒注入
- **`tool.definition` 增强**：新增 `add` 字段，允许插件直接注册完全自定义的工具

### TUI 插件
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/banned-phrases.tsx` — 侧边栏插件，实时显示活跃违禁词列表和宽限期倒计时

### TUI 界面调整
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — 输入框增强
- `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx` — 会话列表对话框
- `packages/opencode/src/cli/cmd/tui/context/args.tsx` — 参数上下文
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — session 路由新增方法
- `packages/opencode/src/cli/cmd/tui/plugin/api.tsx` — TUI 插件 API 扩展

---

## 9. 构建系统改进

### `packages/opencode/script/build.ts`
- `--single` — 单平台构建（过滤当前 OS/arch 目标）
- `--outdir <dir>` — 自定义输出目录（默认 `dist`）
- `--binary-suffix <suffix>` — 二进制后缀，进化模式用于避免 Windows 文件锁冲突
- `--skip-embed-web-ui` — 跳过内置 Web UI 构建
- `--skip-install` — 跳过可选原生依赖安装
- `--baseline` — 基线（非 AVX2）构建
- `--sourcemaps` — 链接 sourcemap
- 存在 `--binary-suffix` 时跳过 `rm -rf` 输出目录，避免 Windows EPERM 错误
- 构建后对当前平台运行 `--version` 冒烟测试

### `.opencode/tool/build_opencode.ts`
- Windows 代理自动检测（注册表查询）
- 网络错误自动重试
- 构建前类型检查
- 成功后新建 PowerShell dev 窗口
- `--session <id>` 实现会话连续性

### `.gitignore`
- 新增 `s-temp/` 构建临时文件目录

---

## 10. 配置变更

### `.opencode/opencode.jsonc`
- `websearch` 权限设置为 `allow`
- `reference` 增加 `effect` 指向 `github.com/Effect-TS/effect-smol`

### 数据库 Schema
- `packages/core/src/database/schema-tables.ts` — 新增 `session_injection` 表
- `packages/core/src/database/schema-check.ts` — 新增 schema 版本检查
- `packages/core/src/database/migration.ts` — 新增 `migration_v2_session_injection` 迁移
- `packages/core/src/database/database.ts` — `initDatabase()` 增强，支持 schema 检查和迁移

### `packages/core/src/installation/version.ts`
- `binaryVersion` 格式调整，移除 dist 目录中未打包文件的版本号

---

## 11. 测试覆盖

### 主要新增测试文件

| 测试文件 | 用例数 |
|----------|--------|
| `test/search/new-engines.test.ts` | 1079 行 |
| `test/search/recent-engines.test.ts` | 419 行 |
| `test/search/aggregator.test.ts` | 400 行 |
| `test/search/executor.test.ts` | 359 行 |
| `test/search/engine.test.ts` | 245 行 |
| `test/search/bilibili.test.ts` | 233 行 |
| `test/search/price-compare.test.ts` | 196 行 |
| `test/search/searxng-engines.test.ts` | 195 行 |
| `test/search/query-intent.test.ts` | 211 行 |
| `test/session/compaction.test.ts` | 133+ 行新增 |
| `test/forever/forever-components.test.ts` | 279 行 |
| `test/forever/checkBudget.test.ts` | 111 行 |
| `test/util/bom.test.ts` | 42 行 |
| `test/util/error-format.test.ts` | 67 行 |

---

## 架构总结

S-Code 在 OpenCode 基础上进行的变更可以归纳为三个层次：

### 新增能力层
- **自我进化**：AI 自主修改代码、构建、重启的闭环系统
- **永续运行**：AI 作为守护进程持续监听条件和执行任务
- **元搜索引擎**：161 引擎的多引擎搜索架构，覆盖通用/中文/学术/购物/代码等场景
- **会话注入**：灵活的消息注入系统，支持前缀/后缀/回调
- **内容过滤**：运行时违禁词管理和过滤

### 基础设施增强
- **HttpApi 重构**：更模块化的 API 架构，22 个分组，注入 API 端点
- **双锚点压缩**：保留关键上下文的同时压缩历史
- **数据库迁移**：schema 版本控制和 session_injection 表
- **构建系统**：单平台构建、自定义输出、二进制后缀等选项
- **插件系统**：新增 loop hook 和工具注册能力

### 本地化适配
- **全中文系统提示**：所有模型提示和工具描述翻译为中文
- **中文搜索引擎**：百度/搜狗/360/夸克 + 23 个中文站点限定搜索
- **电商比价**：13 个中文电商平台比价引擎
- **中文前缀命令**：自然语言中文指令前缀
