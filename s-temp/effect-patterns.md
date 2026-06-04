# Effect 模式总结

## 1. Service 定义模式

```ts
// 1. 定义接口
export interface Interface {
  readonly doSomething: (input: X) => Effect.Effect<Y>
}

// 2. 创建 Service 标识
export class Service extends Context.Service<Service, Interface>()("@opencode/MyService") {}

// 3. 实现层
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const depA = yield* DepA.Service
    return Service.of({
      doSomething: Effect.fn("MyService.doSomething")(function* (input: X) {
        // implementation
      }),
    })
  }),
)

// 4. 默认层（提供所有依赖）
export const defaultLayer = layer.pipe(
  Layer.provide(DepA.defaultLayer),
  ...
)
```

## 2. InstanceState（per-directory 状态）

```ts
// 每个项目目录一份独立状态，懒初始化，自动清理
type State = { ... }
const state = yield* InstanceState.make<State>((ctx) =>
  Effect.gen(function* () {
    // ctx.directory = 项目目录
    return { ... }
  })
)

// 读取状态
const s = yield* InstanceState.get(state)
const val = yield* InstanceState.use(state, (s) => s.someField)
```

用于：ToolRegistry、Agent、Command、Config、Session、BackgroundJob 等。

## 3. makeRuntime（Effect 运行时）

```ts
// src/effect/run-service.ts
const runtime = makeRuntime(Service, defaultLayer)
runtime.runSync((svc) => svc.method())
runtime.runPromise((svc) => svc.method())
runtime.runFork((svc) => svc.method())
runtime.runCallback((svc) => svc.method())
```

底层使用 `ManagedRuntime.make(Layer.provideMerge(layer, Observability.layer), { memoMap })`。

## 4. EffectBridge（回调桥接）

用于将原生回调/事件转换为 Effect：

```ts
const bridge = yield* EffectBridge.make()
source.on("data", (data) => bridge.fork(Effect.succeed(data)))
const data = yield* bridge.promise(...)
```

## 5. RuntimeFlags（特性开关）

```ts
// 所有 flag 通过环境变量配置
class Service extends ConfigService.Service<Service>()("@opencode/RuntimeFlags", {
  enableFeature: bool("OPENCODE_FEATURE"),       // 默认 false
  experimentalFeature: enabledByExperimental(...), // 随 OPENCODE_EXPERIMENTAL=1 启用
})
```

## 6. 命名约定

- `Effect.fn("Domain.method")` — 命名且追踪的 effect
- `Effect.fnUntraced` — 内部辅助 effect（减少开销）
- `Effect.gen(function* () { ... })` — 生成器组合
- `yield* new MyError(...)` — 提前失败（而不是 `yield* Effect.fail(...)`）

## 7. HHTP API 路由模式

```ts
// 定义端点（groups/）
const MyApi = HttpApi.make("my")
  .add(HttpApiEndpoint.get("list", "/items", { ... }))

// 实现 handler（handlers/）
export const myHandlers = HttpApiBuilder.group(MyApi, "my", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* SomeService.Service
    return handlers.handle("list", () => svc.list())
  }),
)

// 注册到 server（server.ts）
const routes = HttpApiBuilder.layer(MyApi).pipe(
  Layer.provide(myHandlers),
  Layer.provide(...),
)
```

## 8. 工具注册模式

```ts
// 定义工具
export const MyTool = Tool.define(
  "my-tool",
  Effect.gen(function* () {
    const dep = yield* SomeService.Service
    return {
      description: "...",
      parameters: Schema.Struct({ ... }),
      execute: (args, ctx) => Effect.gen(function* () { ... }).pipe(Effect.orDie),
    }
  }),
)

// 注册（registry.ts）
const mytool = yield* MyTool
tool.mytool = Tool.init(mytool)
builtin: [ ..., tool.mytool ]
```
