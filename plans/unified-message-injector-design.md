# 统一消息注入服务设计

> **核查日期: 2026-06-08** — 本文档基于 [`packages/opencode/src/`](packages/opencode/src/) 代码进行清理，详见 [`unified-message-injector-design-audit.md`](plans/unified-message-injector-design-audit.md)

## 使用方分析

| 调用方 | 当前方式 | 是否外部 | 使用频率 |
|--------|---------|---------|---------|
| [`handlers/queue.ts`](packages/opencode/src/server/routes/instance/httpapi/handlers/queue.ts) dispatcher | Ring 0: `interruptAndInject`; Ring 1-3: `setSuffixOnce` | 是 — 外部消息经 HTTP 入站 | 按消息量 |
| [`forever/relay.ts`](packages/opencode/src/forever/relay.ts) (spawn IPC) | `Injection.setSuffixOnce` | 是 — spawn 副本发消息 | 按 spawn 数量 |
| [`evolve` 续进消息](packages/opencode/src/session/prompt.ts:1893) | 直接 `updateMessage` + `updatePart` | 是 — 文件协议触发 | 每轮 evolve |
| [`Injection` HTTP API](packages/opencode/src/server/routes/instance/httpapi/handlers/injection.ts) | `Injection.setPrefix` / `setSuffix` / `setSuffixOnce` | 是 — 外部 HTTP 调用 | 按需 |
| [`relayRoutes` HTTP API](packages/opencode/src/server/routes/relay/index.ts:62) | `Injection.setSuffixOnce` | 是 — 父子进程间通信 | 按 spawn 数量 |
| [`send_channel_message` 工具](packages/opencode/src/tool/send-channel-message.ts) | `Channel.Adapter.send()` → `relay.inject` → `Injection.setSuffixOnce`（间接链路） | 是 — LLM 调用 | 按 LLM 决策 |
| [`relayMessage` 工具](packages/opencode/src/tool/relay-message.ts) | `Channel.Adapter.send()` → `relay.inject` → `Injection.setSuffixOnce` | 是 — LLM 调用 | 按 LLM 决策 |
| [`handleSubtask`](packages/opencode/src/session/prompt.ts:363) | 直接 `updateMessage` + `updatePart` | 否 — 内部 subagent | 按 LLM 决策 |

注：
- `prefix-command` 是 CLI 前缀指令解析系统（[`prefix-command/index.ts`](packages/opencode/src/prefix-command/index.ts)），不直接注入消息，而是执行 `ban/unban/enter-evolve/exit-evolve/enter-forever/exit-forever` 等命令，故从上表中移除。
- `send_channel_message` 工具已重构，不再直接调用 `Injection`，而是通过 `Channel.Adapter` → `relay.inject` → `Injection.setSuffixOnce` 的间接链路注入。

**所有外部调用方都通过不同的方式做同一件事：注入消息到 session。**

## 现状问题

### 1. `Injection.setPrefix` — 追加到已有消息尾部，不是独立消息

[`injection.ts:101-106`](packages/opencode/src/session/injection.ts:101)：
```typescript
const consumePrefix = (sessionID) => Effect.sync(() => {
  const s = getState(sessionID)
  const parts = [...s.prefix]   // 读取之前设置的 prefix
  s.prefix = []
  return parts
})
```
[`prompt.ts:1636-1652`](packages/opencode/src/session/prompt.ts:1636) 消费时：
```typescript
const userEntry = msgs.find((m) => m.info.id === lastUser.id)
if (userEntry) {
  for (const p of prefixParts) {
    userEntry.parts.push({ ... })  // 追加到最后一条 user message！
  }
}
```
外部消息被附加到已有的用户消息中，LLM 看到的是混合内容。

### 2. `Injection.setSuffixOnce` — 只支持纯文本

[`injection.ts:95-96`](packages/opencode/src/session/injection.ts:95)：
```typescript
const setSuffixOnce = (sessionID, parts) =>
  Effect.sync(() => { getState(sessionID).suffixOnce = parts })
```
`parts` 类型是 `InjectionPart[] = { type: "text", text: string, synthetic?: boolean }[]`（[injection.ts:20-24](packages/opencode/src/session/injection.ts:20)）。无法注入图片、文件、工具结果等。

