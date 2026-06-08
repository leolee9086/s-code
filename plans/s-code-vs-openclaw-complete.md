# S-Code vs OpenClaw 完整外部消息能力检查

## OpenClaw 完整的消息环（基于实际源码分析）

```
外部来源（Discord/Telegram/微信/Slack...）
  │
  ▼
ChannelAdapter.Start() 监听
  │
  ▼ (inbound event)
ChannelIngressQueue.enqueue(id, payload)   ← SQLite 持久化，dedup
  │
  ▼ (claimNext)
AutoReply/Thinking Engine                   ← 断消息类型、LLM 决策
  │
  ▼ (LLM agent loop 产生回复)
DurableMessageSendContext.render() → preview → send()
  │
  ▼ (adapter.send.text/media/payload/poll)
ChannelMessageSendAdapter
  │
  ▼ (回执 + commit)
MessageReceipt
```

### OpenClaw 已实现的组件

| 组件 | 源码位置 | 状态 |
|------|---------|------|
| Channel 适配器注册表 | `channels/plugins/registry.ts` | ✅ 全局 registry |
| 入站消息队列 (SQLite) | `channels/message/ingress-queue.ts` | ✅ claim/release/complete/fail + recoverStaleClaims |
| 入站消息去重 | `ingress-queue.ts:372 onConflict` | ✅ SQLite ON CONFLICT DO NOTHING |
| 自动回复引擎 | `auto-reply/thinking.ts` | ✅ 消息分类 + LLM 路由 |
| 出站发送 | `channels/message/send.ts` | ✅ render→preview→send→commit |
| 发送回执 | `channels/message/types.ts` | ✅ MessageReceipt |
| 消息适配器接口 | `channels/message/types.ts` | ✅ send(含 text/media/payload/poll) + 生命周期 hooks |
| 会话路由 | `channels/session.ts` | ✅ recordInboundSession |
| 通道能力协商 | `channels/message/types.ts:17-31` | ✅ durableFinalDeliveryCapabilities |

## s-code 当前状态

```
外部 → POST /queue/message → RingQueue.push()
  → runDispatcher → handler → sessionMapper.resolve(undefined)
  → 丢弃
                                                           ← LLM 回复只写 DB，无法返回
```

### 已有的（但破碎或桩）

| 组件 | 状态 | 问题 |
|------|------|------|
| RingQueue | ⚠️ 部分实现 | 无去重、无 claim、无重试、无裁剪 |
| registry.ts | ✅ 定义完整 | 未注册到任何 Layer，无人使用 |
| adapter.ts | ✅ 接口对齐 | 无调用方，local-adapter 是桩 |
| session-mapper.ts | ❌ 不可用 | bind 永不调用，resolve 永远 undefined |
| handlers/queue.ts | ⚠️ 已修复编译 | session 映射断链，所有消息被丢弃 |
| POST /queue/message | ⚠️ 路由存在 | 注册到 API 树，但 handler 无法路由消息 |

### 完全缺失的

| 能力 | OpenClaw | s-code |
|------|---------|--------|
| 出站消息发送 | `send.ts` + `adapter.send()` | **不存在** — LLM 回复无法发送回外部 |
| 自动回复引擎 | `auto-reply/thinking.ts` | 无消息分类和自动回复 |
| 会话路由 | `channels/session.ts` | 无 inbound session recorder |
| 发送回执 | `MessageReceipt` | 无 |
| 通道能力声明 | `capabilities: durableFinalDeliveryCapabilities` | 无 |
| 消息生命周期 hooks | `beforeSendAttempt/afterSendSuccess/afterCommit` | 无 |
| 去重 | `onConflict` | 无 |
| 原子 claim | `claimNext` SQLite 事务 | `delivering` 状态 + WAL 跳过 → crash 丢失 |
| 重试 | `release` 递增 attempts | 无 |
| 恢复 | `recoverStaleClaims` | 无 |
| 裁剪 | `prune` TTL | 无 |

## 结论

当前 s-code 的实现**无法完成 OpenClaw 同等的外部消息收发能力**。RingQueue 只实现了最基础的入队/出队操作，且有 5 个完整性缺陷（无去重、无 claim、无重试、无恢复、无裁剪）。最关键的是**LLM 回复没有任何路径可以送回外部消息来源**——出站侧完全缺失。
