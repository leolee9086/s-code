# S-Forge 搜索查询意图检测设计

## 概述

在将用户查询发送到搜索引擎之前，先分析查询意图，选择最合适的引擎组合。参考 s-code 的 `query-intent.ts`。

## 意图分类

| 意图类型 | 说明 | 示例 |
|---------|------|------|
| `general` | 通用信息查询 | "什么是Rust语言" |
| `news` | 新闻/时事 | "2026年AI最新进展" |
| `academic` | 学术/论文 | "transformer注意力机制论文" |
| `code` | 代码/技术 | "Rust async await用法" |
| `video` | 视频/多媒体 | "Bilibili Rust教程" |
| `shopping` | 购物比价 | "机械键盘推荐" |
| `zh-CN` | 中文内容优先 | "百度百科 Rust" |
| `weather` | 天气查询 | "北京明天天气" |
| `translate` | 翻译 | "hello world 中文" |

## 检测实现

### Go 侧实现（正则匹配）

```go
// query_intent.go
type QueryIntent string

type IntentPattern struct {
    Intent   QueryIntent
    Patterns []string   // 正则列表
    Priority int        // 优先级 (高优先先匹配)
}

var intentPatterns = []IntentPattern{
    {
        Intent: IntentTranslate,
        Priority: 90,
        Patterns: []string{
            `(?i)^(translate|翻译)\s+`,
            `(?i)\s+means?\s+in\s+`,
        },
    },
    {
        Intent: IntentWeather,
        Priority: 85,
        Patterns: []string{
            `(天气|weather|温度|气温|降雨|下雪)`,
        },
    },
    {
        Intent: IntentNews,
        Priority: 70,
        Patterns: []string{
            `最新|新闻|快讯|报道|发布|announce|release|latest`,
            `(?i)^(news|what.happened)\s+`,
        },
    },
    {
        Intent: IntentAcademic,
        Priority: 60,
        Patterns: []string{
            `论文|算法|定理|证明|期刊|文献|survey|paper|thesis`,
            `(?i)\b(arxiv|doi|acm|ieee|springer)\b`,
        },
    },
    {
        Intent: IntentCode,
        Priority: 50,
        Patterns: []string{
            `(?i)\b(api|sdk|library|package|module|function|class|type)\b`,
            `(?i)\b(install|npm|pip|cargo|go get|brew|apt)\b`,
            `(?i)(用法|示例|example|tutorial|how.to)\s+`,
        },
    },
    {
        Intent: IntentVideo,
        Priority: 40,
        Patterns: []string{
            `(?i)\b(video|教程|tutorial|youtube|bilibili|b站|视频)\b`,
        },
    },
    {
        Intent: IntentShopping,
        Priority: 30,
        Patterns: []string{
            `(?i)(推荐|性价比|评测|review|best|top|buy|购买|价格|price)\b`,
            `(?i)(笔记本|手机|耳机|键盘|显示器)\s+(推荐|性价比|评测)`,
        },
    },
    {
        Intent: IntentChinese,
        Priority: 20,
        Patterns: []string{
            `[\p{Han}]`,  // 包含中文字符
        },
    },
}
```

### 检测流程

```
用户查询
    │
    ▼
正则模式匹配 (按优先级)
    │
    ├─ 高优先级命中 → 直接确定意图
    │
    └─ 无高优先级命中 → 按以下规则判断：
        ├─ 含中文 → zh-CN + general
        ├─ 含代码关键词 → code
        └─ 默认 → general
    │
    ▼
意图 → 引擎选择
```

## 引擎选择矩阵

| 检测到的意图 | 启用的引擎 |
|-------------|-----------|
| general | DuckDuckGo, Bing, Brave |
| news | Bing News, 百度新闻 |
| academic | Wikipedia, Arxiv |
| code | GitHub, StackOverflow, 百度(中文) |
| video | Bilibili, YouTube |
| zh-CN | 百度, 搜狗, 360 |
| shopping | 百度, 什么值得买 |
| weather | wttr.in API |
| translate | Deepl, 百度翻译 |
