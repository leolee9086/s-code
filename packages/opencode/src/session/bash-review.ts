import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TaskPromptOps } from "@/tool/task"
import type { Agent } from "@/agent/agent"
import type { InstanceContext } from "@/project/instance-context"
import { Effect } from "effect"
import path from "path"
import REVIEW_PROMPT from "./bash-review.txt"

/**
 * 渲染审核 prompt 模板，填入上下文变量。
 * 只传入最少必要信息：命令、描述、项目名、用户消息摘要、主 agent 推理。
 */
function renderPrompt(command: string, description: string, instanceCtx: InstanceContext, userMessage: string, agentRationale: string): string {
  const truncated = command.length > 800 ? command.slice(0, 800) + "\n... [truncated]" : command
  return REVIEW_PROMPT
    .replace("${command}", truncated)
    .replace("${description}", description || "(空)")
    .replace("${project_name}", path.basename(instanceCtx.directory))
    .replace("${user_message}", userMessage.slice(0, 500))
    .replace("${agent_rationale}", agentRationale.slice(0, 500))
}

/**
 * 从文本回复中解析审核结论。
 * 只匹配 SAFE 或 UNSAFE: 前缀格式。
 */
function parseVerdict(output: string): { verdict: "safe" | "unsafe"; reason: string } | undefined {
  const trimmed = output.trim()
  if (/^SAFE$/im.test(trimmed)) return { verdict: "safe", reason: "" }
  if (/^UNSAFE:/im.test(trimmed)) {
    return { verdict: "unsafe", reason: trimmed.slice(7).trim() || "未提供原因" }
  }
  return undefined
}

/**
 * 构造 StructuredOutput 的 JSON Schema。
 */
function buildVerdictSchema() {
  return {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["safe", "unsafe"] as const,
        description: "审核结论：safe=安全放行, unsafe=危险命令",
      },
      reason: {
        type: "string" as const,
        description: "当 verdict 为 unsafe 时，必须填写具体原因说明违反了哪条安全规则",
      },
    },
    required: ["verdict"] as const,
  } as const
}

/**
 * 从 assistant 消息的 parts 中提取最后一段文本内容。
 * 兼容 SessionV1.Part 的松散类型结构。
 */
function lastText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text != null)
    .map((p) => p.text!)
    .join("\n")
}

/**
 * Bash 安全审核入口。
 *
 * 为待执行的 bash 命令创建一个独立的审核 session，
 * 使用 format=json_schema 注入 StructuredOutput 工具，
 * 审核模型通过该工具返回结构化审核结论。
 * 审核 session 中禁用所有注册工具，只有 StructuredOutput 可用。
 *
 * 返回 undefined = 审核通过放行，
 * 返回 Tool.ExecuteResult 含 intercepted = 审核拦截。
 */
export const bashReview = Effect.fn("BashReview.run")(function* (
  args: Record<string, unknown>,
  ctx: { sessionID: string; messages: readonly { info: { role: string }; parts: { type: string; text?: string }[] }[]; extra?: Record<string, unknown> },
  input: {
    agent: Agent.Info
    session: Session.Info
    promptOps: TaskPromptOps
  },
  sessionSvc: Session.Interface,
  instanceCtx: InstanceContext,
) {
  const command = String(args.command ?? "")
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
    title: `bash review: ${(description || command).slice(0, 60)}`,
    agent: input.agent.name,
  })

  // 2. 渲染审核 prompt + 构造 Schema
  const reviewPrompt = renderPrompt(command, description, instanceCtx, userMessage, agentRationale)
  const verdictSchema = buildVerdictSchema()

  // 3. 执行审核 prompt，使用 StructuredOutput 确保结构化回复
  const result = yield* input.promptOps.prompt({
    sessionID: reviewSession.id,
    parts: [{ type: "text" as const, text: reviewPrompt }],
    format: new SessionV1.OutputFormatJsonSchema({ type: "json_schema", schema: verdictSchema }),
    tools: { "*": false },
  })

  // 4. 解析审核结论
  const output = lastText((result).parts as { type: string; text?: string }[])
  const verdict = parseVerdict(output)

  if (!verdict) {
    return {
      title: description || "shell",
      output: "[Bash Review Blocked] 审核未返回有效结论（格式异常），命令已被拦截。",
      metadata: { intercepted: { rule: "bash_review_format_error", reason: "审核 LLM 未返回 SAFE/UNSAFE 格式的结论" } },
    }
  }

  if (verdict.verdict === "unsafe") {
    return {
      title: description || "shell",
      output: `[Bash Review Blocked] 安全审核未通过：${verdict.reason}`,
      metadata: { intercepted: { rule: "bash_review", reason: verdict.reason } },
    }
  }

  // safe：放行
})

export * as BashReview from "./bash-review"
