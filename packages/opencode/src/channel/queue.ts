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
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channel.queue" })

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
  direction: "inbound" | "outbound"
  taskType: string              // "search" | "shell" | "read" | "write" | "edit" | "git"
  taskPayload: unknown          // 请求参数
  deliveredAt?: number
  retryCount: number
  error?: string
}

export interface RingQueueInterface {
  readonly push: (ring: TaskRing, msg: Omit<MessageRecord, "id" | "ring" | "seq" | "status" | "retryCount"> & { timestamp?: number }) => string
  readonly popBlocking: () => MessageRecord | undefined
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
  let seq = 0
  let notify: (() => void) | null = null

  // 从 WAL 恢复未完成的消息
  if (existsSync(path)) {
    try {
      for (const line of readFileSync(path, "utf-8").split("\n").filter(Boolean)) {
        try {
          const rec = JSON.parse(line) as MessageRecord
          if (rec.status === "delivered" || rec.status === "failed" || rec.status === "delivering") continue
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

  // 条件变量：push 后通知等待的 pop
  let waitResolve: (() => void) | null = null
  const signal = () => { const r = waitResolve; waitResolve = null; r?.() }

  return {
    push: (ring, msg) => {
      if (ring < 0 || ring >= RING_COUNT) return ""
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
      signal()
      return id
    },

    popBlocking: () => {
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
      for (const r of rings) {
        const m = r.find(x => x.id === id)
        if (m) { m.status = "delivered"; m.deliveredAt = Date.now(); maybeCheckpoint(); return }
      }
    },

    markFailed: (id, error) => {
      for (const r of rings) {
        const m = r.find(x => x.id === id)
        if (m) { m.status = "failed"; m.error = error; m.retryCount++; maybeCheckpoint(); return }
      }
    },

    checkpoint,
  }
}

// ── 阻塞等待 ─────────────────────────────────────────────

/** 在 popBlocking 返回 undefined 时调用此函数阻塞，等待下一个 push */
export function waitForTask(q: RingQueueInterface): Promise<MessageRecord> {
  return new Promise((resolve) => {
    const poll = () => {
      const task = q.popBlocking()
      if (task) { resolve(task); return }
      // 没任务，50ms 后重试（对比 s-forge：Go channel 原生阻塞）
      // 这里用短轮询 + 条件变量优化：push 会调用 signal 但 Promise 无法中断等待
      setTimeout(poll, 50)
    }
    poll()
  })
}

// ── Dispatcher（不硬编码分发逻辑） ───────────────────────
//
// dispatcher 只负责：pop → markDelivered → notify
// onMessage 回调由外部提供，根据 ring 自行决定处理方式

export type DispatchHandler = (rec: MessageRecord) => void

export function runDispatcher(q: RingQueueInterface, onMessage: DispatchHandler): void {
  const loop = () => {
    const task = q.popBlocking()
    if (task) {
      q.markDelivered(task.id)
      onMessage(task)
      setImmediate(loop)
      return
    }
    setTimeout(loop, 50)
  }
  loop()
}

export * as ChannelQueue from "./queue"
