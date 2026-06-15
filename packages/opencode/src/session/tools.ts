import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "@/provider/provider"
import { getDatabaseChannel } from "@opencode-ai/core/installation/version"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { isEvolveMode } from "@/evolve/file-protocol"

import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect, Option } from "effect"
import * as DateTime from "effect/DateTime"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { InstanceState } from "@/effect/instance-state"
import { bashReview } from "./bash-review"
import { toolCodeReview } from "./tool-review"
import { PartID, SessionID } from "./schema"
import { Todo } from "./todo"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { toolText } from "@opencode-ai/llm"

const log = EffectLogger.create({ service: "session.tools" })

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const sessionSvc = yield* Session.Service
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const events = yield* EventV2Bridge.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  const config = yield* Config.Service

  const fullCfg = yield* config.get()
  const autoPlanCfg = fullCfg.auto_plan
  const autoPlanEnabled = autoPlanCfg?.enabled ?? true
  const blockedEditTools = new Set(
    autoPlanCfg?.blocked_tools ?? ["edit", "write", "apply_patch", "bash", "task"],
  )

  // 动态计算 auto-plan 阈值：plan 条目数 * 10K，无 plan 时无穷大（永远阻断）
  // 动态计算 auto-plan 阈值：plan 条目数 * 10K，无 plan 时无穷大（永远阻断）
  // 预计算一次，后续工具执行复用此值
  const planThreshold = yield* Effect.gen(function* () {
    const todoSvc = yield* Todo.Service
    const todos = yield* todoSvc.get(SessionID.make(input.session.id)).pipe(Effect.catch(() => Effect.succeed([] as Todo.Info[])))
    const active = todos.filter((t) => t.status === "pending" || t.status === "in_progress").length
    const ctxLimit = input.model.limit.context || 1_000_000
    if (active === 0) return { active: 0, target: Infinity, rawTarget: Infinity, label: "∞ (无 plan)" } as const
    return { active, target: (active * 10000) / ctxLimit, rawTarget: active * 10000, label: `plan ${active} 项 × 10K = ${((active * 10000) / ctxLimit * 100).toFixed(0)}%` } as const
  })

  const channel = getDatabaseChannel()
  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    channel,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      Effect.gen(function* () {
        const part = yield* input.processor.updateToolCall(options.toolCallId, (match) => {
          if (!["running", "pending"].includes(match.state.status)) return match
          return {
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: { start: Date.now() },
            },
          }
        })
        // 同步发布 Tool.Progress 事件，使 V2 TUI 获得实时进度更新
        if (part && options.toolCallId) {
          const progressText = val.title ?? ""
          yield* events.publish(SessionEvent.Tool.Progress, {
            sessionID: input.session.id,
            assistantMessageID: input.processor.message.id as any,
            callID: options.toolCallId,
            timestamp: DateTime.makeUnsafe(Date.now()),
            structured: val.metadata ?? {},
            content: progressText ? [ToolOutput.text({ type: "text", text: progressText })] : [],
          }).pipe(Effect.ignore)
        }
        return part
      }),
    ask: (req) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  for (const item of yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            // 非进化模式下禁止执行 evolve 工具
            if (item.id === "evolve" && !isEvolveMode()) {
              return {
                title: "Evolve tool blocked",
                output: "进化模式未激活，不能调用 evolve 工具。请先使用「进化:」指令进入进化模式。",
                metadata: {},
              }
            }
            // auto-plan 模式：按 plan 条目动态计算阈值，无 plan 时永远阻断
            if (autoPlanEnabled && blockedEditTools.has(item.id)) {
              const usage = yield* sessionSvc.contextUsage(ctx.sessionID)
              const thresholdMet = usage && usage.percentage >= planThreshold.target
              if (!thresholdMet) {
                const noPlan = planThreshold.active === 0
                const output = noPlan
                  ? [
                      `[Blocked by auto-plan]`,
                      `当前没有待完成的 plan 条目。`,
                      `编辑工具已被阻断，请先使用 todowrite 工具创建 plan（任务列表），`,
                      `列出需要完成的任务条目。创建设 plan 后编辑工具将按条目数量自动解锁。`,
                    ].join("\n")
                  : [
                      `[Blocked by auto-plan]`,
                      `Context: ${(usage!.percentage * 100).toFixed(1)}% (${usage!.usedTokens.toLocaleString()} / ${usage!.contextLimit.toLocaleString()} token). Need ${planThreshold.rawTarget.toLocaleString()} tokens (${planThreshold.active} plan items).`,
                      `Gather information first using read-only tools (read, grep, glob, question).`,
                    ].join("\n")
                return {
                  title: "Tool blocked (auto-plan)",
                  output,
                  metadata: { intercepted: { rule: "auto_plan", reason: noPlan ? "No plan items" : "Context threshold not met" } },
                }
              }
            }
            const beforeOutput = yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args, allowed: true, blockReason: "" },
            )
            if (beforeOutput.allowed === false) {
              return {
                title: "Tool blocked",
                output: beforeOutput.blockReason ?? "This tool is currently blocked by policy.",
                metadata: {
                  intercepted: {
                    rule: "plugin_blocked",
                    reason: beforeOutput.blockReason ?? "Blocked",
                  },
                },
              }
            }

            // ★ Bash 安全审核：权限自动放行时启动语义审核
            if (item.id === "bash") {
              const mergedRules = Permission.merge(
                input.agent.permission,
                input.session.permission ?? [],
              )
              const bashRule = Permission.evaluate("bash", "*", mergedRules)
              const bashReviewEnabled = fullCfg.experimental?.bash_review ?? true

              if (bashRule.action === "allow" && bashReviewEnabled) {
                const instanceCtx = yield* InstanceState.context
                const reviewResult = yield* Effect.catch(
                  bashReview(args, ctx, input, sessionSvc, instanceCtx),
                  (_) => {
                    log.warn("bash review failed, allowing command")
                    return Effect.succeed(undefined)
                  },
                )
                if (reviewResult) return reviewResult
              }
            }

            // ★ dynamic_tool 代码审核：对 execute 参数进行 LLM 安全与质量审核
            if (item.id === "dynamic_tool" && typeof args.execute === "string" && args.execute.length > 0) {
              const mergedRules = Permission.merge(
                input.agent.permission,
                input.session.permission ?? [],
              )
              const toolReviewEnabled = (fullCfg.experimental as Record<string, boolean> | undefined)?.tool_review ?? true
              const toolRule = Permission.evaluate("dynamic_tool", "*", mergedRules)

              if (toolRule.action === "allow" && toolReviewEnabled) {
                const instanceCtx = yield* InstanceState.context
                const reviewResult = yield* Effect.catch(
                  toolCodeReview(String(args.execute), String(args.description ?? ""), ctx, input, sessionSvc, instanceCtx),
                  (_) => {
                    log.warn("dynamic_tool review failed, allowing code")
                    return Effect.succeed(undefined)
                  },
                )
                if (reviewResult) return reviewResult
              }
            }

            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          // auto-plan 模式：按 plan 条目动态计算阈值，无 plan 时永远阻断
          if (autoPlanEnabled && blockedEditTools.has(key)) {
            const usage = yield* sessionSvc.contextUsage(ctx.sessionID)
            const thresholdMet = usage && usage.percentage >= planThreshold.target
            if (!thresholdMet) {
              const noPlan = planThreshold.active === 0
              const output = noPlan
                ? [
                    `[Blocked by auto-plan]`,
                    `当前没有待完成的 plan 条目。`,
                    `编辑工具已被阻断，请先使用 todowrite 工具创建 plan（任务列表），`,
                    `列出需要完成的任务条目。创建设 plan 后编辑工具将按条目数量自动解锁。`,
                  ].join("\n")
                : [
                    `[Blocked by auto-plan]`,
                    `Context: ${(usage!.percentage * 100).toFixed(1)}% (${usage!.usedTokens.toLocaleString()} / ${usage!.contextLimit.toLocaleString()} token). Need ${planThreshold.rawTarget.toLocaleString()} tokens (${planThreshold.active} plan items).`,
                    `Gather information first using read-only tools (read, grep, glob, question).`,
                  ].join("\n")
              return {
                title: "Tool blocked (auto-plan)",
                output,
                metadata: { intercepted: { rule: "auto_plan", reason: noPlan ? "No plan items" : "Context threshold not met" } },
              }
            }
          }
          const mcpBeforeOutput = yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args, allowed: true, blockReason: "" },
          )
          if (mcpBeforeOutput.allowed === false) {
            return {
              title: "Tool blocked",
              output: mcpBeforeOutput.blockReason ?? "This tool is currently blocked by policy.",
              metadata: {
                intercepted: {
                  rule: "plugin_blocked",
                  reason: mcpBeforeOutput.blockReason ?? "Blocked",
                },
              },
            }
          }
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return tools
})

export * as SessionTools from "./tools"
