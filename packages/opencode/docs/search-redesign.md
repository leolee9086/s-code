# opencode 网络搜索功能重建设计文档

> 基于 SearXNG 架构分析，设计 opencode 的下一代网络搜索功能
> 日期：2026-06-05
> 状态：设计草案（等待用户批准后实施）

---

## 1. 背景与问题

### 1.1 当前状态

opencode 目前的网络搜索功能 (`src/tool/websearch.ts`) 使用单引擎模式：

- **默认引擎**: DuckDuckGo（通过 `src/tool/duckduckgo.ts` 的 HTTP scraping 实现）
- **可选引擎**: Exa（需 API Key）、Parallel（需 API Key）
- **搜索策略**: 单引擎串行执行，先 HTML 端点 → VQD/JSON → Lite 端点

### 1.2 当前问题

| 问题 | 描述 |
|------|------|
| **单点故障** | DuckDuckGo 若被屏蔽或限流，整个搜索功能瘫痪 |
| **无结果聚合** | 只返回一个引擎的结果，没有多源交叉验证 |
| **无去重** | 多个引擎返回相同 URL 时直接丢弃（已在不同引擎间丢失信息） |
| **无评分排序** | 结果展示顺序与引擎无关 |
| **无分类多样性** | 搜索结果缺乏分类层面的多样性保证 |
| **VQD 管理不持久** | DuckDuckGo 的 VQD token 仅内存存储，进程重启后丢失 |

### 1.3 SearXNG 可借鉴的设计

SearXNG 是一个成熟的元搜索引擎，其核心优势：

| SearXNG 特性 | 说明 | 借鉴价值 |
|-------------|------|---------|
| **多引擎并行** | 同时向 70+ 搜索引擎发请求 | 高 |
| **结果去重与合并** | URL hash 去重，智能合并元数据 | 高 |
| **评分排序** | 基于位置 + 引擎权重的评分 | 高 |
| **分类分组** | 按类别/模板分组保证多样性 | 高 |
| **引擎级别超时** | 每个引擎独立超时管理 | 高 |
| **引擎暂停机制** | 连续失败后自动暂停 | 高 |
| **持久化缓存** | SQLite 缓存 VQD、token 等 | 中 |
| **CAPTCHA 处理** | 检测并处理验证码 | 中 |
| **网络层抽象** | 统一管理 HTTP 客户端 | 中 |

---

## 2. 架构设计

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────┐
│                    LLM / Agent Layer                  │
│               (调用 websearch 工具)                    │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Search Orchestrator                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Engine      │  │ Result       │  │ Error      │  │
│  │ Selector    │  │ Aggregator   │  │ Handler    │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                │                 │         │
│  ┌──────▼────────────────▼─────────────────▼──────┐ │
│  │              Concurrent Executor                   │
│  │       (每个引擎在独立 Effect Fiber 中运行)          │
│  └──────┬──────┬──────┬──────┬──────────────────────┘ │
└─────────┼──────┼──────┼──────┼────────────────────────┘
          │      │      │      │
┌─────────▼──┐ ┌▼──────┐ ┌▼──────┐ ┌▼──────────────────┐
│ DuckDuckGo │ │ Google│ │ Bing  │ │ ... (可扩展)     │
│ Engine     │ │ Engine│ │ Engine│ │                   │
└────────────┘ └───────┘ └───────┘ └───────────────────┘
```

### 2.2 核心模块

#### 2.2.1 Engine Selector（引擎选择器）

根据上下文选择要使用的搜索引擎及配置。

```
EngineSelector(providerID, modelID, query):
  1. 检测可用引擎:
     - DuckDuckGo: 始终可用（免费、零配置）
     - Exa: 检查 EXA_API_KEY
     - Parallel: 检查 PARALLEL_API_KEY
     - Brave: 检查 BRAVE_API_KEY（新增）
     - Google Web Search: 可选（新增）
  2. 按优先级/配置选择引擎子集
  3. 为每个引擎分配权重和超时
