import { readFileSync, existsSync } from "fs"
import path from "path"
import os from "os"

export interface ShellRule {
  pattern: string
  level: "allow" | "ask" | "deny"
  reason: string
  disabled?: boolean
}

export interface RuleMatch {
  rule: ShellRule
  subcommand: string
}

const DEFAULT_RULES: ShellRule[] = [
  { pattern: "^git push --force( -|$)", level: "deny", reason: "git push --force 会覆盖远程历史，导致协作者丢失提交。使用 git push --force-with-lease 代替。" },
  { pattern: "^git push --force-with-lease", level: "allow", reason: "" },
  { pattern: "^git reset --hard", level: "deny", reason: "git reset --hard 会丢弃未提交的本地改动。使用 git stash 暂存后再操作，或指定 --soft 保留改动。" },
  { pattern: "^git reset ", level: "ask", reason: "此 git reset 命令会移动分支指针，请确认是否已保存需要的改动。" },
  { pattern: "^git commit --amend", level: "ask", reason: "git commit --amend 会修改已提交的信息，如果已推送可能影响协作者。" },
  { pattern: "^git commit ", level: "ask", reason: "即将创建新提交，请确认提交内容正确。每次提交前应检查 diff。" },
  { pattern: "^git push ", level: "ask", reason: "即将推送本地提交到远程仓库，请确认推送的分支和目标正确。" },
  { pattern: "^git merge ", level: "ask", reason: "git merge 会创建合并提交，请确认合并目标和当前分支状态。" },
  { pattern: "^git rebase ", level: "ask", reason: "git rebase 会重写提交历史，如果已推送的分支被 rebase 可能影响协作者。" },
  { pattern: "^git checkout -b|^git switch -c|^git branch ", level: "ask", reason: "即将创建或切换分支，请确认分支名称正确。" },
  { pattern: "^git branch -d ", level: "allow", reason: "删除已合并的本地分支，安全。" },
  { pattern: "^git branch -D ", level: "ask", reason: "强制删除本地分支（即使未合并），可能丢失未合并的改动。" },
  { pattern: "^git tag -d|^git tag -a|^git tag -f", level: "ask", reason: "修改标签操作，如果标签已推送会影响协作者。" },
  { pattern: "^git revert ", level: "ask", reason: "git revert 会创建新的反向提交来撤销改动，请确认要撤销的提交正确。" },
  { pattern: "^git cherry-pick ", level: "ask", reason: "git cherry-pick 会将其他分支的提交应用到当前分支，请确认提交 ID 正确。" },
  { pattern: "^git stash (pop|drop|clear)", level: "ask", reason: "此 stash 操作会移除或丢弃暂存项，请确认不需要的改动已保存。" },
  { pattern: "^git submodule update", level: "ask", reason: "git submodule update 会修改子模块状态，请确认当前的子模块引用正确。" },
  { pattern: "^git (status|diff|log|show|fetch|branch$|stash list|stash show|ls-files|describe|rev-parse|rev-list|shortlog|blame|grep|help|version|remote|config --get|config --list)", level: "allow", reason: "" },
  { pattern: "^git ", level: "ask", reason: "此 git 命令会被执行，请确认操作正确。" },
  { pattern: "^(Select-String|sls)", level: "deny", reason: "搜索文件内容请使用 Grep 工具。Select-String 在管道中的输出不适合后续处理。" },
  { pattern: "^(Get-ChildItem|ls|dir)", level: "deny", reason: "列出文件请使用 Glob 工具。ls 输出缺少 mtime、行号等元信息。" },
  { pattern: "^(Get-Content|cat|type)", level: "deny", reason: "读取文件请使用 Read 工具。Read 输出含行号标记，便于定位。" },
  { pattern: "^(grep|findstr)", level: "deny", reason: "搜索文件内容请使用 Grep 工具。Grep 工具输出包含行号和文件路径。" },
  { pattern: "^(head|tail|more|less)", level: "deny", reason: "查看文件请使用 Read 工具。Read 支持 offset/limit 分页查看。" },
  { pattern: "^(sed|awk|%|ForEach-Object)", level: "deny", reason: "文本处理应使用 Edit 工具。Edit 工具保证修改一致性并提供 staleness 校验。" },
]

