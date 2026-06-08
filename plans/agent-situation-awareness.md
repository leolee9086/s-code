# Agent 态势感知增强方案

## 现状

当前 `SystemPrompt.environment()` 只提供 5 个字段：
```
工作目录
工作区根目录
是否为 git 仓库
平台
当前日期
```

agent 对自己的运行环境几乎一无所知——不知道数据库在哪、日志在哪、自己的二进制在哪、是源码还是编译启动的、当前 session 的上下文。

## 需要增加的态势信息

### 1. 进程与二进制信息

```typescript
`<process>`,
`  启动方式：${Installation.isLocal() ? "源码(bun run dev)" : "二进制"}`,
`  二进制路径：${process.execPath}`,
`  运行 ID：${process.env.OPENCODE_RUN_ID ?? "未知"}`,
`  进程角色：${process.env.OPENCODE_PROCESS_ROLE ?? "main"}`,
`  进程 PID：${process.pid}`,
`</process>`,
```

### 2. 数据库信息

```typescript
`<database>`,
`  数据库路径：${Database.path()}`,
`  数据库渠道：${getDatabaseChannel()}`,
`  数据库文件存在：${await Filesystem.exists(Database.path())}`,
`</database>`,
```

### 3. 日志与存储路径

```typescript
`<paths>`,
`  数据目录：${Global.Path.data}`,
`  日志文件：${Log.file()}`,
`  缓存目录：${Global.Path.cache}`,
`  临时目录：${Global.Path.tmp}`,
`</paths>`,
```

### 4. 进化模式上下文

```typescript
`<evolve>`,
`  进化模式：${isEvolveMode() ? "激活" : "未激活"}`,
`  进化临时目录：${process.env.S_CODE_TEMP ?? "无"}`,
`  进化轮次：${readEvolveRound()}`,
`</evolve>`,
```

### 5. Session 统计信息

```typescript
`<session>`,
`  Session ID：${sessionID}`,
`  父 Session ID：${session.parentID ?? "无（根 session）"}`,
`  接续次数（子 session 数量）：${(yield* sessions.children(sessionID)).length}`,
`  Session 版本：${session.version}`,
`</session>`,
```

### 6. 代码版本与构建信息

```typescript
`<build>`,
`  版本：${InstallationVersion}`,
`  渠道：${InstallationChannel}`,
`  git 分支：${await gitBranch()}`,
`  git commit：${await gitCommit()}`,
`</build>`,
```

## 实现方案

修改 `packages/opencode/src/session/system.ts` 的 `environment` 方法，增加上述信息。

### 性能考虑

部分数据需要异步获取（git branch/commit、children count），应使用 `Effect` 组合且允许失败：

```typescript
environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
  const ctx = yield* InstanceState.context
  const sessions = yield* Session.Service
  const childrenCount = sessionID
    ? sessions.children(sessionID).pipe(Effect.map(c => c.length), Effect.catch(() => Effect.succeed(0)))
    : Effect.succeed(0)
  // ...compose all blocks
})
```

### 输出格式

对 LLM 友好的结构化格式（已有 `<env>` 标签风格），每类信息用独立标签包裹以便 LLM 解析。

```xml
<env>
  <process>
    启动方式：源码(bun run dev)
    二进制路径：C:\Users\...\bun.exe
    运行 ID：abc123
    进程角色：main
    进程 PID：12345
  </process>
  <database>
    数据库路径：C:\Users\...\opencode\opencode-local.db
    数据库渠道：local
  </database>
  ...
</env>
```
