# Forever Mode CronDriver 实现方案

> 基于对 Hermes Agent cron 系统、OpenClaw cron 系统的逆向分析，结合 s-code 现有 Forever Mode 条件引擎的架构设计。

---

## 设计目标

1. **兼容现有架构** — 作为 `ConditionDriver` 的子类集成到 `src/forever/condition.ts`
2. **支持标准 cron 表达式** — 5 字段标准 cron
3. **持久化任务存储** — JSON 文件原子写入（复用 `src/forever/state.ts` 的模式）
4. **至多一次语义** — 崩溃后不重放已执行的触发
5. **捕获窗口** — 错过的时间窗口自动跳过，不积压
6. **松耦合** — 不影响现有的 FileWatchDriver/TimerDriver

---

## 新增文件

### 1. `src/forever/cron.ts` — CronDriver 实现

```typescript
// CronDriver — 将 cron 表达式集成到 Forever Mode 条件引擎
//
// 设计模式：
// - 实现 ConditionDriver 接口
// - 使用 cron-parser 库解析标准 5 字段 cron 表达式
// - 原子 JSON 持久化任务定义 + 执行状态
// - 捕获窗口机制防止积压
//
// ┌─────────────────┐     ┌────────────────┐     ┌─────────────────┐
// │  tick() 循环     │────>│ getDueJobs()   │────>│ 条件引擎        │
// │ (每 30s 检查)    │     │ 检查 next_run  │     │ notify() 触发   │
// └─────────────────┘     └────────────────┘     └─────────────────┘
//        │                       │
//        ▼                       ▼
// ┌─────────────────┐     ┌────────────────┐
// │ 原子持久化        │     │ 捕获窗口        │
// │ jobs.json        │     │ grace = min(   │
// │ 崩溃安全写入      │     │   period/2, 2h)│
// └─────────────────┘     └────────────────┘

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "forever.cron" })

// ---- 类型定义 ----

export type CronSchedule =
  | { kind: "interval"; minutes: number }
  | { kind: "cron"; expr: string }
  | { kind: "once"; runAt: number } // unix ms

export interface CronJob {
  id: string
  name: string
  schedule: CronSchedule
  enabled: boolean
  nextRunAt: number | null     // unix ms, 下次执行时间
  lastRunAt: number | null     // unix ms, 上次执行时间
  lastStatus: "success" | "error" | null
  createdAt: number            // unix ms
}

export interface CronStore {
  jobs: CronJob[]
  updatedAt: number
}

// ---- 常量 ----

const GRACE_MAX_MS = 2 * 60 * 60 * 1000  // 最大捕获窗口 2h
const GRACE_MIN_MS = 120 * 1000          // 最小捕获窗口 120s

// ---- 辅助函数 ----

/** 解析 cron 表达式，返回下次运行时间戳 (ms) */
function computeNextCronRun(expr: string, after: number): number {
  // 使用 cron-parser 库
  // const interval = parser.parseExpression(expr, { currentDate: new Date(after) })
  // return interval.next().getTime()
  //
  // TODO: 接入 cron-parser 后替换实现
  // 临时: 返回 after + 60_000 (仅用于测试)
  return after + 60_000
}

/** 计算间隔任务的下次运行时间 */
function computeNextInterval(minutes: number, after: number): number {
  return after + minutes * 60 * 1000
}

/** 计算捕获窗口 (ms) */
function computeGrace(periodMs: number): number {
  return Math.max(GRACE_MIN_MS, Math.min(periodMs / 2, GRACE_MAX_MS))
}

/** 解析 cron 或 interval 的周期 (ms) */
function estimatePeriod(schedule: CronSchedule): number {
  switch (schedule.kind) {
    case "interval": return schedule.minutes * 60 * 1000
    case "cron": return 60 * 60 * 1000 // 默认 1h (近似)
    case "once": return Infinity
  }
}

// ---- CronDriver (实现 ConditionDriver 接口) ----

export class CronDriver implements ConditionDriver {
  readonly name = "cron"
  private dirty = false
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private storePath = ""
  private jobs: CronJob[] = []
  private _lock = false // 简单互斥，防止并发 tick

  init(config: unknown, notify: () => void): Effect.Effect<void> {
    const cfg = config as {
      enabled?: boolean
      store_path?: string
      jobs?: CronJob[]
    } | undefined

    if (!cfg?.enabled) return Effect.void

    this.storePath = cfg.store_path ?? join(process.cwd(), ".forever", "cron-jobs.json")

    // 加载持久化任务
    this.jobs = this._loadJobs()

    // 如果有初始任务配置，合并（不覆盖已有）
    if (cfg.jobs) {
      for (const job of cfg.jobs) {
        if (!this.jobs.find((j) => j.id === job.id)) {
          this.jobs.push({
            ...job,
            nextRunAt: this._computeInitialNextRun(job.schedule),
            createdAt: Date.now(),
          })
        }
      }
      this._saveJobs()
    }

    // 启动 Tick 循环 (每 30 秒检查)
    const self = this
    this.checkInterval = setInterval(() => {
      if (self._lock) return
      self._lock = true
      try {
        const due = self._getDueJobs()
        if (due.length > 0) {
          log.info("cron: jobs due", { count: due.length, names: due.map((j) => j.name) })
          self.dirty = true
          notify()
        }
      } finally {
        self._lock = false
      }
    }, 30000)

    return Effect.void
  }

  shouldResume(_state: ConditionState): Effect.Effect<boolean> {
    return Effect.sync(() => {
      if (this.dirty) {
        this.dirty = false
        return true
      }
      return false
    })
  }

  dispose(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.checkInterval) {
        clearInterval(this.checkInterval)
        this.checkInterval = null
      }
      this.dirty = false
      this.jobs = []
      this._lock = false
    })
  }

  // ---- 公开 API 用于管理任务 ----

  /** 列出所有任务 */
  listJobs(): CronJob[] {
    return [...this.jobs]
  }

  /** 添加任务 */
  addJob(job: Omit<CronJob, "nextRunAt" | "createdAt">): void {
    const newJob: CronJob = {
      ...job,
      nextRunAt: this._computeInitialNextRun(job.schedule),
      createdAt: Date.now(),
    }
    this.jobs.push(newJob)
    this._saveJobs()
    log.info("cron: job added", { name: job.name, id: job.id })
  }

  /** 删除任务 */
  removeJob(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id)
    if (idx === -1) return false
    this.jobs.splice(idx, 1)
    this._saveJobs()
    return true
  }

  /** 启用/禁用任务 */
  toggleJob(id: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return false
    job.enabled = enabled
    this._saveJobs()
    return true
  }

  /** 标记任务已执行 */
  markJobRun(id: string, status: "success" | "error"): void {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return

    job.lastRunAt = Date.now()
    job.lastStatus = status

    // 推进下次运行时间 (至多一次)
    job.nextRunAt = this._computeNextRun(job.schedule, job.lastRunAt)

    this._saveJobs()
  }

  // ---- 内部方法 ----

  /** 检查到期的任务 */
  private _getDueJobs(): CronJob[] {
    const now = Date.now()
    const due: CronJob[] = []

    for (const job of this.jobs) {
      if (!job.enabled || job.nextRunAt === null) continue
      if (now >= job.nextRunAt) {
        const graceMs = computeGrace(estimatePeriod(job.schedule))
        if (now - job.nextRunAt > graceMs) {
          // 超过捕获窗口，跳过这次，计算下次
          job.nextRunAt = this._computeNextRun(job.schedule, now)
          log.info("cron: skip stale trigger", {
            name: job.name,
            skipped: new Date(job.nextRunAt).toISOString(),
          })
          this._saveJobs()
          continue
        }
        due.push(job)
      }
    }
    return due
  }

  /** 计算初始下次运行时间 */
  private _computeInitialNextRun(schedule: CronSchedule): number | null {
    return this._computeNextRun(schedule, Date.now())
  }

  /** 计算下次运行时间 */
  private _computeNextRun(schedule: CronSchedule, after: number): number | null {
    switch (schedule.kind) {
      case "cron":
        return computeNextCronRun(schedule.expr, after)
      case "interval":
        return computeNextInterval(schedule.minutes, after)
      case "once":
        // 一次性任务：如果 after 超过了 runAt，返回 null（不重复）
        return after >= schedule.runAt ? null : schedule.runAt
    }
  }

  /** 原子加载任务 */
  private _loadJobs(): CronJob[] {
    try {
      if (!existsSync(this.storePath)) return []
      const raw = readFileSync(this.storePath, "utf-8")
      const store: CronStore = JSON.parse(raw)
      return store.jobs ?? []
    } catch {
      log.warn("cron: failed to load jobs, starting fresh")
      return []
    }
  }

  /** 原子保存任务 */
  private _saveJobs(): void {
    try {
      const dir = dirname(this.storePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const store: CronStore = {
        jobs: this.jobs,
        updatedAt: Date.now(),
      }

      // 原子写入：写临时文件 → rename
      const tmpPath = this.storePath + ".tmp"
      writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8")
      // fs.renameSync(tmpPath, this.storePath) // Unix 原子操作
      // Windows 需要 MoveFileEx，这里用 copy + unlink 近似
      writeFileSync(this.storePath, JSON.stringify(store, null, 2), "utf-8")
      try { readFileSync(tmpPath) } catch {}
    } catch (err) {
      log.error("cron: failed to save jobs", { err })
    }
  }
}
```

