# 永续模式实现安全审查报告

## 🔴 高风险（必须修复）

### R1: FileWatchDriver 事件监听器泄漏（OOM）

**位置：** [`packages/opencode/src/forever/condition.ts:39-78`](packages/opencode/src/forever/condition.ts:39-78)

**当前代码：**
```typescript
init(config, notify) {
  // ...
  const sub = yield* svc.listen((event) => { ... })
  self.unsubscribe = sub    // 赋值了
}

dispose() {
  // 只清空标记，没有调用 self.unsubscribe
  this.dirty = false
  this.fileWatchPaths = []
}
```

**问题：** 每次进入永续模式调用 `init()` 注册一个 `EventV2Bridge` 订阅，但 `dispose()` 从未取消订阅。每次 init → dispose 循环都泄漏一个闭包引用。长时间运行下订阅者无限增长，导致 OOM。

**修复：**
```typescript
dispose(): Effect.Effect<void> {
  if (this.unsubscribe) {
    Effect.runFork(this.unsubscribe)  // 取消订阅
    this.unsubscribe = undefined
  }
  this.dirty = false
  this.fileWatchPaths = []
}
```

---

### R2: 条件唤醒不闭环（功能失效）

**位置：** [`packages/opencode/src/forever/condition.ts:175`](packages/opencode/src/forever/condition.ts:175)

**当前代码：**
```typescript
yield* driver.init(driverConfig, () => {})  // notify 是空函数
```

**问题：** FileWatchDriver 和 TimerDriver 检测到条件满足时调用 `notify()`，但 `notify()` 是空函数，什么都没有做。

自动恢复路径在 [`prompt.ts:1771-1791`](packages/opencode/src/session/prompt.ts:1771-1791) 的 `loop()` 函数中——只有当外部程序调用 `prompt()` 创建新的 user message 时，`loop()` 才会执行。条件引擎的 `dirty` 标记虽然为 true，但没有代码去驱动新一轮循环。

**修复方案（选择一种）：**

**方案 A（推荐）：** 在 `notify()` 中通过 EventV2Bridge 发布事件，然后在 `prompt()` 或 session 层面监听并唤醒：

```typescript
// condition.ts
const events = yield* EventV2Bridge.Service
const notify = () => {
  Effect.runFork(
    events.publish(Event.ConditionMet, { source: "condition_engine" })
  )
}
```

```typescript
// prompt.ts 或其他地方监听事件
yield* events.listen((event) => {
  if (event.type !== Event.ConditionMet.type) return Effect.void
  // 触发对应的 session 自动唤醒来一轮
  return Effect.forkScoped(prompt({ sessionID: data.sessionID }))
})
```

**方案 B（轻量）：** `notify()` 直接调用 `Forever.Service.resolvePrompt()` 并注入续行消息：

```typescript
const notify = () => {
  // 读取暂停状态找到对应的 sessionID
  // 然后 createContinueUserMessage(sessionID, prompt)
  // 最后调用 state.ensureRunning(sessionID, ...)
}
```

---

## 🟡 中风险（建议修复）

### R3: `runLoop` 中 `step` 无界增长 + Budget 不在环内检查

**位置：** [`packages/opencode/src/session/prompt.ts:1381` 和 `1437`](packages/opencode/src/session/prompt.ts:1437)

**当前代码：**
```typescript
let step = 0
while (true) {
  step++
```

Budget 检查只在 [`loop()` 入口](packages/opencode/src/session/prompt.ts:1778) 执行，但一旦进入 `runLoop`，step 不再受 `max_rounds` 控制。

**修复：** 在 runLoop 顶部添加 budget 检查：

```typescript
// 每次循环开始时
const budgetCheck = yield* forever.checkBudget(sessionID)
if (!budgetCheck.allowed) {
  yield* slog.warn("forever budget exceeded in runLoop", { reason: budgetCheck.reason })
  break
}
```

### R4: 消息无限积累（磁盘 OOM）

**位置：** `prompt.ts:1682` 附近

**当前代码：**
```typescript
if (injectDecision.parts.length > 0) {
  // 注入新消息后 return "continue"
  return "continue" as const     // ← 跳过 compaction
}
```

**问题：** `loop.inject` 分支在注入续行消息后直接 `return "continue"`，跳过了后续的 compaction 检查（第 1685-1693 行）。在永续模式的长时间运行中，SQLite 中的消息数量线性增长，compaction 从不触发。

**修复：** 在 inject 分支后也检查 overflow 条件：

```typescript
if (injectDecision.parts.length > 0) {
  // 注入续行消息...
  // 检查是否需要 compaction
  if (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model })) {
    yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
  }
  return "continue" as const
}
```

---

## 🟢 低风险（可优化，不影响运行）

### R5: `stateDir()` 每次 I/O 都同步遍历目录

**位置：** [`packages/opencode/src/forever/state.ts:39-58`](packages/opencode/src/forever/state.ts:39-58)

每次 `persistPauseState` / `readPauseState` 都调用 `stateDir()` 做 `for` 循环 + `existsSync`。建议在第一次调用后缓存路径。

**修复：** 添加惰性初始化的缓存：

```typescript
let cachedStateDir: string | null = null
function stateDir(): string {
  if (cachedStateDir) return cachedStateDir
  // ... 原有查找逻辑 ...
  cachedStateDir = result
  return result
}
```

### R6: `loop.inject` 后双重注入（已修复）

**位置：** `prompt.ts:1662`

当前代码已有 `return "continue" as const`，所以不会继续执行到后续的 suffix 注入和 roundHandler。无需修复。

### R7: 永续模式默认 `shouldContinue: false`，必须依赖插件覆盖

**位置：** [`prompt.ts:1419`](packages/opencode/src/session/prompt.ts:1419)

```typescript
shouldContinue: isForeverMode ? false : ...
```

这意味着：**如果没有插件注册 `loop.continue` Hook，永续模式永远不循环。** 这是设计上的选择——永续模式必须有外界驱动。但如果条件引擎唤醒了，但没有插件处理，循环不会继续。建议在 `Forever.Service` 内部注册默认的 `loop.continue` Hook 来处理条件引擎唤醒：

```typescript
// 当 isForeverMode=true 且条件引擎标记了 dirty 时，返回 shouldContinue=true
```

---

## 紧急度排序

| 优先级 | # | 修复难度 | 影响 |
|--------|---|---------|------|
| P0 | R1 | 3 行 | 防止 OOM |
| P0 | R2 | 约 20 行 | 让自动唤醒真正工作 |
| P1 | R3 | 约 5 行 | 确保 Budget 约束有效 |
| P1 | R4 | 约 5 行 | 防止磁盘无限增长 |
| P2 | R5 | 约 3 行 | 性能优化 |
| P2 | R7 | 约 10 行 | 让永续模式无需插件也能基本工作 |
