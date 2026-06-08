# S-Forge Web 搜索能力设计

## 背景

s-forge (MAGI) 目前缺少 Web 搜索能力，而 s-code 拥有 161 个搜索引擎适配器的元搜索系统。s-forge 通过 **goja** (Go JavaScript 运行时) 支持后端动态 JS 执行，可以此为基础构建搜索系统。

## 架构方案：Go + goja 元搜索引擎

```
MAGI Sage 调用 search_web 工具
    │
    ▼
┌──────────────────────────────────────────┐
│            Go Search Engine               │
│                                           │
│  EngineManager (Go)                       │
│  ├── 引擎注册 + 并发控制                   │
│  ├── 熔断器 + 超时控制                    │
│  └── 结果聚合 (去重+评分)                  │
│                                           │
│  JS Adapter (goja 运行时)                  │
│  ├── 每个引擎一个 .js 适配器文件            │
│  ├── 导入到 goja Runtime                   │
│  └── 执行 HTTP fetch → 解析 HTML → 返回结果│
└──────────────────────────────────────────┘
    │
    ▼
    MAGI Sage 获取搜索结果
```

## 引擎适配器设计

### 适配器接口

每个搜索引擎适配器是一个独立的 JavaScript 文件，通过 goja 运行：

```javascript
// engines/duckduckgo.js
export default {
  name: 'duckduckgo',
  weight: 1.0,
  async search(query, numResults) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await siyuan.client.fetch(url);
    const html = await resp.text();
    return parseResults(html, numResults);
  }
};

function parseResults(html, numResults) {
  // 解析 HTML → 返回 [{ title, url, snippet }]
}
```

### 适配器可访问的 API

| API | 来源 | 用途 |
|-----|------|------|
| `siyuan.client.fetch(url)` | goja 插件系统 | HTTP 请求 |
| `siyuan.client.fetch(url, options)` | goja 插件系统 | 带自定义 header 的请求 |
| `console.log()` | goja 插件系统 | 日志 |
| `JSON.parse/stringify` | JS 标准 | 数据处理 |

### 首批适配的引擎

| 引擎 | 说明 | 搜索URL模式 |
|------|------|------------|
| DuckDuckGo | HTML版，无需API Key | `https://html.duckduckgo.com/html/?q=` |
| Bing | HTML解析 | `https://www.bing.com/search?q=` |
| Brave | 免费API (2000次/月) | `https://api.search.brave.com/res/v1/web/search` |
| Google | HTML解析 (需处理反爬) | `https://www.google.com/search?q=` |
| 百度 | HTML解析 | `https://www.baidu.com/s?wd=` |
| 搜狗 | HTML解析 | `https://www.sogou.com/web?query=` |
| Wikipedia | API | `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=` |
| Arxiv | API | `http://export.arxiv.org/api/query?search_query=all:` |

## Go 侧实现

### EngineManager

```go
// engine_manager.go
type EngineAdapter struct {
    Name   string
    Weight float64
    JSFunc func(query string, num int) ([]SearchResult, error)
}

type SearchResult struct {
    Title   string `json:"title"`
    URL     string `json:"url"`
    Snippet string `json:"snippet"`
    Engine  string `json:"engine"`
}

type EngineManager struct {
    adapters  []*EngineAdapter
    aggregator *ResultAggregator
}

func (m *EngineManager) Search(query string, opts SearchOptions) ([]AggregatedResult, error) {
    // 1. 根据 queryType 选择引擎
    // 2. 并发执行适配器 (goroutine)
    // 3. 收集结果 + 熔断
    // 4. 聚合去重评分
    // 5. 返回
}
```

### 引擎选择逻辑

参考 s-code 的 `query-intent.ts`，基于查询内容选择引擎：

| queryType | 启用引擎 |
|-----------|---------|
| general | DuckDuckGo, Bing, Brave, Google |
| news | Bing News, Google News |
| academic | Arxiv, Wikipedia, Semantic Scholar |
| code | GitHub, StackOverflow |
| video | YouTube, Bilibili |
| zh-CN | 百度, 搜狗, 360, 夸克 |

### 结果聚合

```go
// aggregator.go
type AggregatedResult struct {
    Title   string   `json:"title"`
    URL     string   `json:"url"`
    Snippet string   `json:"snippet"`
    Engines []string `json:"engines"` // 来源引擎列表
    Score   float64  `json:"score"`
}

func (a *ResultAggregator) Aggregate(results []SearchResult) []AggregatedResult {
    // 1. URL 去重
    // 2. 标题相似度合并 (Levenshtein)
    // 3. 加权评分 (引擎权重 × 位置)
    // 4. 按分数排序
    // 5. 截断返回
}
```

## 与 s-code 搜索的对比

| 维度 | s-code (161引擎) | s-forge (本方案) |
|------|-----------------|-----------------|
| 引擎数 | 161 | 10-15 (首批) |
| 搜索质量 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 维护成本 | TypeScript 适配器 | JS适配器(可复用s-code逻辑) |
| 无需API Key | ✅ 多数引擎 | ✅ DuckDuckGo/Bing/百度 |
| 速度 | 并发10引擎 | 并发3-5引擎 |
| 部署 | Bun runtime | goja (内嵌) |

## MAGI 工具集成

### 搜索工具定义

```go
// toolset_search.go
func BuildWebSearchToolDef() ToolDef {
    return ToolDef{
        Type: "function",
        Function: ToolFunctionDef{
            Name: "search_web",
            Description: "搜索网络信息。支持通用搜索、新闻、学术、代码等多种类型。",
            Parameters: map[string]interface{}{
                "query":     {"type": "string", "description": "搜索关键词"},
                "numResults": {"type": "integer", "description": "返回结果数(默认5)"},
                "type":      {"type": "string", "enum": ["general","news","academic","code"]},
            },
        },
        Meta: ToolMeta{
            ReadsWebContent: true,
            AvailableDirectReply: true,
            AvailableSleepHB: false,
            AvailableWorkHB: true,
        },
    }
}
```

### Sage 使用方式

```
用户: "帮我查一下Rust 2026的最新特性"

Melchior (主导): 我需要搜索Rust 2026的信息
    → 调用 search_web(query="Rust 2026 new features", type="general", numResults=5)
    → 获取搜索结果并分析
    → 回复用户
```

## 实现阶段

### Phase 1 (MVP): 4 核心引擎
- DuckDuckGo (HTML, 无需 API Key)
- Bing (HTML)  
- 百度 (HTML, 中文搜索)
- Wikipedia (API)

### Phase 2 (增强): +6 引擎
- Brave (免费 API)
- Google (HTML)
- 搜狗 (中文)
- Arxiv (学术)
- GitHub (代码)
- Bilibili (视频)

### Phase 3 (优化): 
- 结果缓存 (SQLite)
- 查询意图检测
- 爬虫检测规避
- 与 s-code 搜索打通