### 3. Evolve 和 `createUserMessage` 的冗余

evolve 模式（[`prompt.ts:1893-1909`](packages/opencode/src/session/prompt.ts:1893)）重新实现了 [`createUserMessage`](packages/opencode/src/session/prompt.ts:757)（约 `prompt.ts:757-831`）的相同逻辑，但缺少 `tools`、`system`、`format` 字段。

### 4. 打断能力仅支持纯文本

[`SessionPrompt.interruptAndInject`](packages/opencode/src/session/prompt.ts:198) 已实现「取消当前 LLM → 注入独立用户消息 → 重启循环」的完整流程：
```typescript
yield* state.cancel(sessionID)              // 打断
yield* injectUserMessage(sessionID, text)   // 注入独立用户消息
yield* Effect.forkIn(scope)(loop(...))       // 重启循环
```
但**仅支持纯文本**。Ring 0 外部消息入站已使用此 API（[handlers/queue.ts:57](packages/opencode/src/server/routes/instance/httpapi/handlers/queue.ts:57)），无法注入图片、文件、多条消息序列、或系统指令+用户消息组合。

## 统一消息注入服务

核心能力：向指定 session 的开始或结束注入任意长度的**消息序列**（而非单条消息），
消息格式取各 LLM 提供商消息格式的公约数（`user`/`assistant`/`system` 角色，
`text`/`image`/`file` 内容类型）。

### 服务接口

- **输入**: sessionID + 注入位置 + 消息序列（Message[]）
- **输出**: Effect<void>

### 注入位置

- **prepend**: 在 session 最前面插入独立消息序列（取代 `setPrefix`，独立存在，不附加到已有消息尾部）
- **append**: 在当前最后一条消息之后追加（取代 `setSuffixOnce`）
- **interrupt**: 打断当前 LLM → 注入消息 → 重启 loop（已有纯文本版本 `interruptAndInject`，需扩展支持多内容类型和多消息序列）

### 消息序列能力

区别于现有单条纯文本注入，新服务支持：

1. **多角色**: 可注入 `user`、`assistant`、`system` 角色
2. **多内容类型**: 每条消息可包含多个 content（文本 + 图片 + 文件组合）
3. **序列长度**: 可注入多条消息（Message[]），不仅是单条
4. **Prepend 的独立性**: 注入的消息作为独立 user message 存在，不附加到已有消息尾部

### 为什么需要消息序列

- `send_channel_message` 工具可能同时发送文本 + 图片
- 外部聊天平台的一条消息可能包含多段内容（文字 + 附件 + 引用回复）
- Interrupt 打断时可能需要注入系统指令 + 用户消息的组合
- 会话恢复时需注入完整的历史消息序列

### 对外暴露的位置

通过 HTTP API 暴露给外部：

```
POST /api/inject/:sessionID
{
  "position": "prepend" | "append" | "interrupt",
  "messages": [
    { "role": "user", "content": [ { "type": "text", "text": "..." } ] }
  ]
}
```

取代现有的：
- `POST /injection/prefix/:sessionID`（[groups/injection.ts](packages/opencode/src/server/routes/instance/httpapi/groups/injection.ts)）
- `POST /injection/suffix/:sessionID`（同上）
- `/api/relay/inject`（[relay/index.ts:62](packages/opencode/src/server/routes/relay/index.ts:62)）

保留兼容接口。

### 向后兼容

- `Injection.Service.setPrefix` / `setSuffix` / `setSuffixOnce` / `clear` / `onRoundComplete` 保留，内部委托给新服务
- `SessionPrompt.interruptAndInject` 保留并升级以支持多内容类型
- RingQueue dispatcher handler 改为调用新服务（Ring 0 → interrupt, Ring 1-3 → append）
- evolve 续进消息改为复用统一入口（不再独立实现 `updateMessage` + `updatePart`）
- `createUserMessage` 保留不变（内部使用）
- relay 路由 `/api/relay/inject` 改为调用新服务
- `Channel.Adapter.send`（`inject` 类型消息）链路改为调用新服务>>>>>>> REPLACE