```

##### 引擎权重配置

```typescript
interface EngineConfig {
  name: string
  enabled: boolean
  weight: number      // 搜索结果权重倍数
  timeout: number     // 毫秒
  maxResults: number  // 每个引擎最大返回数
  requiresKey: boolean
  priority: number    // 选择优先级
}
```

默认配置：

| 引擎 | 权重 | 超时 | 说明 |
|------|------|------|------|
| DuckDuckGo | 1.0 | 15s | 始终可用 |
| DuckDuckGo HTML | 0.9 | 15s | HTML 端点兜底 |
| Exa | 1.2 | 25s | API Key 可选 |
| Parallel | 1.2 | 25s | API Key 可选 |
| Brave | 1.0 | 15s | 新增，免费 API |

#### 2.2.2 Concurrent Executor（并发执行器）

借鉴 SearXNG 的多线程并发模型，但使用 Effect 的 Fiber 机制实现：

```typescript
interface Executor {
  execute(
    engines: EngineInstance[],
    query: string,
    timeout: number
  ): Effect<EngineResponse[], never, never>
}
```

执行流程：

1. 为每个引擎创建一个 Effect Fiber（轻量协程）
2. 所有 Fiber 并发启动
3. 收集每个 Fiber 的结果或错误
4. 超时后未完成的 Fiber 被取消
5. 返回成功的结果列表

关键区别 vs SearXNG：
- 不使用 Python 线程（GIL 限制）
- 使用 Effect Fiber，更轻量、可取消
- 内置超时管理（`Effect.timeout`）

#### 2.2.3 Result Aggregator（结果聚合器）

借鉴 SearXNG 的 `ResultContainer` 设计，改进的去重和排序算法：

```typescript
interface Aggregator {
  aggregate(responses: EngineResponse[]): SearchResult[]
}
```

##### 去重策略（三阶段）

```
阶段 1: URL 规范化去重
  - 规范化 URL（移除 tracking params、协议统一）
  - 使用 URL hash 作为主键
  - 相同 URL 的来自不同引擎的结果合并

阶段 2: 相似内容合并
  - 对标题/摘要进行模糊匹配
  - 编辑距离 < 20% 视为重复
  - 保留文本更长的版本

阶段 3: 引擎元数据合并
  - 合并 `engines` 集合（记录有哪些引擎返回了相同结果）
  - 合并所有位置信息
  - 选择内容最丰富的版本
```

##### 评分算法

借鉴 SearXNG 的 `calculate_score`：

```typescript
function calculateScore(result: MergedResult): number {
  // 基础分：来自各引擎的位置分之和
  let score = 0
  for (const { engine, position } of result.origins) {
    const weight = engine.weight
    score += weight / position  // 位置越前，得分越高
  }
  
  // 引擎多样性加分（多个引擎返回相同结果 → 置信度高）
  score *= 1 + (result.origins.length - 1) * 0.2
  
  // 时效性加分（若有发布时间）
  if (result.publishedDate) {
    const daysAgo = (Date.now() - result.publishedDate) / 86400000
    score *= Math.max(0.5, 1 - daysAgo / 365)  // 一年内线性衰减
  }
  
  return score
}
```

##### 多样性分组

借鉴 SearXNG 的 category 分组机制，但简化：

```typescript
function diversifyResults(results: SearchResult[]): SearchResult[] {
  // 1. 按域名分组
  const groups = groupByDomain(results)
  
  // 2. 从每个域名最多取 N 个
  const diversified = []
  for (const group of rotateGroups(groups)) {
    diversified.push(group.next())
  }
  
  // 3. 如果还不够，从剩余结果补充
  // ...
  
  return diversified
}
```

#### 2.2.4 Engine Adapter Layer（引擎适配层）

借鉴 SearXNG 的 `request/response` 模式：

```typescript
interface EngineAdapter {
  name: string
  weight: number
  
  // 构建 HTTP 请求参数（对应 SearXNG 的 `request()`）
  buildRequest(query: string, opts: SearchOptions): RequestConfig
  
