# S-Code vs S-Forge 外部消息能力对比（基于实际源码）

## s-forge 的消息流

```
外部消息 → ChannelAdapter.Start() 监听
         ↓
         Bridge.Push(ctx, InboundMessage)
         ↓
         handler (coordinator) → Sage (LLM)
                                  ↓
                                  Sage 完成思考
                                  ↓
                                  调用 send_channel_message 工具
                                  ↓
                                  executeSendChannelMessage()
                                  ↓
                                  channel.Get(channelID) → adapter.SendMessage(ctx, msg)
                                  ↓
                                  外部渠道（微信/Discord/Telegram等）
```

**关键组件（全部存在）：**

| 组件 | 位置 | 功能 |
|------|------|------|
| `ChannelAdapter` 接口 | `channel/adapter.go:22-36` | `ID()` `Start()` `Stop()` `SendMessage()` `Status()` `Capabilities()` |
| `Registry` 全局单例 | `channel/registry.go:5-45` | `Register()` `Unregister()` `Get()` `All()` |
| `Bridge` 全局桥接器 | `channel/bridge.go:11-39` | `SetHandler()` `Push()` — 入站消息路由到 MAGI |
| `send_channel_message` 工具 | `coordinator/send_channel_message.go` | Sage 调用此工具回复消息 |
| 微信适配器 | `channel/wechat/adapter.go` | 具体实现 ✅ |

## s-code 当前状态

```
外部消息 → POST /queue/message → RingQueue.push()
                                  ↓
                                  runDispatcher 弹出
                                  ↓
                                  handler → SessionMapper.resolve(token) → undefined
                                  ↓
                                  丢弃消息（无日志可追溯）
```

**关键缺失（与 s-forge 对比）：**

### 1. `bridge.go` — 全局消息桥接器（不存在）

s-forge 的 `Bridge` 是一个**全局单例**，`ChannelAdapter` 的入站消息通过 `Bridge.Push()` 路由到 `Coordinator`（即 LLM session）。

s-code **没有 Bridge**。`RingQueue` + `Dispatcher` 试图扮演类似角色，但 dispatcher 的 handler 无法路由消息（`sessionMapper.resolve()` 永远返回 `undefined`）。即使正确路由，也只注入 `setSuffixOnce()`，**没有「打断当前 LLM」路径。**

### 2. `send_channel_message` 工具（不存在）

s-forge 的 Sage（LLM）通过 `send_channel_message` 工具回复外部消息。这个工具在 `send_channel_message.go` 中实现：
- 接收 `channelId` `accountId` `userId` `content` `motivation` 参数
- 调用 `channel.Get(channelId)` 查找适配器
- 调用 `adapter.SendMessage(ctx, msg)` 发送

s-code **没有任何工具允许 LLM 向外部通道发送消息。** 即使外部消息能进入 LLM loop，LLM 的回复也只写入 session messages，没有返回路径。

### 3. `registry.go` 的全局路由（未集成）

s-forge 的 `Registry` 是全局单例，`send_channel_message` 直接 `channel.Get(channelID)` 查找适配器。

s-code 的 `registry.ts` 定义了 `RegistryInterface` 和 `RegistryService` Context，但：
- 未注册到任何 Layer
- 无默认 Layer
- 无人调用 `get(id)` 查找适配器
- `adapter.ts` 的 `ChannelAdapter` 接口完整性 ✅ 但无使用者

### 4. LLM 响应无回传路径（最大的架构缺失）

s-forge 的完整消息环：
```
外部 → Bridge.Push → Sage LLM → send_channel_message → ChannelAdapter.SendMessage → 外部
```

s-code 的当前消息环：
```
外部 → Queue.push → LLM loop → 只写 session messages → 消息丢失
```

LLM 产生响应后，**没有任何代码将响应送回消息来源。** 没有 `adapter.SendMessage()` 调用，没有响应队列，没有回调机制。

## 总结

| 能力 | s-forge | s-code |
|------|---------|--------|
| 入站消息路由 | `Bridge.Push → handler` | `RingQueue + Dispatcher`（但 session 映射断链） |
| 出站消息发送 | `send_channel_message` 工具 | **不存在** |
| Adapter 注册 | `registry.go` 全局单例 | `registry.ts` 定义完整但未集成 |
| Adapter 接口 | `ChannelAdapter` 完整 | `adapter.ts` 对齐 ✅ |
| 打断 LLM | 无需打断（Sage 在线程中等待） | **Ring 0 打断不存在** |
| 消息响应环 | 完整环 | **断在 LLM 输出侧** |
