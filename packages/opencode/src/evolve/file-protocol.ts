// 进化模式文件协议
//
// 每轮 build 结束时写 .evolve-msg.txt，下轮启动时读取并删除。
// 这是进化模式唯一的外部状态传递路径。
//
// 目录：由 S_CODE_TEMP 环境变量指定，查找仓库根目录兜底
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import path from "path"

function evolveDir(): string {
  const fromEnv = process.env["S_CODE_TEMP"]
  if (fromEnv) return fromEnv

  // s-temp 是仓库根目录的平级目录
  // cwd 可能是 packages/opencode → 向上两级到 d:/dev → d:/dev/s-temp
  // 通过查找 .opencode/tool/evolve.ts 定位仓库根目录，再取父目录
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, ".opencode", "tool", "evolve.ts"))) {
      const temp = path.join(path.dirname(dir), "s-temp")
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true })
      return temp
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 兜底
  return path.join(dir, "s-temp")
}

function msgFile(): string {
  return path.join(evolveDir(), ".evolve-msg.txt")
}

function countFile(): string {
  return path.join(evolveDir(), ".evolve-test-count")
}

function ensureDir(): void {
  const dir = evolveDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** 写入进化续进消息 */
export function writeEvolveMessage(msg: string): void {
  try {
    ensureDir()
    writeFileSync(msgFile(), msg, "utf-8")
  } catch {
    // 写入失败不应该打断 build
  }
}

/** 读取并删除进化续进消息。没有消息时返回 null */
export function readEvolveMessage(): string | null {
  try {
    const f = msgFile()
    if (!existsSync(f)) return null
    const text = readFileSync(f, "utf-8")
    unlinkSync(f)
    return text
  } catch {
    return null
  }
}

/** 读取上一次的测试用例数 */
export function readTestCount(): number {
  try {
    const f = countFile()
    if (!existsSync(f)) return 0
    return Number(readFileSync(f, "utf-8").trim()) || 0
  } catch {
    return 0
  }
}

/** 写入本次测试用例数 */
export function writeTestCount(count: number): void {
  try {
    ensureDir()
    writeFileSync(countFile(), String(count), "utf-8")
  } catch {
    // 写入失败不应该打断 build
  }
}

/** 进化模式是否激活 */
export function isEvolveMode(): boolean {
  return process.env["S_CODE_EVOLVE"] === "1"
}

/** 进化模式的白名单目录 */
export function evolveScope(): string[] {
  return [evolveDir(), process.cwd()]
}

/** 判断路径是否在进化模式白名单内 */
export function isInEvolveScope(target: string): boolean {
  const normalized = target.replace(/\\/g, "/").toLowerCase()
  return evolveScope().some(dir => normalized.startsWith(dir.replace(/\\/g, "/").toLowerCase()))
}