  // 解析 HTTP 响应（对应 SearXNG 的 `response()`）
  parseResponse(resp: HttpResponse): EngineResult[]
}
```

### 2.3 DuckDuckGo 引擎重构

当前问题：我们的实现自行处理 VQD token、多端点兜底，分散了核心搜索逻辑。

借鉴 SearXNG 的 DDG 引擎设计：

| 特性 | 当前实现 | SearXNG 做法 | 改进方向 |
|------|---------|-------------|---------|
| 主要端点 | 先尝 HTML GET → VQD/JSON | HTML POST（模拟表单） | 改为 POST 提高成功率 |
| VQD 管理 | 仅内存，volatile | SQLite 缓存 + 空白 hash | 增加持久化缓存 |
| VQD 获取 | 从 HTML 中正则提取 | 从 `<input name="vqd">` 提取 | 更可靠的提取方式 |
| CAPTCHA | 无检测 | 检测 `#challenge-form` | 增加 CAPTCHA 检测 |
| Sec-Fetch 头 | 无 | 模拟浏览器 `Sec-Fetch-*` | 增加关键 headers |
| Accept-Language | 固定 en-US | 根据用户 locale | 动态 locale |
| HTTP 方法 | GET | POST | 模拟表单提交 |
| Cookies | 无 | `kl=..; df=..` | 维持 session cookies |
| 用户代理 | 固定 Chrome 143 | 自动轮换 UA | 维持静态 UA 避免触发 bot 检测 |

### 2.4 新增引擎支持

#### 2.4.1 Brave Search API

Brave 提供免费 API（每月 2000 次查询）：

```typescript
class BraveEngine implements EngineAdapter {
  async search(query: string): Promise<EngineResult[]> {
    const resp = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
      { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip' } }
    )
    // 免费 API 无需 API Key！但速率受限
  }
}
```

#### 2.4.2 Google Web Search（可选）

通过 Custom Search JSON API：

```typescript
class GoogleEngine implements EngineAdapter {
  requiresApiKey = true
  
  async search(query: string): Promise<EngineResult[]> {
    // GET https://www.googleapis.com/customsearch/v1?key=...&cx=...&q=...
  }
}
```

---

## 3. Effect 架构实现

利用 opencode 的 Effect 生态天然优势：

### 3.1 Engine Adapter Interface

```typescript
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// 引擎适配器接口
export interface SearchEngine {
  readonly name: string
  readonly weight: number
  readonly maxResults: number
  
  // 独立的搜索方法
  readonly search: (
    http: HttpClient.HttpClient,
    query: string,
    opts: SearchOptions,
  ) => Effect.Effect<EngineResult[], EngineError, never>
}

// 搜索结果
export interface EngineResult {
  title: string
  url: string
  snippet: string
  engine: string
  position: number
}
```

### 3.2 并发执行

```typescript
export function executeEngines(
  engines: SearchEngine[],
  http: HttpClient.HttpClient,
  query: string,
  opts: SearchOptions,
): Effect.Effect<AggregatedResult[], never, never> {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      engines,
      (engine) =>
        engine.search(http, query, opts).pipe(
          Effect.timeout(engine.timeout),
          Effect.catchAll((err) => Effect.succeed([] as EngineResult[])),
          Effect.fork, // 每个引擎在独立 Fiber 中运行
        ),
      { concurrency: "unbounded" },
    )
    
    // 收集所有 Fiber 的结果
    const engineResponses: EngineResult[][] = yield* Effect.all(results, {
      concurrency: "unbounded",
    })
    
    // 聚合去重排序
    const flat = engineResponses.flat()
    return aggregateResults(flat)
  })
}
```

### 3.3 InstanceState 集成

将所有引擎状态（VQD 缓存、引擎暂停状态）放入 `InstanceState` 管理：

