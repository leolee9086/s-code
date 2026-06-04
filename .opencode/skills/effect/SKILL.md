---
name: effect
description: Work with Effect v4 / effect-smol TypeScript code in this repo
---

# Effect

本代码库使用 Effect 实现类型安全、可组合的 TypeScript 服务、schema 和工作流。

## 权威来源

使用当前的 Effect v4 / effect-smol 源码，不要依赖记忆或旧版 Effect v2/v3 示例。

1. 如果 `.opencode/references/effect-smol` 不存在，在那里克隆 `https://github.com/Effect-TS/effect-smol`。在项目目录下执行，不要在 skill 文件夹内。
2. 回答或实现 Effect 相关代码前，先在 `.opencode/references/effect-smol` 中搜索确切的 API、示例、测试和命名模式。
3. 引入新模式前，同时检查仓库现有代码的本地风格。
4. 优先选择有具体源文件或附近仓库示例支撑的答案和实现。

## 指导原则

- 优先使用当前的 Effect v4 API 和项目本地模式，而不是旧的博客文章、示例或包记忆猜测。
- 使用 `Effect.gen(function* () { ... })` 编写多步骤工作流。
- 添加可复用的服务方法或重要工作流时，使用 `Effect.fn("Name")` 或 `Effect.fnUntraced(...)` 命名 effect。
- 优先使用 Effect `Schema` 定义 API 和领域数据形状。对 ID 使用 branded schema，对新的错误面使用 `Schema.TaggedErrorClass` 定义类型化领域错误。
- 保持 HTTP handler 精简：解码输入、读取请求上下文、调用服务、映射传输错误。业务规则放在服务层。
- 在 Effect 服务代码中，如果周围代码已在使用，优先使用 Effect 感知的平台抽象和依赖，而不是临时 promise。
- 保持 layer 组合显式。避免宽泛的隐藏提供，让缺失依赖难以发现。
- 测试中，优先使用仓库已有的 Effect 测试助手和针对文件系统、git、子进程、锁或时序行为的 live 测试。
- 不要为了满足类型而引入 `any`、非空断言、未检查的转换或旧版 Effect API。
- 不要凭记忆回答。先在 `.opencode/references/effect-smol` 或附近代码中验证。

## 测试模式

- 使用 `packages/opencode/test/lib/effect.ts` 的 `testEffect(...)` 测试 Effect 服务、layer、运行时上下文、作用域资源或平台集成。
- 对文件系统、git 仓库、HTTP 服务器、socket、子进程、锁、真实时间和其他实时平台行为，使用 `it.live(...)`。
- 从包目录（如 `packages/opencode`）运行测试；切勿从仓库根目录运行包测试。
- 优先使用显式测试 layer，而不是临时托管运行时。保持依赖提供在测试文件中可见。
- 使用作用域 fixture 和 finalizer 清理需要释放的资源，包括临时目录、flag、数据库、fiber、服务器和全局状态。
