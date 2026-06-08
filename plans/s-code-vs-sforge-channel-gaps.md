# S-Code vs S-Forge 消息通道差距分析（基于实际源码）

## s-forge 现有能力（`kernel/nerv/magi/channel/`）

| 组件 | 文件 | 功能 |
|------|------|------|
| `InboundMessage` / `OutboundMessage` | `types.go:4-46` | 消息信封类型 ✅ s-code 已有对齐 |
| `MediaAttachment` | `types.go:29-45` | 媒体附件 ✅ s-code 已有对齐 |
| `ChannelAdapter` 接口 | `adapter.go:22-36` | `Start/Stop/SendMessage/Status/TrustConfig/Capabilities` |
| `Bridge` | `bridge.go:11-39` | 全局桥接器，`Push(ctx, msg)` 入站消息 → 注册的 handler |
| 适配器注册表 | `registry.go` | `Get(id)/Set(adapter)` 管理多通道 |
| `send_channel_message` 工具 | `coordinator/send_channel_message.go` | Sage 通过此工具发送出站消息 |
| CLI 适配器 | `channel/cli/adapter.go` | 终端通道实现 |
| 微信适配器 | `channel/wechat/adapter.go` | 微信通道实现 |

## s-code 缺失

### 1. 无 `ChannelAdapter` 接口（缺出站发送能力）

s-forge 的 ChannelAdapter：
```go
type ChannelAdapter interface {
    ID() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
    SendMessage(ctx context.Context, msg *OutboundMessage) error  // ← 关键
    Status() ChannelStatus
    TrustConfig() *TrustConfig
    Capabilities() ChannelCapability
}
```

s-code `channel/types.ts` 有信封类型，但**无 Adapter 接口**。LLM 产生响应后无法通过适配器回写到消息来源通道（Discord/微信等）。

### 2. 无 `Bridge` 全局消息路由（缺入站分发）

s-forge 的 Bridge（`bridge.go:31-38`）：
```go
func (b *Bridge) Push(ctx context.Context, msg *InboundMessage) error {
    // 消息入站 → 路由到 Coordinator → Sage
}
```

s-code 的 RingQueue 可以类比 `Bridge.Push` 的「队列」部分，但两者有显著差异：

| 维度 | s-forge Bridge | s-code RingQueue + Dispatcher |
|------|---------------|-------------------------------|
| 消息来源 | 任意 ChannelAdapter | HTTP API（计划中） |
| 路由 | Coordinator handler | `DispatchHandler`（未实现） |
| 优先级 | 无（顺序处理） | Ring 0-3 分级 ✅ |
| 打断 | 无（Sage 已在线程中等消息） | 计划 Ring 0 打断 |
| 出站 | Sage 调用 `send_channel_message` → `adapter.SendMessage` | **完全缺失** |

### 3. 无 LLM 响应回写出站机制

s-forge 的完整消息流：
```
外部消息 → ChannelAdapter → Bridge.Push → Coordinator → Sage(LLM)
                                                              │
Sage 响应 → send_channel_message → ChannelAdapter.SendMessage → 外部
```

s-code 的现有流：
```
外部消息 → ??? → RingQueue → ??? → LLM loop
                                       │
LLM 响应 → 只写入 session messages → 丢失
```

LLM 产生响应后，s-code **没有任何路径将响应送回消息来源**。

### 4. 无适配器注册表

s-forge `registry.go`: `Get(channelID)` / `Set(adapter)` 全局管理多个通道实例。s-code 无此机制。

## 实现差距汇总

| # | 能力 | s-forge 实现 | s-code 状态 | 工作量 |
|---|------|-------------|-------------|--------|
| 1 | 入站消息路由 | `Bridge.Push → handler` | RingQueue 已实现，缺 handler 和 HTTP 入口 | 中 |
| 2 | 出站消息发送 | `ChannelAdapter.SendMessage` | **完全缺失** | 中 |
| 3 | Adapter 接口 | `channel/adapter.go` | **完全缺失** | 小 |
| 4 | 适配器注册表 | `registry.go` | **完全缺失** | 小 |
| 5 | 消息来源↔Session 绑定 | `conversationToken` 字段 | `types.ts InboundMessage` 已有字段 | 小 |
| 6 | Ring 0 打断 LLM | 无（s-forge 不需要打断） | 计划中 | 中 |
| 7 | send_channel_message 工具 | `coordinator/send_channel_message.go` | **完全缺失** | 中 |