```typescript
export const SearchService = Context.Tagged<SearchService, {
  readonly search: (query: string, opts: SearchOptions) => Effect.Effect<string, never, never>
}>()

export const layer = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<SearchState>(
      Effect.fn("SearchState")(function* () {
        return {
          vqdCache: new Map<string, string>(),
          engineStatus: new Map<string, EngineStatus>(),
        }
      }),
    )
    
    return SearchService.of({
      search: (query, opts) => Effect.gen(function* () { ... }),
    })
  }),
)
```

---

## 4. 数据流设计

### 4.1 全流程

```
用户查询 "最新 AI 新闻"
        │
        ▼
EngineSelector.select(query)
  选择: [DuckDuckGo, DuckDuckGo_HTML, Brave]
        │
        ▼
ConcurrentExecutor.execute(engines, query)
  并行启动 3 个 Fiber
        │
   ┌─────┼─────┐
   ▼     ▼     ▼
  DDG   DDG   Brave
  JSON  HTML  API
   │     │     │
   ▼     ▼     ▼
  ┌───────────────┐
  │  Result       │
  │  Aggregator   │
  │  · 去重       │
  │  · 合并       │
  │  · 评分       │
  │  · 排序       │
  └───────┬───────┘
          │
          ▼
    formatResults()
    格式化为 LLM 可读文本
          │
          ▼
    返回给 agent
```

### 4.2 错误处理

```
┌──────────────────────────────┐
│ Fiber 1: DuckDuckGo JSON    │
│ → 成功，返回 8 条结果        │
├──────────────────────────────┤
│ Fiber 2: DuckDuckGo HTML    │
│ → 超时（15s）→ 返回 []      │
├──────────────────────────────┤
│ Fiber 3: Brave API          │
│ → 返回 5 条结果              │
├──────────────────────────────┤
│ 聚合结果: 12 条（去重后）    │
└──────────────────────────────┘

引擎健康状态追踪 EngineStatus:
  - consecutiveFailures: 0, 1, 2...
  - suspended: true / false
  - lastError: string
  → 连续失败 3 次后自动暂停 5 分钟
```

---

## 5. 实施计划

### 阶段 1: 核心架构（预估 1-2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 定义 Engine Adapter 接口 | `src/search/engine.ts` | `SearchEngine` 接口定义 |
| 实现 Result Aggregator | `src/search/aggregator.ts` | 去重、评分、排序 |
| 实现 Concurrent Executor | `src/search/executor.ts` | Effect Fiber 并发执行 |
| 重构 Engine Selector | `src/search/selector.ts` | 引擎选择逻辑 |

### 阶段 2: 引擎实现（预估 1-2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 重构 DuckDuckGo 引擎 | `src/search/engines/duckduckgo.ts` | 借鉴 SearXNG 的 POST+VQD 方案 |
| 添加 HTML 兜底引擎 | `src/search/engines/duckduckgo-html.ts` | HTML scraping |
| 添加 Lite 兜底引擎 | `src/search/engines/duckduckgo-lite.ts` | Lite 端点 |
| 添加 Brave 引擎 | `src/search/engines/brave.ts` | 免费 API |

### 阶段 3: 集成与迁移（预估 1 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 集成到 Tool 系统 | `src/tool/websearch.ts` | 替换现有单引擎逻辑 |
| 添加 InstanceState 管理 | `src/search/state.ts` | VQD 缓存、引擎状态 |
| 添加测试 | `test/search/` | 单元 + 集成测试 |

### 阶段 4: 优化与扩展（后续）

- 添加 Exa 引擎适配器
- 添加 Parallel 引擎适配器
- 结果缓存（减少重复查询）
- 用户配置自定义引擎

---

## 6. 与前端的接口（不变）

搜索工具的接口保持向后兼容：

```typescript
// 工具参数（不变）
{
  query: string         // 搜索查询
  numResults?: number   // 返回结果数（默认 8）
  livecrawl?: string    // 实时爬取模式
  type?: string         // 搜索类型
  contextMaxCharacters?: number  // 上下文最大字符数
}

// 工具输出（格式不变）
{
  output: string        // 格式化后的搜索文本
  title: string         // "DuckDuckGo 网络搜索: xxx"
  metadata: {
    provider: string    // 使用的引擎
    available: boolean
    engines: string[]   // 新增：实际参与搜索的引擎列表
  }
}
```

