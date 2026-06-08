# 搜索结果与 MAGI Sage 集成设计

## 概述

搜索结果的呈现方式直接影响 Sage 的消费效率。本设计定义了搜索结果如何注入到 Sage 上下文中。

## 搜索结果格式

### 原始搜索结果的呈现

```markdown
## 搜索结果：Rust 2026 新特性

### 来自 Bing
1. **[Rust 2026 Edition: What's New](https://example.com/rust-2026)** 
   2026 edition brings significant improvements to async, pattern matching, and compile times.
   [相关性: ★★★★☆]

### 来自 DuckDuckGo
2. **[The Future of Rust: 2026 and Beyond](https://example.com/future-rust)**
   A comprehensive look at the Rust roadmap for 2026 including TAIT, generic const expressions...
   [相关性: ★★★☆☆]

### 来自 百度
3. **[Rust 2026 版本新功能介绍](https://example.com/rust-2026-cn)**
   Rust 2026 版本引入了异步编程改进、模式匹配增强等特性...
   [相关性: ★★★★★]
```

### 流式呈现

搜索耗时较长（1-3s），可在 Sage 思考的同时逐步呈现：

```
Sage 思考中...
    ↓ 搜索完成
📊 搜索到 8 条结果（来自 3 个引擎）
   ├─ 正在阅读: Rust 2026 Edition: What's New...
   ├─ 相关: The Future of Rust: 2026 and Beyond...
   └─ 中文: Rust 2026 版本新功能介绍...
    ↓
Sage 回复...
```

## 搜索工具元数据

```go
type SearchToolMeta struct {
    ToolMeta
    MaxResults    int           // 返回结果上限
    CacheEnabled  bool          // 是否启用缓存
    ShowSource    bool          // 是否显示来源 (默认true)
}
```

## 在 Sage 上下文中的注入

搜索工具返回后，结果直接注入当前 Sage 的上下文：

```
系统: 你调用了 search_web 工具，以下是搜索结果：

[搜索结果]
来自 duckduckgo (3条):
1. 标题: Rust 2026 Edition
   URL: https://...
   摘要: ... (200字)
2. ...

来自 bing (2条):
...

来自 baidu (3条):
...
[/搜索结果]

请基于以上搜索结果回答用户的问题。
注意:
- 引用来源时说明来自哪个引擎
- 如果搜索结果不足以回答，说明局限性
- 优先引用高相关性的结果
```

## 与人格系统的联动

搜索结果可以受人格配置影响：

| 人格 | 搜索偏好 |
|------|---------|
| 织 (ZHI-01) | 优先中文来源，关注实用性 |
| 丽 (REI-01) | 优先权威来源（官方文档、论文） |
| 薰 (KAORU-02) | 全面覆盖，多角度对比 |

```go
func SearchEngineWeight(persona marduk.PersonaBase) map[string]float64 {
    weights := defaultWeights()
    // 开放性(O)高 → 更多多样化来源
    if persona.Traits["O"] > 0.7 {
        weights["academic"] *= 1.5
    }
    // 宜人性(A)高 → 偏重社交来源
    if persona.Traits["A"] > 0.7 {
        weights["social"] *= 1.3
    }
    return weights
}
```

## 搜索场景测试

| 场景 | 预期行为 |
|------|---------|
| "搜索Rust最新版" | general引擎，返回3引擎结果 |
| "百度一下Rust" | 触发zh-CN意图，百度优先 |
| "推荐一本Rust书" | 购物/推荐意图，混合引擎 |
| "Rust编译速度" | 通用搜索，全部引擎 |
