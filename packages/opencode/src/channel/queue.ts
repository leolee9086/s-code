// s-code: src/channel/queue.ts
//
// 按保护环分级的优先消息队列 + 派发器。参考 s-forge:
//   - kernel/api/magi_priority_queue.go  (DispatcherRingQueue)
//   - kernel/api/magi.go:unifiedDispatcher (单消费者循环)
//
// Ring 0: 外部消息（用户请求）— 最高优先级
// Ring 1: 系统任务（心跳）
// Ring 2: 后台任务
// Ring 3: 维护

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channel.queue" })
const MAX_RETRIES = 3

export const RING_COUNT = 4

export enum TaskRing {
  ExternalMessage = 0,
  Heartbeat       = 1,
  Background      = 2,
  Maintenance     = 3,
}

export type MessageRecordStatus = "pending" | "delivering" | "delivered" | "failed"

/** 消息信封 — 与 s-forge InboundMessage / OutboundMessage 字段完全对齐 */
export interface MessageRecord {
  id: string
  ring: TaskRing

  // ── 信封字段（与 s-forge channel/types.go 一致） ──
  channelId: string
  channelType: string
  accountId: string
  userId: string
  nickname?: string
  identityId?: string
  identityDisplayName?: string
  text?: string
  conversationToken?: string
  timestamp: number

  // ── 队列控制字段 ──
  seq: number
  status: MessageRecordStatus
  dedupeKey?: string       // 可选去重键，相同键的消息只会被入队一次
  direction: "inbound" | "outbound"
  taskType: string              // "search" | "shell" | "read" | "write" | "edit" | "git"
  taskPayload: unknown          // 请求参数
  deliveredAt?: number
  retryCount: number
  error?: string
}

export interface RingQueueInterface {
  readonly push: (ring: TaskRing, msg: Omit<MessageRecord, "id" | "ring" | "seq" | "status" | "retryCount"> & { timestamp?: number }) => string
  readonly popNonBlocking: () => MessageRecord | undefined
  readonly len: () => number
  readonly ringLen: (ring: TaskRing) => number
  readonly markDelivered: (id: string) => void
  readonly markFailed: (id: string, error: string) => void
  readonly checkpoint: () => void
}

// ── 原子持久化 ──────────────────────────────────────────

function resolveWALPath(): string {
  const dir = process.env["S_CODE_TEMP"] || process.env["TMPDIR"] || process.env["TEMP"] || tmpdir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, ".scode-ring-queue.journal")
}

// ── 队列工厂 ───────────────────────────────────────────

