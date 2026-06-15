import { Session } from "./session"
import { SessionID } from "./schema"

import type { TaskPromptOps } from "@/tool/task"
import type { Agent } from "@/agent/agent"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Option } from "effect"
import path from "path"
import REVIEW_PROMPT from "./bun-review.txt"
import { extractParentModel } from "./inherit-model"

/**
 * 渲染审核 prompt 模板，填入上下文变量。
 * 只传入最少必要信息：代码、描述、项目名、用户消息摘要、主 agent 推理。
 */
function renderPrompt(code: string, description: string, instanceCtx: InstanceContext, userMessage: string, agentRationale: string): string {
  const truncated = code.length > 2000 ? code.slice(0, 2000) + "\n... [truncated]" : code
  return REVIEW_PROMPT
    .replace("${code}", truncated)
    .replace("${description}", description || "(空)")
    .replace("${project_name}", path.basename(instanceCtx.directory))
    .replace("${user_message}", userMessage.slice(0, 500))
    .replace("${agent_rationale}", agentRationale.slice(0, 500))
}

/**
 * 从文本回复中解析审核结论。
 * 匹配 SAFE: 或 UNSAFE: 前缀。
 */
function parseVerdict(output: string): { verdict: "safe" | "unsafe"; reason: string } | undefined {
  const trimmed = output.trim()
  if (/^SAFE:\s*$/im.test(trimmed)) return { verdict: "safe", reason: "" }
  const safeMatch = trimmed.match(/^SAFE:\s*(.+)$/im)
  if (safeMatch) return { verdict: "safe", reason: safeMatch[1]?.trim() ?? "" }
  const unsafeMatch = trimmed.match(/^UNSAFE:\s*(.+)$/im)
  if (unsafeMatch) return { verdict: "unsafe", reason: unsafeMatch[1]?.trim() || "未提供原因" }
  return undefined
}

/**
 * 从 assistant 消息的 parts 中提取最后一段文本内容。
 */
function lastText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text != null)
    .map((p) => p.text!)
    .join("\n")
}

/**
 * Bun 脚本安全与可复用性审核入口。
 *
 * 为待执行的 bun 代码创建一个独立的审核 session，
 * 通过纯文本 prompt 让模型输出 SAFE: / UNSAFE: 前缀结论。
 * 审核除安全性外还检查脚本的扩展性、可复用性和编码质量。
 *
 * 返回 undefined = 审核通过放行，
 * 返回 Tool.ExecuteResult 含 intercepted = 审核拦截。
 */
export const bunReview = Effect.fn("BunReview.run")(function* (
  args: Record<string, unknown>,
  ctx: { sessionID: string; messageID: string; messages: readonly { info: { role: string }; parts: { type: string; text?: string }[] }[]; extra?: Record<string, unknown> },
  input: {
    agent: Agent.Info
    session: Session.Info
    promptOps: TaskPromptOps
  },
  sessionSvc: Session.Interface,
  instanceCtx: InstanceContext,
) {
  const code = String(args.code ?? "")
  const description = String(args.description ?? "")

  // 提取用户消息和主 agent 推理作为审核上下文
  const userMessage = lastText(
    (ctx.messages.findLast((m) => m.info.role === "user")?.parts as { type: string; text?: string }[]) ?? [],
  )
  const agentRationale = lastText(
    (ctx.messages.findLast((m) => m.info.role === "assistant")?.parts as { type: string; text?: string }[]) ?? [],
  )

  // 1. 创建审核子 session
  const reviewSession = yield* sessionSvc.create({
    parentID: SessionID.make(ctx.sessionID),
    title: `bun review: ${(description || code).slice(0, 60)}`,
    agent: input.agent.name,
  })

  // 2. 从父 assistant 消息继承模型（与 task 工具模式一致）
  const parentMsg = yield* sessionSvc.findMessage(
    SessionID.make(ctx.sessionID),
    (msg) => msg.info.id === ctx.messageID,
  ).pipe(Effect.orDie)
  const parentModel = Option.isSome(parentMsg) ? extractParentModel(parentMsg.value) : undefined
  const usingAgentModel = !!input.agent.model
  const model = usingAgentModel ? input.agent.model : parentModel

  // 3. 渲染审核 prompt
  const reviewPrompt = renderPrompt(code, description, instanceCtx, userMessage, agentRationale)

  // 4. 执行审核 prompt（纯文本，模型输出 SAFE: / UNSAFE: 前缀）
  const result = yield* input.promptOps.prompt({
    sessionID: reviewSession.id,
    parts: [{ type: "text" as const, text: reviewPrompt }],
    model: model ? { modelID: model.modelID, providerID: model.providerID } : undefined,
    tools: { "*": false },
  })

  // 5. 解析审核结论
  const verdict = parseVerdict(lastText(result.parts as { type: string; text?: string }[]))

  if (!verdict) {
    return {
      title: description || "bun",
      output: "[Bun Review Blocked] 审核未返回有效结论（格式异常），脚本已被拦截。",
      metadata: { intercepted: { rule: "bun_review_format_error", reason: "审核 LLM 未返回 SAFE/UNSAFE 格式的结论" } },
    }
  }

  if (verdict.verdict === "unsafe") {
    return {
      title: description || "bun",
      output: `[Bun Review Blocked] 安全或质量审核未通过：${verdict.reason}`,
      metadata: { intercepted: { rule: "bun_review", reason: verdict.reason } },
    }
  }

  // safe：放行
})

export * as BunReview from "./bun-review"
