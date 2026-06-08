# 外部消息 → LLM Loop 打断路径：代码级分析

## 已有打断能力

### 1. SessionRunState.cancel (run-state.ts:77-86)
```
call → state.cancel(sessionID)
     → existing?.cancel
     → Runner 被 interrupt
```
可取消当前 running 的 runner。但只取消，不注入新消息。

### 2. SessionProcessor.onInterrupt (processor.ts:810-816)
```
onInterrupt →
  aborted = true
  halt(new DOMException("Aborted"))
  → 设 assistantMessage.error
  → publish Session.Event.Error
  → status.set("idle")
```
打断后 session loop 正常退出（不 crash），status 回到 idle。

### 3. Injection.setSuffixOnce (injection.ts:95-96)
```
setSuffixOnce(sessionID, parts) →
  store.get(sessionID).suffixOnce = parts
  → loop 的 consumeSuffix() 在下一轮消费
```
只能排队等到下一轮，不能打断当前轮。

## 缺失的高优先级打断路径

Ring 0 需要的组合路径不存在：

```
打断前:
  LLM stream 正在运行 (processor.ts:802)
  ↓
第一步: cancel(sessionID)
  → trigger onInterrupt (processor.ts:810)
  → stream 停止, status → "idle"
  ↓
第二步: 创建 user message
  → sessions.updateMessage({ role: "user", text: externalMsg })
  → sessions.updatePart({ type: "text", text })
  ↓
第三步: restart loop
  → promptSvc.loop({ sessionID })
  → loop 加载新 user message → 开始新轮次
```

现有 `cancel` 和 `loop` 在代码中各自独立存在，但**没有组合它们的函数**。目前没有任何代码路径能实现"打断当前 LLM → 注入外部消息 → 立即重启 loop"这个三元组。

## 普通优先级路径（Ring 1-3）

```
POST /queue/message { ring: 2, text }  ← 路由不存在
  → queue.push(ring, msg)               ← makeRingQueue() 无人调用
  → runDispatcher pop                   ← runDispatcher() 无人启动
  → handler(msg)                        ← DispatchHandler 未实现
  → Injection.setSuffixOnce(...)        ← 存在 ✓
  → 当前轮结束后 loop consumeSuffix     ← 存在 ✓
```

普通路径的缺失是运行时集成（URL 路由、队列实例化、dispatcher 启动、handler 实现），不需要新的 Effect 能力。