export const makeRingQueue = (walPath?: string): RingQueueInterface => {
  const path = walPath ?? resolveWALPath()
  const rings: MessageRecord[][] = [ [], [], [], [] ]
  const seen = new Set<string>()    // 已投递/失败的消息 ID，用于去重
  let seq = 0

  // 从 WAL 恢复未完成的消息
  if (existsSync(path)) {
    try {
      for (const line of readFileSync(path, "utf-8").split("\n").filter(Boolean)) {
        try {
          const rec = JSON.parse(line) as MessageRecord
          // 注意：delivering 不跳过——崩溃时正在处理的消息应恢复为 pending 重新处理
          if (rec.status === "delivered" || rec.status === "failed") { if (rec.dedupeKey) seen.add(rec.dedupeKey); continue }
          rec.status = "pending"
          if (rec.ring >= 0 && rec.ring < RING_COUNT) {
            rings[rec.ring].push(rec)
            if (rec.seq >= seq) seq = rec.seq + 1
          }
        } catch { /* skip corrupt lines */ }
      }
    } catch { /* ignore read errors */ }
  }

  // 原子全量 checkpoint：tmp → rename，每 opsSinceCheckpoint 次调用触发一次
  let opsSinceCheckpoint = 0
  const checkpoint = () => {
    const tmp = path + ".tmp"
    try {
      writeFileSync(tmp, rings.flat().map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8")
      renameSync(tmp, path)
    } catch (e) {
      log.warn("queue checkpoint failed", { err: e })
    }
  }
  const maybeCheckpoint = () => {
    opsSinceCheckpoint++
    if (opsSinceCheckpoint >= 50) { checkpoint(); opsSinceCheckpoint = 0 }
  }

  // 条件变量：push 后通知等待的 pop（消除空轮询，未实现）
  // popNonBlocking 不阻塞，队列空时 dispatcher 用 Effect.sleep 等待

  return {
    push: (ring, msg) => {
      if (ring < 0 || ring >= RING_COUNT) return ""
      // 去重：如果 dedupeKey 已处理过（delivered/failed），忽略此消息
      if (msg.dedupeKey && seen.has(msg.dedupeKey)) return ""
      const id = `q-${Date.now()}-${seq}`
      const rec: MessageRecord = {
        id, ring,
        channelId: msg.channelId, channelType: msg.channelType,
        accountId: msg.accountId, userId: msg.userId,
        nickname: msg.nickname, identityId: msg.identityId,
        identityDisplayName: msg.identityDisplayName,
        text: msg.text, conversationToken: msg.conversationToken,
        timestamp: msg.timestamp ?? Date.now(),
        seq: seq++, status: "pending",
        direction: msg.direction,
        taskType: msg.taskType, taskPayload: msg.taskPayload,
        retryCount: 0,
      }
      rings[ring].push(rec)
      appendFileSync(path, JSON.stringify(rec) + "\n", "utf-8")
      return id
    },

    popNonBlocking: () => {
      // 非阻塞扫描一次
      for (let i = 0; i < RING_COUNT; i++) {
        const idx = rings[i].findIndex(m => m.status === "pending")
        if (idx >= 0) { rings[i][idx].status = "delivering"; return rings[i][idx] }
      }
      return undefined
    },

    len: () => rings.reduce((s, r) => s + r.length, 0),
    ringLen: (r) => (r >= 0 && r < RING_COUNT ? rings[r].length : 0),

    markDelivered: (id) => {
      const rec = [...rings.flat()].find(x => x.id === id)
      if (rec?.dedupeKey) seen.add(rec.dedupeKey)
      for (const r of rings) {
        const m = r.find(x => x.id === id)
        if (m) { m.status = "delivered"; m.deliveredAt = Date.now(); maybeCheckpoint(); return }
      }
    },

    markFailed: (id, error) => {
      const rec = [...rings.flat()].find(x => x.id === id)
      if (rec?.dedupeKey) seen.add(rec.dedupeKey)
      for (const r of rings) {
        const m = r.find(x => x.id === id)
        if (!m) return
        m.error = error
        m.retryCount++
        if (m.retryCount < MAX_RETRIES) {
          m.status = "pending"  // 重新入队，下次 popBlocking 可再次取出
        } else {
          m.status = "failed"  // 超过最大重试次数，永久标记失败
        }
        maybeCheckpoint()
      }
    },

    checkpoint,
  }
}

// ── Dispatcher（Effect 原生，不逃逸运行时） ──────────────
//
// dispatcher 本身是一个 Effect，在 Effect 运行时内运行。
// onMessage 返回 Effect<void>，由 dispatcher 通过 yield* 调用。
// 无需 runPromise、无需自制 runtime。

export type DispatchHandler = (rec: MessageRecord) => Effect.Effect<void>

export interface DispatcherControl { readonly stop: () => void }

export const runDispatcher = Effect.fn("QueueDispatcher.run")(function* (
  q: RingQueueInterface,
  onMessage: DispatchHandler,
) {
  const control: { stop(): void; stopped?: boolean } = { stop() { this.stopped = true }, stopped: false }
  while (!control.stopped) {
    const task = q.popNonBlocking()
    if (task) {
      const ok = yield* onMessage(task).pipe(
        Effect.map(() => true),
        Effect.catch((err) =>
          Effect.sync(() => { log.warn("handler failed, marked as failed", { id: task.id, err }); return false })
        ),
      )
      if (ok) q.markDelivered(task.id)
      else q.markFailed(task.id, "handler rejected")
    } else {
      yield* Effect.sleep("50 millis")
    }
  }
  return control
})

export * as ChannelQueue from "./queue"