const MAX_CACHED_PATTERNS = 500
const regexCache = new Map<string, RegExp>()

function getOrCompile(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached) {
    regexCache.delete(pattern)
    regexCache.set(pattern, cached)
    return cached
  }
  try {
    const re = new RegExp(pattern)
    if (regexCache.size >= MAX_CACHED_PATTERNS) {
      const first = regexCache.keys().next().value
      if (first !== undefined) regexCache.delete(first)
    }
    regexCache.set(pattern, re)
    return re
  } catch {
    return null
  }
}

function splitCommandSegments(fullCommand: string): string[] {
  const segments: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false
  let i = 0

  while (i < fullCommand.length) {
    const ch = fullCommand[i]
    const next = fullCommand[i + 1]

    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue }

    if (!inSingle && !inDouble) {
      if (ch === "\\" && next) {
        current += ch + next
        i += 2
        continue
      }
      if (ch === "&" && next === "&") {
        segments.push(current.trim()); current = ""; i += 2; continue
      }
      if (ch === "|" && next === "|") {
        segments.push(current.trim()); current = ""; i += 2; continue
      }
      if (ch === ";") {
        segments.push(current.trim()); current = ""; i++; continue
      }
      if (ch === "|") {
        segments.push(current.trim()); current = ""; i++; continue
      }
    }

    current += ch
    i++
  }

  if (current.trim()) segments.push(current.trim())
  return segments.filter(Boolean)
}

function matchRule(segment: string, rules: ShellRule[]): RuleMatch | null {
  const cmd = segment.trim()

  for (const rule of rules) {
    if (rule.disabled) continue
    const re = getOrCompile(rule.pattern)
    if (re && re.test(cmd)) return { rule, subcommand: cmd }
  }

  return null
}

export function checkCommand(fullCommand: string, rules: ShellRule[] = DEFAULT_RULES): RuleMatch[] {
  const segments = splitCommandSegments(fullCommand)
  const results: RuleMatch[] = []

  for (const seg of segments) {
    const match = matchRule(seg, rules)
    if (match) results.push(match)
  }

  return results
}

export interface CheckResult {
  allow: boolean
  deny?: RuleMatch
  ask?: RuleMatch[]
}

export function evaluate(fullCommand: string, rules?: ShellRule[]): CheckResult {
  const matches = checkCommand(fullCommand, rules)
  if (matches.length === 0) return { allow: true }

  const denies = matches.filter(m => m.rule.level === "deny")
  if (denies.length > 0) return { allow: false, deny: denies[0] }

  const asks = matches.filter(m => m.rule.level === "ask")
  if (asks.length > 0) return { allow: false, ask: asks }

  return { allow: true }
}

export function defaultRules(): ShellRule[] {
  return [...DEFAULT_RULES]
}

const CONFIG_FILENAMES = [".opencode/shell-rules.json", ".opencode/shell-rules.jsonc"]
const GLOBAL_CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
  : path.join(os.homedir(), ".config", "opencode")

function tryReadRules(filePath: string): ShellRule[] | null {
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, "utf-8")
    const parsed: ShellRule[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(r => r.pattern && ["allow", "ask", "deny"].includes(r.level))
  } catch {
    return null
  }
}

export function loadRules(projectDir?: string): ShellRule[] {
  const userRules: ShellRule[] = []

  for (const name of CONFIG_FILENAMES) {
    const global = tryReadRules(path.join(GLOBAL_CONFIG_DIR, name))
    if (global) { userRules.push(...global); break }
  }

  if (projectDir) {
    for (const name of CONFIG_FILENAMES) {
      const project = tryReadRules(path.join(projectDir, name))
      if (project) { userRules.push(...project); break }
    }
  }

  if (userRules.length === 0) return [...DEFAULT_RULES]

  const ruleMap = new Map<string, ShellRule>()
  for (const r of DEFAULT_RULES) ruleMap.set(r.pattern, r)
  for (const r of userRules) ruleMap.set(r.pattern, r)
  return Array.from(ruleMap.values())
}
