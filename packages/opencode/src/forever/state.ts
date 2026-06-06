// 永续模式状态持久化
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { Context, Effect, Layer } from "effect"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "forever.state" })

export type BudgetState = {
  rounds: number
  costUsd: number
  startTime: number
  /** 最后一轮活跃时间戳，用于 sleep 超时检测 */
  lastActiveTime: number
}

export interface StatePersistenceInterface {
  readonly readBudgetState: (sessionID: string) => Effect.Effect<BudgetState | null>
  readonly updateBudgetState: (sessionID: string, update: { rounds?: number; costUsd?: number }) => Effect.Effect<void>
  readonly clearBudgetState: (sessionID: string) => Effect.Effect<void>
}

export class StatePersistenceService extends Context.Service<StatePersistenceService, StatePersistenceInterface>()(
  "@opencode/ForeverState",
) {}

let cachedStateDir: string | null = null

function stateDir(): string {
  if (cachedStateDir) return cachedStateDir

  const fromEnv = process.env["S_CODE_TEMP"]
  if (fromEnv) {
    cachedStateDir = fromEnv
    return fromEnv
  }

  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, ".opencode", "tool", "evolve.ts"))) {
      const temp = path.join(path.dirname(dir), "s-temp")
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true })
      cachedStateDir = temp
      return temp
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const fallback = path.join(dir, "s-temp")
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true })
  cachedStateDir = fallback
  return fallback
}

function budgetStateFile(sessionID: string): string {
  return path.join(stateDir(), `.forever-budget-${sessionID}.json`)
}

export const statePersistenceLayer = Layer.effect(
  StatePersistenceService,
  Effect.gen(function* () {

    const ensureDir = () => {
      const dir = stateDir()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }

    const readBudgetState: StatePersistenceInterface["readBudgetState"] = (sessionID) =>
      Effect.sync(() => {
        try {
          const filePath = budgetStateFile(sessionID)
          if (!existsSync(filePath)) return null
          const text = readFileSync(filePath, "utf-8")
          if (!text) return null
          return JSON.parse(text) as BudgetState
        } catch {
          return null
        }
      })

    const updateBudgetState: StatePersistenceInterface["updateBudgetState"] = (sessionID, update) =>
      Effect.sync(() => {
        try {
          ensureDir()
          const filePath = budgetStateFile(sessionID)
          let current: BudgetState | null = null
          if (existsSync(filePath)) {
            try {
              current = JSON.parse(readFileSync(filePath, "utf-8"))
            } catch {}
          }
          const now = Date.now()
          const next: BudgetState = {
            rounds: (current?.rounds ?? 0) + (update.rounds ?? 0),
            costUsd: (current?.costUsd ?? 0) + (update.costUsd ?? 0),
            startTime: current?.startTime ?? now,
            lastActiveTime: now,
          }
          writeFileSync(filePath, JSON.stringify(next, null, 2))
        } catch (error) {
          log.error("failed to update budget state", { error })
        }
      })

    const clearBudgetState: StatePersistenceInterface["clearBudgetState"] = (sessionID) =>
      Effect.sync(() => {
        try {
          const filePath = budgetStateFile(sessionID)
          if (existsSync(filePath)) unlinkSync(filePath)
        } catch {
          // ignore
        }
      })

    return StatePersistenceService.of({
      readBudgetState,
      updateBudgetState,
      clearBudgetState,
    })
  }),
)

export * as ForeverState from "./state"
