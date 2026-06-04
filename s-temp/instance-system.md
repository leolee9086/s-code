# 实例系统

## 整体架构

opencode 为每个项目目录创建一个"实例"（instance），包含该项目所需的所有服务。

```
opencode run          ← effectCmd
  → InstanceStore.load(directory)
    → InstanceBootstrap.run
      → 初始化所有 per-instance 服务
    → InstanceContext { directory, worktree, project }
    → 通过 InstanceRef 提供到 Effect 上下文
```

## AppRuntime

定义在 `packages/opencode/src/effect/app-runtime.ts`。

```ts
AppLayer = Layer.mergeAll(
  Npm, AppFileSystem, Database, Auth, Config,
  Git, Ripgrep, File, FileWatcher, Snapshot, Plugin,
  Provider, Agent, Skill, Question, Permission, Todo,
  Session, SessionStatus, SessionProcessor, SessionCompaction,
  SessionPrompt, Instruction, LLM, LSP, MCP, Command,
  ToolRegistry, Format, Project, Vcs, Reference, Workspace,
  ...等等 30+ 服务层,
  InstanceLayer.layer,     // 实例管理
  Observability.layer,     // 可观测性
)
AppRuntime = ManagedRuntime.make(AppLayer, { memoMap })
```

`AppRuntime` 提供 `runSync/runPromise/runFork/runCallback`。所有命令行 handler 通过 `AppRuntime.runPromise(effect)` 执行。

### attach 机制

`app-runtime` 重写 `runPromise`，自动调用 `attach(effect)`，将当前 fiber 的 `InstanceRef` 和 `WorkspaceRef` 注入到新 Effect 的上下文。

## InstanceStore

定义在 `packages/opencode/src/project/instance-store.ts`。

核心职责：管理 per-directory 实例的加载、缓存、释放。

### 加载流程

```ts
load(directory)
  → 检查 cache 中是否已有该 directory 的记录
  → 无 → 创建 Entry { deferred }
  → fork boot fiber:
    → project.fromDirectory(directory)
      → 从 git 或文件系统读取项目信息
      → 返回 { sandbox(worktree路径), project(项目信息) }
    → InstanceBootstrap.run
      → 初始化子系统
    → 通过 deferred 返回 InstanceContext
  → 返回 await deferred
```

### 释放流程

```ts
dispose(ctx)
  → runDisposers(directory)      // 运行所有 InstanceState 的 disposer
  → emitDisposed(directory)      // 发送 server.instance.disposed 事件
  → 从 cache 删除
```

### 核心数据结构

```ts
interface InstanceContext {
  directory: string   // 项目实际工作目录
  worktree: string    // git worktree 根（非 git 项目为 "/"）
  project: Project.Info  // 项目元信息
}
```

## InstanceBootstrap

定义在 `packages/opencode/src/project/bootstrap.ts`。

每个实例启动时执行的初始化：

```ts
InstanceBootstrap.run:
  1. config.get()           // 加载配置
  2. plugin.init()          // 初始化插件（插件可能修改配置）
  3. 并行初始化所有子系统:
     - reference.init()    // 引用系统（文件/代码引用）
     - lsp.init()          // LSP 语言服务器
     - shareNext.init()    // 一键分享
     - format.init()       // 格式化
     - file.init()         // 文件操作
     - fileWatcher.init()  // 文件监听
     - vcs.init()          // 版本控制
     - snapshot.init()     // 快照
     - project.init()      // 项目
```

每个 `init()` 内部使用 `Effect.forkDetach` 启动后台服务，所以不阻塞启动流程。

## InstanceLayer

定义在 `packages/opencode/src/project/instance-layer.ts`。

```ts
layer = Layer.unwrap(
  Effect.promise(async () => {
    const { InstanceBootstrap } = await import("./bootstrap")
    return InstanceStore.defaultLayer.pipe(
      Layer.provide(InstanceBootstrap.defaultLayer)
    )
  }),
)
```

懒加载 `bootstrap.ts`（因为它的依赖图很大，不想在模块加载时就解析）。

## InstanceState（Instance-level 缓存）

定义在 `packages/opencode/src/effect/instance-state.ts`。

每个服务可以把 per-directory 状态缓存在 `InstanceState` 中：

```ts
type State = { ... }
const state = yield* InstanceState.make<State>((ctx) =>
  // ctx.directory 作为 cache key
  Effect.gen(function* () { return { ... } })
)

// 读取
const s = yield* InstanceState.get(state)
const val = yield* InstanceState.use(state, (s) => s.field)
```

特性：
- 以 `directory` 为 key，自动避免重复初始化
- 目录被 dispose 时自动执行 finalizer 清理
- 通过 `ScopedCache` 实现

用于：ToolRegistry、Agent、Command、Config、Session、Permission、BackgroundJob 等。

## 实例生命周期

```
effectCmd handler start
  │
  ├─ InstanceStore.load(directory)     ← 创建实例
  │    ├─ project.fromDirectory()
  │    ├─ InstanceBootstrap.run()
  │    └─ 提供 InstanceRef
  │
  ├─ 执行 handler 逻辑
  │    ├─ 所有 Effect 自动获得 InstanceRef
  │    ├─ 可 yield 任何 AppServices
  │    └─ Effect.ensuring(store.dispose(ctx))  ← 自动释放
  │
  └─ handler 退出
       └─ store.dispose(ctx)
            ├─ runDisposers(directory)  ← 清理所有 InstanceState
            └─ emit IPC event
```
