// 永续模式（Forever Mode）工具模块
//
// 通过函数式调用，避免 Effect Service 类型泄漏。

export type ForeverConfigShape = {
  enabled?: boolean
  conditions?: {
    file_watch?: { enabled?: boolean; paths?: string[]; debounce_ms?: number; ignore?: string[] }
    timer?: { enabled?: boolean; interval_ms?: number }
  }
  prompt?: {
    default?: string
    source?: { type: string; command?: string; args?: string[]; url?: string; text?: string }
  }
  budget?: { max_cost_usd?: number; max_rounds?: number; max_duration_minutes?: number; max_sleep_minutes?: number }
}

/** 永续模式是否激活（env flag），与 config.enabled 独立 */
export function isForeverMode(): boolean {
  return process.env["S_CODE_FOREVER"] === "1"
}

/** 设置永续模式 env flag */
export function setForeverMode(): void {
  process.env["S_CODE_FOREVER"] = "1"
}

/** 清除永续模式 env flag */
export function clearForeverMode(): void {
  delete process.env["S_CODE_FOREVER"]
}

/** 检查 budget 是否允许继续 */
export const checkBudget = (
  config: ForeverConfigShape | undefined,
  budgetState: { rounds: number; costUsd: number; startTime: number; lastActiveTime: number } | null,
): { allowed: boolean; reason?: string } => {
  if (!config?.budget) return { allowed: true }
  if (!budgetState) return { allowed: true }

  const b = config.budget
  if (b.max_rounds && budgetState.rounds >= b.max_rounds)
    return { allowed: false, reason: `Max rounds (${b.max_rounds}) exceeded` }
  if (b.max_cost_usd && budgetState.costUsd >= b.max_cost_usd)
    return { allowed: false, reason: `Max cost ($${b.max_cost_usd}) exceeded` }
  if (b.max_duration_minutes) {
    const elapsed = (Date.now() - budgetState.startTime) / 1000 / 60
    if (elapsed >= b.max_duration_minutes)
      return { allowed: false, reason: `Max duration (${b.max_duration_minutes}min) exceeded` }
  }
  if (b.max_sleep_minutes) {
    const sleepElapsed = (Date.now() - (budgetState.lastActiveTime ?? budgetState.startTime)) / 1000 / 60
    if (sleepElapsed >= b.max_sleep_minutes)
      return { allowed: false, reason: `Sleep timeout (${b.max_sleep_minutes}min) exceeded` }
  }
  return { allowed: true }
}

export * as Forever from "./forever"