---

## 7. 与 SearXNG 的关键差异

| 维度 | SearXNG | opencode |
|------|---------|----------|
| **运行环境** | 独立 Web 服务（Python） | Agent 内嵌工具（TypeScript/Effect） |
| **目标用户** | 人类浏览器 UI | LLM Agent |
| **结果展示** | HTML 页面 | 文本格式化 |
| **并发模型** | Python Thread | Effect Fiber（协程） |
| **语言** | Python | TypeScript |
| **引擎数量** | 70+ | ~5（聚焦高质量） |
| **部署** | Docker/独立服务 | 内嵌在 opencode 进程内 |
| **配置** | YAML 配置 | 无配置文件（自动检测 API Key） |

---

## 8. 开放问题

1. **是否需要 Exa/Parallel 的 JSON-RPC MCP 协议？**  
   目前使用 MCP 协议调用 Exa/Parallel，重构后是否改为更简单的 REST API？

2. **结果数量阈值？**  
   当 DuckDuckGo 返回 0 结果时，是否自动切换到备用引擎？当前设计是全部并发。

3. **引擎暂停策略？**  
   连续失败多少次后暂停？暂停多长时间？是否需要用户通知？

4. **VQD 缓存的持久化？**  
   是否使用 SQLite（如 SearXNG）还是仅内存缓存？

---

## 9. 附录：SearXNG 源码学习摘要

### SearXNG 搜索流程

```
SearXNG 搜索流程 (searx/search/__init__.py)

1. Search.search()
   ├─ search_external_bang()  → 处理 !bang 指令
   ├─ search_answerers()      → 内置回答器（天气、计算器等）
   └─ search_standard()       → 主搜索流程
        ├─ _get_requests()    → 为每个引擎构建请求参数
        │   ├─ 检测引擎是否暂停
        │   ├─ 构建请求参数
        │   └─ 计算 timeout
        └─ search_multiple_requests() → 多线程并发
            └─ 每个引擎一个 Thread
               ├─ processor.search() → 发送 HTTP 请求
               └─ extend_container() → 收集结果
```

### SearXNG 结果聚合流程

```
ResultContainer (searx/results.py)

1. extend(engine_name, results)
   └─ 对每条结果:
      ├─ 检测结果类型（MainResult / Answer / Suggestion ...）
      ├─ 调用 on_result 钩子（插件系统）
      └─ _merge_main_result() → 去重合并

2. close()
   └─ 对所有结果:
      ├─ calculate_score() → 计算评分
      └─ 记录引擎评分 metrics

3. get_ordered_results()
   ├─ 按 score 降序排序
   └─ 按 category+template 分组
      ├─ 每组最多 8 条
      └─ 组间最大距离 20
```

### SearXNG DDG 引擎关键点

```
DuckDuckGo 引擎 (searx/engines/duckduckgo.py)

请求:
  - POST 到 https://html.duckduckgo.com/html/
  - 表单数据: q, b, kl, df, vqd, nextParams, api, o, v, dc, s
  - Headers: Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Fetch-User
  - User-Agent: 静态生成（用于 VQD 一致性）
  - Cookies: kl, df

响应:
  - 解析 HTML（lxml）
  - 检测 CAPTCHA（#challenge-form）
  - 提取 VQD（<input name="vqd">）
  - 提取结果（#links > .web-result）
  - 提取零点击信息框（#zero_click_abstract）

VQD 管理:
  - 首次请求无需 VQD
  - 从响应 HTML 中提取 VQD
  - 缓存到 SQLite（1h 过期）
  - 后续分页必需 VQD
  - 无 VQD 访问次页会触发 bot 检测
```

---

*本文档基于 SearXNG master (2026-06-05) 源码分析。SearXNG 仓库: https://github.com/searxng/searxng*
