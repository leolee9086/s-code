# S-Forge 搜索缓存与反爬策略设计

## 一、缓存架构

### 多层缓存

```
查询 → 内存缓存 (LRU) → SQLite 持久缓存 → 搜索引擎
         │                    │
         ▼                    ▼
    命中返回              命中返回
```

### 内存缓存 (LRU)

```go
// cache/lru.go
type SearchCache struct {
    mu       sync.RWMutex
    entries  map[string]*CacheEntry
    maxSize  int      // 最大条目数 (默认100)
    ttl      Duration // 缓存TTL (默认60秒)
}

type CacheEntry struct {
    Query      string
    Results    []SearchResult
    Engines    []string  // 来源引擎
    CreatedAt  time.Time
    HitCount   int
}
```

### SQLite 持久缓存

利用 s-forge 已有的 SQLite 数据库，复用笔记库的表结构：

```sql
CREATE TABLE search_cache (
    query_hash TEXT PRIMARY KEY,     -- SHA256(归一化查询)
    query      TEXT NOT NULL,        -- 原始查询
    engine     TEXT NOT NULL,        -- 来源引擎
    results    TEXT NOT NULL,        -- JSON 序列化的结果
    created_at INTEGER NOT NULL,     -- Unix时间戳
    hit_count  INTEGER DEFAULT 1,
    ttl        INTEGER DEFAULT 3600  -- TTL秒数
);
CREATE INDEX idx_search_cache_created ON search_cache(created_at);
```

### 缓存策略

| 缓存层 | 容量 | TTL | 清理策略 |
|--------|------|-----|---------|
| 内存 LRU | 100 条 | 60s | 满时淘汰最久未命中 |
| SQLite | 10000 条 | 1h | 定时清理过期(后台协程) |

## 二、熔断器

### 引擎级别熔断

```go
// circuit_breaker.go
type CircuitState int
const (
    CircuitClosed   CircuitState = iota  // 正常
    CircuitHalfOpen                       // 半开(试探)
    CircuitOpen                           // 断开
)

type EngineBreaker struct {
    state        CircuitState
    failures     int
    threshold    int          // 连续失败次数阈值 (默认3)
    timeout      Duration     // 断开后恢复时间 (默认1min)
    lastFailure  time.Time
    halfOpenTest time.Time
}
```

### 熔断流程

```
引擎连续失败 3 次
    ↓
熔断器 Open (1分钟内不请求该引擎)
    ↓
1分钟后 → HalfOpen (试探性发一次请求)
    ↓
成功 → Closed (恢复)
失败 → Open (再等1分钟，指数退避 1min→5min→15min)
```

## 三、反爬策略

### User-Agent 轮换

```go
var userAgents = []string{
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...",
    // 随机选择一个
}
```

### 请求间隔

```go
type RateLimiter struct {
    mu       sync.Mutex
    lastCall map[string]time.Time  // engine → last call time
    minInterval Duration           // 最小间隔 (默认 500ms)
}

func (r *RateLimiter) Wait(engine string) {
    r.mu.Lock()
    last := r.lastCall[engine]
    elapsed := time.Since(last)
    if elapsed < r.minInterval {
        time.Sleep(r.minInterval - elapsed)
    }
    r.lastCall[engine] = time.Now()
    r.mu.Unlock()
}
```

### 代理支持

读取系统代理环境变量 `HTTP_PROXY`/`HTTPS_PROXY`，搜索请求走代理：

```go
func proxyTransport() *http.Transport {
    proxyURL := os.Getenv("HTTPS_PROXY")
    if proxyURL == "" {
        proxyURL = os.Getenv("HTTP_PROXY")
    }
    if proxyURL == "" {
        // 检测常见代理端口
        for _, port := range []int{7890, 1080, 8080} {
            if checkPort(port) {
                proxyURL = fmt.Sprintf("http://127.0.0.1:%d", port)
                break
            }
        }
    }
    return &http.Transport{Proxy: http.ProxyURL(mustURL(proxyURL))}
}
```

## 四、结果聚合与评分

### 评分公式

```
score = Σ(engine_weight × position_bonus × time_decay)

engine_weight = 引擎基础权重 (DuckDuckGo=1.0, Bing=0.9, 百度中文=0.8)
position_bonus = max(0, 10 - position) / 10  (越靠前越高)
time_decay = 1.0 (通用), 0.8 (新闻7天前)
```

### 去重逻辑

```
1. URL 去重: 归一化URL后比较
2. 标题模糊去重: Levenshtein 距离 < 5 视为重复
3. 合并: 重复条目的 engines 合并, score 累加
```

## 五、性能指标

| 指标 | 目标 |
|------|------|
| 首次搜索延迟 | < 3s (3引擎并发) |
| 缓存命中搜索延迟 | < 10ms |
| 缓存命中率 | > 60% (重复查询) |
| 引擎可用性 | > 99% (熔断保护) |
| 内存占用 | < 50MB |