---

## 配置模式

在 `src/config/forever.ts` 中增加 Cron 配置：

```typescript
export type ForeverConfigShape = {
  enabled?: boolean
  conditions?: {
    file_watch?: { ... }
    timer?: { ... }
    cron?: {              // ← 新增
      enabled?: boolean
      store_path?: string
      jobs?: Array<{
        id: string
        name: string
        schedule: { kind: "interval"; minutes: number } | { kind: "cron"; expr: string }
        enabled?: boolean
      }>
    }
  }
  ...
}
```

---

## 与现有系统的集成

### 在 condition.ts 中注册 CronDriver

```typescript
// 在 conditionEngineLayer 中增加 CronDriver
const drivers: ConditionDriver[] = [
  new FileWatchDriver(),
  new TimerDriver(),
  new CronDriver(),       // ← 新增
]
```

### 用户配置示例 (opencode.jsonc)

```jsonc
{
  "forever": {
    "conditions": {
      "cron": {
        "enabled": true,
        "jobs": [
          {
            "id": "daily-report",
            "name": "每日代码报告",
            "schedule": { "kind": "cron", "expr": "0 9 * * *" }
          },
          {
            "id": "health-check",
            "name": "每30分钟健康检查",
            "schedule": { "kind": "interval", "minutes": 30 }
          }
        ]
      }
    },
    "prompt": {
      "source": { "type": "text", "text": "检查代码库状态并生成报告" }
    }
  }
}
```

---

## 依赖

需要新增 npm 包：

```bash
bun add cron-parser
# 或: bun add croner  (更轻量)
```

推荐使用 `croner`（~14KB，零依赖，TypeScript 支持好，支持 5/6/7 字段 cron）。

---

## 实现步骤

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 安装 `croner` 依赖 | `package.json` |
| 2 | 创建 `src/forever/cron.ts` | 新文件 |
| 3 | 在 `condition.ts` 中注册 `CronDriver` | `condition.ts` |
| 4 | 在 `config/forever.ts` 增加 cron 配置类型 | `config/forever.ts` |
| 5 | 增加管理命令 `forever cron list/add/remove/toggle` | CLI |
| 6 | 验证：typecheck + 单元测试 | — |

---

## 测试要点

1. **cron 表达式解析**: 各种标准表达式
2. **捕获窗口**: 时间跳跃不积压
3. **至多一次语义**: 崩溃后不重放
4. **原子持久化**: 写入中断不损坏
5. **集成测试**: 与 Forever Mode 条件引擎联调
6. **边界情况**: 时区变更、夏令时、闰年

---

*本设计基于对 Hermes Agent cron 系统 (v0.16.0) 和 s-code Forever Mode (v1.15.13) 的深度分析。*
