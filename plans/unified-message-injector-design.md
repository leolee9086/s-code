# 统一消息注入服务设计

## 使用方分析

| 调用方 | 当前方式 | 是否外部 | 使用频率 |
|--------|---------|---------|---------|
| `handlers/queue.ts` dispatcher | `Injection.setPrefix/setSuffixOnce` | 是 — 外部消息经 HTTP 入站 | 按消息量 |
| `forever/relay.ts` (spawn IPC) | `Injection.setSuffixOnce` | 是 — spawn 副本发消息 | 按 spawn 数量 |
| `evolve` 续进消息 `prompt.ts:1893` | 直接 `updateMessage` + `updatePart` | 是 — 文件协议触发 | 每轮 evolve |
| `Injection` HTTP API | `Injection.setPrefix/setSuffixOnce` | 是 — 外部 HTTP 调用 | 按需 |
| `send_channel_message` 工具 | 通过 `Injection` 间接 | 是 — LLM 调用 | 按 LLM 决策 |
| `prefix-command` (`prompt.ts:1133`) | 直接 `updateMessage` + `updatePart` | 否 — CLI 前缀指令 | 按用户操作 |
| `handleSubtask` (`prompt.ts:330`) | 直接 `updateMessage` + `updatePart` | 否 — 内部 subagent | 按 LLM 决策 |

**所有外部调用方都通过不同的方式做同一件事：注入消息到 session。**

## 现状问题

### 1. `Injection.setPrefix` — 追加到已有消息尾部，不是独立消息

`injection.ts:101-106`：
```typescript
const consumePrefix = (sessionID) => Effect.sync(() => {
  const s = getState(sessionID)
  const parts = [...s.prefix]   // 读取之前设置的 prefix
  s.prefix = []
  return parts
})
```
`prompt.ts:1637-1649` 消费时：
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

`injection.ts:95-96`：
```typescript
const setSuffixOnce = (sessionID, parts) =>
  Effect.sync(() => { getState(sessionID).suffixOnce = parts })
```
`parts` 类型是 `InjectionPart[] = { type: "text", text: string, synthetic?: boolean }[]`。无法注入图片、文件、工具结果等。

### 3. Evolve 和 `createUserMessage` 的冗余

evolve 模式（`prompt.ts:1893-1909`）重新实现了 `createUserMessage`（`prompt.ts:784-831`）的相同逻辑，但缺少 `tools`、`system`、`format` 字段。

### 4. 无打断能力

没有任何注入方式能打断当前 LLM 调用。`SessionPrompt.cancel` 只能完全取消，不能「取消 → 注入 → 重启」。

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
- **interrupt**: 打断当前 LLM → 注入消息 → 重启 loop（新增）

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

取代现有的 `POST /injection/prefix/:sessionID` 和 `POST /injection/suffix/:sessionID`（保留兼容接口）。

### 向后兼容

- `Injection.Service.setPrefix` / `setSuffixOnce` 保留，内部委托给新服务
- RingQueue dispatcher handler 改为调用新服务（Ring 0 → interrupt, Ring 1-3 → append）
- evolve 续进消息改为复用统一入口（不再独立实现 `updateMessage` + `updatePart`）
- `createUserMessage` 保留不变（内部使用）>>>>>>> REPLACE
