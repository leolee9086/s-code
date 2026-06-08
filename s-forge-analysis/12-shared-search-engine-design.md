# S-Forge 与 S-Code 搜索代码共享方案

## 目标

s-code 已有 **161 个搜索引擎适配器**（TypeScript），s-forge 不应重写。需要设计一个共享方案，让 Go 后端的 s-forge 能够复用 TypeScript 的搜索能力。

## 方案对比

| 方案 | 复杂度 | 性能 | 共享程度 | 推荐 |
|------|--------|------|---------|------|
| **A: 内嵌 s-code 子进程** | ⭐低 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ **推荐** |
| **B: 共享 npm 包** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 长期 |
| **C: HTTP API 服务** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 备选 |
| **D: WASM 编译** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | 不推荐 |

## 方案 A：内嵌 s-code 子进程（推荐）

**架构前提**: s-forge 直接包含 s-code 的二进制文件，可以随时启动。

### 架构

```
s-forge (Go)
    │
    │ Sage 调用 search_web 工具
    ▼
Search Manager (Go)
    │
    ├── 1. 查询意图检测 (Go 正则)
    ├── 2. 检查缓存 (LRU + SQLite)
    ├── 3. 未命中 → 启动 s-code 子进程
    │
    ▼
s-code 进程 (Bun 二进制)
    │
    ├── 预编译为独立 binary
    ├── 接收 stdin: { "type": "search", "query": "...", "num": 5 }
    ├── 调用 search/selector.ts → 161 引擎
    ├── 输出 stdout: JSON 结果
    └── 进程退出
    │
    ▼
Search Manager (Go)
    │
    ├── 4. 解析 stdout → 结构体
    ├── 5. 写入 SQLite 缓存
    └── 6. 返回 Sage
```

### s-code 搜索入口

在 s-code 中新增搜索专用入口文件，编译为独立 binary 或由主 binary 的 `--search` 模式调用：

```typescript
// s-code: search-cli.ts — 搜索专用 CLI 入口
// 编译: bun build search-cli.ts --compile --outfile s-code-search

import { WebSearch } from "@/tool/websearch"

async function main() {
  const args = JSON.parse(process.argv[2])  // 从 argv 获取参数
  // 或从 stdin 读取
  const input = JSON.parse(await readStdin())
  
  const results = await Effect.runPromise(
    WebSearch.search({
      query: input.query,
      numResults: input.num ?? 5,
      queryType: input.type ?? "general",
    })
  )
  
  // 输出 JSON 到 stdout
  console.log(JSON.stringify({
    query: input.query,
    results: results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      engine: r.engine,
    })),
    engines: [...new Set(results.map(r => r.engine))],
    total: results.length,
  }))
}
```

### s-forge 端调用实现

```go
// search/s_code_bridge.go
package search

import (
    "encoding/json"
    "os/exec"
    "strings"
    "time"
)

type SCacheBinary struct {
    binaryPath string  // s-code 二进制路径 (随 s-forge 打包)
    cache      *SearchCache
}

func (s *SCacheBinary) Search(req SearchRequest) (*SearchResponse, error) {
    // 1. 检查缓存
    cacheKey := s.cacheKey(req)
    if cached := s.cache.Get(cacheKey); cached != nil {
        return cached, nil
    }
    
    // 2. 启动 s-code 子进程
    input, _ := json.Marshal(req)
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    
    cmd := exec.CommandContext(ctx, s.binaryPath, 
        "--mode", "search",
        "--input", string(input),
    )
    
    stdout, err := cmd.Output()
    if err != nil {
        return nil, fmt.Errorf("s-code search failed: %w", err)
    }
    
    // 3. 解析结果
    var result SearchResponse
    if err := json.Unmarshal(stdout, &result); err != nil {
        return nil, err
    }
    
    // 4. 写入缓存
    s.cache.Set(cacheKey, &result)
    
    return &result, nil
}
```

### 进程管理

由于搜索频繁（一次对话可能多次搜索），需要管理子进程生命周期：

```go
type SCodeProcessPool struct {
    binaryPath string
    pool       chan struct{}  // 限制并发数 (默认3)
}

func (p *SCodeProcessPool) Acquire() {
    p.pool <- struct{}{}  // 阻塞等待槽位
}

func (p *SCodeProcessPool) Release() {
    <-p.pool  // 释放槽位
}
```

每个搜索请求启动一个新进程，完成后退出。进程池限制最大并发数。

## 方案 B：共享 npm 包（长期）

将 `src/search/engines/` 提取为独立 npm 包，s-forge 通过 goja 加载：

```
packages/search-engines/
├── engines/
│   ├── duckduckgo.ts
│   ├── bing.ts
│   ├── baidu.ts
│   └── ...
├── selector.ts    (引擎选择)
├── aggregator.ts  (结果聚合)
├── query-intent.ts(意图检测)
└── index.ts
```

s-forge 通过 goja 运行时加载：

```go
// 在 goja 中运行编译后的 JS 搜索 bundle
rt := goja.New()
// 注入 fetch polyfill
rt.Set("fetch", s.forgeFetch)
// 执行搜索 bundle (由 shared npm 包构建)
rt.RunScript(searchBundle)
// 调用 search 函数
result, _ := rt.RunString(`search("Rust 2026", {num: 5})`)
```

优势：不依赖外部进程，低延迟
劣势：JS bundle 需要注入 fetch polyfill, 维护成本较高

## 方案 C：HTTP API 服务（备选）

如果 s-code 已经以 `serve` 模式运行（如持续运行的 TUI 或 API 服务），s-forge 可以直接通过 HTTP 调用搜索 API：

```
s-forge → POST http://localhost:19876/api/search → s-code
```

此方案在 s-code 不运行时不可用，仅作为备选。

## 推荐路线

### Phase 1: 内嵌 s-code 子进程 ✅
- s-forge 打包 s-code 的 pre-built binary
- 搜索时启动子进程 → 搜索 → 退出
- 简单、可靠、零代码修改

### Phase 2: 进程池优化
- 增加并发控制、缓存预热
- 优化启动速度（保持热进程）

### Phase 3: 共享 npm 包
- 抽取搜索引擎为独立包
- s-forge 通过 goja 直接运行（不用进程）
- 完全消除进程启动开销
