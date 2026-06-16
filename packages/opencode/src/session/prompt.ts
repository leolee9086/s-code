import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { isEvolveMode, readEvolveMessage, writeEvolveMessage } from "../evolve/file-protocol"
import { isForeverMode, setForeverMode, clearForeverMode, checkBudget } from "../forever/forever"
import type { ForeverConfigShape } from "../forever/forever"
import { ForeverState } from "../forever/state"
import { ForeverCondition } from "../forever/condition"
import { resolveForeverPrompt } from "../forever/prompt"
import { EffectBridge } from "@/effect/bridge"
import { Injection } from "./injection"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Todo } from "./todo"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { PrefixCommand } from "@/prefix-command"
import { PhraseBan } from "@/content-filter/phrase-ban"
import { getDatabaseChannel } from "@opencode-ai/core/installation/version"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, Prompt, ReferenceAttachment, Source } from "@opencode-ai/core/session/prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { referencePromptMetadata, referenceTextPart } from "./prompt/reference"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `使用此工具以请求的结构化格式返回你的最终回复。

重要：
- 你必须在回复结束时精确调用此工具一次
- 输入必须是符合所需模式的合法 JSON
- 在调用此工具**之前**完成所有必要的研究和工具调用
- 此工具提供你的最终答案——调用后不再采取进一步操作`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `重要：用户已请求结构化输出。你必须使用 StructuredOutput 工具来提供你的最终回复。不要以纯文本回复——你必须调用 StructuredOutput 工具，并根据模式格式化你的答案。`

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly interruptAndInject: (sessionID: SessionID, text: string) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<SessionV1.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const injection = yield* Injection.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const references = yield* Reference.Service
    const events = yield* EventV2Bridge.Service
    const prefixCmd = yield* PrefixCommand.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const foreverStateOption = yield* Effect.serviceOption(ForeverState.StatePersistenceService)
    const conditionEngineOption = yield* Effect.serviceOption(ForeverCondition.ConditionEngineService)
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* state.cancel(sessionID)
    })

    /** 构造一条独立的合成 user 消息并写入数据库，返回创建的消息。
     *  统一了此前散落在 evolve/forever/auto-plan/injectUserMessage 等处的
     *  updateMessage + updatePart 重复模板。以 base.agent/base.model 为准，
     *  保证注入消息的 agent/model 与当前对话上下文连续。 */
    const createUserTextMessage = Effect.fn("SessionPrompt.createUserTextMessage")(function* (
      sessionID: SessionID,
      parts: Array<{ text: string; synthetic?: boolean }>,
      base: { agent: string; model: SessionV1.User["model"] },
    ) {
      const msg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: base.agent,
        model: base.model,
      }
      yield* sessions.updateMessage(msg)
      for (const p of parts) {
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID,
          type: "text",
          text: p.text,
          synthetic: p.synthetic ?? true,
        } satisfies SessionV1.TextPart)
      }
      return msg
    })

    /** 创建一条独立的合成用户消息并写入数据库。
     *  以最后一条用户消息的 agent/model 为准，确保模型推理时上下文连续。 */
    const injectUserMessage = Effect.fn("SessionPrompt.injectUserMessage")(function* (
      sessionID: SessionID,
      text: string,
    ) {
      const msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
        Effect.provideService(Database.Service, database),
      )
      const { user: lastUser } = MessageV2.latest(msgs)
      if (!lastUser) {
        yield* elog.warn("injectUserMessage: no user message found", { sessionID })
        return
      }
      yield* createUserTextMessage(sessionID, [{ text }], lastUser)
    })

    /** 打断当前 LLM 循环 → 注入独立用户消息 → 重启循环。
     *  用于 Ring 0 外部消息入站，让 LLM 立即感知新消息。 */
    const interruptAndInject = Effect.fn("SessionPrompt.interruptAndInject")(function* (
      sessionID: SessionID,
      text: string,
    ) {
      yield* elog.info("interruptAndInject", { sessionID })
      yield* state.cancel(sessionID)
      yield* injectUserMessage(sessionID, text)
      yield* Effect.forkIn(scope)(loop({ sessionID }).pipe(Effect.asVoid, Effect.ignore))
    })

    const resolveReferenceParts = Effect.fnUntraced(function* (template: string) {
      const parts: Types.DeepMutable<PromptInput["parts"]> = []
      const seen = new Set<string>()
      yield* Effect.forEach(
        ConfigMarkdown.files(template),
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          const alias = name.split("/")[0]
          if (!alias || seen.has(alias)) return
          const reference = yield* references.get(alias)
          if (!reference) return
          seen.add(alias)

          const start = match.index ?? 0
          const source = { value: match[0], start, end: start + match[0].length }
          if (reference.kind === "invalid") {
            parts.push(referenceTextPart({ reference, source }))
            return
          }

          yield* references.ensure(reference.path)
          parts.push({
            type: "file",
            url: pathToFileURL(reference.path).href,
            filename: alias,
            mime: "application/x-directory",
            source: { type: "file", text: source, path: alias },
          })
        }),
        { concurrency: 1, discard: true },
      )
      return parts
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [
        { type: "text", text: template },
        ...(yield* resolveReferenceParts(template)),
      ]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const slash = name.indexOf("/")
          const alias = slash === -1 ? name : name.slice(0, slash)
          if (yield* references.get(alias)) return

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          channel: getDatabaseChannel(),
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Shell.Started, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: DateTime.makeUnsafe(started),
                callID: part.callID,
                command: input.command,
              })
            }
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Shell.Ended, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const current = yield* db
        .select({ agent: SessionTable.agent, model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      if (current?.agent !== info.agent) {
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    channel: getDatabaseChannel(),
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      type MatchedPrefix = { match: PrefixCommand.MatchResult; index: number }
      const matchedPrefixes: MatchedPrefix[] = []
      for (const [i, part] of input.parts.entries()) {
        if (part.type !== "text") continue
        const m = yield* prefixCmd.match(part.text)
        if (!m) continue
        matchedPrefixes.push({ match: m, index: i })
      }
      for (const { match } of matchedPrefixes) {
        const { info, args } = match
        const phrases = args.trim().split(/\s+/).filter(Boolean)
        if (info.builtin === "ban") {
          for (const phrase of phrases) {
            yield* PhraseBan.ban(input.sessionID, phrase)
            log.info("phrase banned", { sessionID: input.sessionID, phrase })
          }
        }
        if (info.builtin === "unban") {
          for (const phrase of phrases) {
            yield* PhraseBan.unban(input.sessionID, phrase)
            log.info("phrase unbanned", { sessionID: input.sessionID, phrase })
          }
        }
        if (info.builtin === "enter-evolve") {
          process.env["S_CODE_EVOLVE"] = "1"
          if (args.trim()) writeEvolveMessage(args.trim())
          log.info("evolve mode entered by prefix command", { sessionID: input.sessionID })
        }
        if (info.builtin === "exit-evolve") {
          delete process.env["S_CODE_EVOLVE"]
          log.info("evolve mode exited by prefix command", { sessionID: input.sessionID })
        }
        if (info.builtin === "enter-forever") {
          setForeverMode()
          log.info("forever mode entered by prefix command", { sessionID: input.sessionID })
        }
        if (info.builtin === "exit-forever") {
          clearForeverMode()
          log.info("forever mode exited by prefix command", { sessionID: input.sessionID })
        }
      }

      const submittedParts: Types.DeepMutable<PromptInput["parts"]> = input.parts.map((part, i) => {
        const mp = matchedPrefixes.find((d) => d.index === i)
        if (!mp || part.type !== "text") return part
        const { info, args } = mp.match
        const trimmed = args.trim()
        let feedback: string
        switch (info.builtin) {
          case "ban": feedback = `[指令已执行: 禁止 "${trimmed}"]`; break
          case "unban": feedback = `[指令已执行: 允许 "${trimmed}"]`; break
          case "enter-evolve": feedback = `[指令已执行: 进入进化模式]${args.trim() ? " " + args.trim() : ""}`; break
          case "exit-evolve": feedback = `[指令已执行: 退出进化模式]`; break
          case "enter-forever": feedback = `[指令已执行: 进入永续模式]${args.trim() ? " " + args.trim() : ""}`; break
          case "exit-forever": feedback = `[指令已执行: 退出永续模式]`; break
          default: feedback = `[指令已执行]`
        }
        return { ...part, text: feedback }
      })

      const attachedReferences = new Set(
        submittedParts.flatMap((part) =>
          part.type === "file" && part.mime === "application/x-directory" ? [part.url] : [],
        ),
      )
      for (const part of submittedParts) {
        if (part.type !== "text" || part.synthetic) continue
        for (const reference of yield* resolveReferenceParts(part.text)) {
          if (reference.type === "file" && attachedReferences.has(reference.url)) continue
          if (reference.type === "file") attachedReferences.add(reference.url)
          submittedParts.push(reference)
        }
      }

      const resolvedParts = yield* Effect.forEach(submittedParts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
            const reference = referencePromptMetadata(part.metadata?.reference)
            if (reference) {
              result.references.push(
                new ReferenceAttachment({
                  name: reference.name,
                  kind: reference.kind,
                  uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                  repository: reference.repository,
                  branch: reference.branch,
                  target: reference.target,
                  targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                  problem: reference.problem,
                  source: new Source({
                    start: reference.source.start,
                    end: reference.source.end,
                    text: reference.source.value,
                  }),
                }),
              )
            }
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          references: [] as ReferenceAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Prompted, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          delivery: "steer",
          prompt: new Prompt({
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
            references: nextPrompt.references,
          }),
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Synthetic, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn(
      "SessionPrompt.prompt",
    )(function* (input: PromptInput) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (input.noReply === true) return message
      return yield* loop({ sessionID: input.sessionID })
    })

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop = Effect.fnUntraced(function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown
        let step = 0
        let consecutiveErrors = 0
        const ERROR_STORM_THRESHOLD = 3
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        // ── 注入三入口 ──────────────────────────────────────────────
        // 按入库/驱动循环两个维度区分，统一将内容放在消息序列绝对末尾，
        // 保证已有的历史前缀 [sys][u1][a1]... 全部命中 provider 的 prefix cache。
        //
        // 1. inject — transient：在内存 msgs 末尾追加独立 synthetic user 消息。
        //    不入库，本轮 toModelMessages 即可见，用于 env/工具清单等每轮变动的上下文。
        //    前缀缓存最优：历史消息不变，只有新增尾部未命中。
        const inject = (
          msgsRef: SessionV1.WithParts[],
          parts: Array<{ type: "text"; text: string }>,
          base: { agent: string; model: SessionV1.User["model"] },
        ) => {
          const id = MessageID.ascending()
          msgsRef.push({
            info: {
              id,
              sessionID,
              role: "user",
              time: { created: Date.now() },
              agent: base.agent,
              model: base.model,
            },
            parts: parts.map((p) => ({
              id: PartID.ascending(),
              messageID: id,
              sessionID,
              type: "text" as const,
              text: p.text,
              synthetic: true,
            })),
          })
        }

        // 2. injectAndPersist — 入库新 user 消息，不干预循环流程。
        //    下一轮 filterCompacted 自然读到，由循环正常逻辑决定是否 continue。
        //    用于 auto-plan 等需要持久化、但无需强制续行的场景。
        const injectAndPersist = Effect.fnUntraced(function* (
          parts: Array<{ text: string; synthetic?: boolean }>,
          base: { agent: string; model: SessionV1.User["model"] },
        ) {
          return yield* createUserTextMessage(sessionID, parts, base)
        })

        // 3. injectAndContinue — 入库 + 返回 continue 信号。
        //    调用方 return 此结果以强制下一轮。用于 evolve/forever 等需续行的模式。
        const injectAndContinue = Effect.fnUntraced(function* (
          parts: Array<{ text: string; synthetic?: boolean }>,
          base: { agent: string; model: SessionV1.User["model"] },
        ) {
          yield* createUserTextMessage(sessionID, parts, base)
          return "continue" as const
        })
        // ────────────────────────────────────────────────────────────

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains
          // tool calls. Keep the loop running so tool results can be sent back to
          // the model, but ignore cleanup-marked interrupted orphans.
          const hasToolCalls =
            lastAssistantMsg?.parts.some(
              (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
            ) ?? false

          // 永续模式：通过 budget、条件引擎、plugin hook 共同决定是否继续
          if (isForeverMode() && !session.parentID) {
            const cfg = yield* config.get()
            const foreverCfg = cfg.forever as ForeverConfigShape | undefined

            // 0. 错误风暴检测 — 连续 N 轮 LLM 返回 error 时自动退出
            if (lastAssistant?.error) {
              consecutiveErrors++
            } else {
              consecutiveErrors = 0
            }
            if (consecutiveErrors >= ERROR_STORM_THRESHOLD) {
              yield* slog.warn("exiting loop (too many consecutive errors)", { count: consecutiveErrors })
              break
            }

            // 1. Budget 检查（仅在 StatePersistenceService 可用时）
            if (Option.isSome(foreverStateOption)) {
              const svc = foreverStateOption.value
              const budgetState = yield* svc.readBudgetState(sessionID)
              const budget = checkBudget(foreverCfg, budgetState)
              if (!budget.allowed) {
                yield* slog.info("exiting loop (forever budget exhausted)", { reason: budget.reason })
                break
              }
            }

            // 2. 条件引擎检查 — 仅在有条件配置时阻塞等待（服务可选）
            const hasConditions = !!(foreverCfg?.conditions?.file_watch?.enabled || foreverCfg?.conditions?.timer?.enabled)
            if (hasConditions && Option.isSome(conditionEngineOption)) {
              const engine = conditionEngineOption.value
              const cs = yield* engine.getState()
              const shouldResume = yield* engine.shouldResume(cs)
              if (!shouldResume) {
                yield* slog.info("loop waiting (forever conditions not met)")
                break
              }
            }

            // 3. Plugin hook — 允许外部控制器决定是否继续
            const continueResult: {
              shouldContinue: boolean
              reason?: string
              sleepMs?: number
              conditionState?: Record<string, unknown>
            } = yield* plugin.trigger(
              "loop.continue",
              {
                sessionID,
                round: step,
                lastFinish: lastAssistant?.finish,
                hasToolCalls,
                isForeverMode: true,
              },
              { shouldContinue: true },
            )
            if (!continueResult.shouldContinue) {
              yield* slog.info("exiting loop (forever mode plugin declined)")
              break
            }

            // 3.5. 支持 sleepMs — 插件要求在下轮之前等待
            if (continueResult.sleepMs && continueResult.sleepMs > 0) {
              yield* slog.info("sleeping before next forever round", { sleepMs: continueResult.sleepMs })
              yield* Effect.sleep(`${continueResult.sleepMs} millis`)
            }

            // 4. 更新 budget 状态（轮次计数）
            if (Option.isSome(foreverStateOption)) {
              yield* foreverStateOption.value.updateBudgetState(sessionID, { rounds: 1 })
            }
          } else if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id &&
            (!isEvolveMode() || session.parentID)
          ) {
            const orphan = lastAssistantMsg?.parts.find(
              (part): part is SessionV1.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
            )
            if (orphan) {
              yield* slog.warn("loop exit with orphaned interrupted tool", {
                messageID: lastAssistant.id,
                tool: orphan.tool,
                callID: orphan.callID,
              })
            }
            yield* slog.info("exiting loop")
            break
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
            Effect.provideService(RuntimeFlags.Service, flags),
            Effect.provideService(FSUtil.Service, fsys),
            Effect.provideService(Session.Service, sessions),
          )

          const msg: SessionV1.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
            const promptOps = yield* ops()

            const tools = yield* SessionTools.resolve({
              agent,
              session,
              model,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              promptOps,
            }).pipe(
              Effect.provideService(Plugin.Service, plugin),
              Effect.provideService(Permission.Service, permission),
              Effect.provideService(ToolRegistry.Service, registry),
              Effect.provideService(MCP.Service, mcp),
              Effect.provideService(Truncate.Service, truncate),
            )

            if (lastUser.format?.type === "json_schema") {
              // Schema.Json 包含 null，但在 type==="json_schema" 时始终为非 null 对象
              const schema = lastUser.format.schema as Record<string, any>
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            // 通用前缀注入：注入调用方设置的 prefix 消息
            // 优先级：显式注入 > 进化文件协议
            let injectedPrefix = false
            const prefixParts = yield* injection.consumePrefix(sessionID)
            if (prefixParts.length > 0) {
              const userEntry = msgs.find((m) => m.info.id === lastUser.id)
              if (userEntry) {
                for (const p of prefixParts) {
                  userEntry.parts.push({
                    id: PartID.ascending(),
                    messageID: lastUser.id,
                    sessionID,
                    type: p.type as "text",
                    text: p.text,
                    synthetic: p.synthetic ?? true,
                  })
                }
                injectedPrefix = true
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            // 环境信息 + 自定义工具清单每轮都会变动（git 状态、日期、子 session 数、
            // 工具 mtime 排序等），不能塞进消息序列中部，否则在多步工具调用循环中
            // 会破坏已有消息的前缀缓存。
            // 用 inject() 在内存 msgs 末尾追加一条独立的 synthetic user 消息：
            //   - 不入库：纯 transient，下一轮重新计算，避免污染持久历史。
            //   - 位置在序列绝对末尾：历史消息 [sys][u1][a1]... 全部命中 prefix cache，
            //     只有这条新尾部未命中，达到真正的前缀缓存友好。
            //   - 此处先于下方 toModelMessagesEffect(msgs) 执行，本轮即可被模型看到。
            const [env, toolsText] = yield* Effect.all([
              sys.environment(model, sessionID),
              sys.custom_tools(),
            ] as const)
            const envToolParts: string[] = []
            if (env.length > 0 && env.some(Boolean)) envToolParts.push(env.filter(Boolean).join("\n"))
            if (toolsText) envToolParts.push(toolsText)
            if (envToolParts.length > 0) {
              const tagged = [
                "<system-reminder>",
                envToolParts.join("\n\n"),
                "</system-reminder>",
              ].join("\n")
              inject(
                msgs,
                [{ type: "text", text: tagged }],
                { agent: lastUser.agent, model: lastUser.model },
              )
            }

            const [skills, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            const system = [...instructions, ...(skills ? [skills] : [])]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)

            // auto-plan 模式：以 synthetic user message 追加到数据库，
            // 与进化模式/永续模式注入方式一致，确保自动排在消息序列末尾，
            // 避免动态百分比破坏开头消息的 prefix caching。
            // 子任务 session（有 parentID）跳过 auto-plan 注入：
            // auto-plan 的 synthetic user message 会获得比当前 assistant 更高的
            // MessageID，导致循环退出条件（lastUser.id < lastAssistant.id）永远不满足，
            // 使子 task 无限循环无法结束。
            const autoPlanCfg = (yield* config.get()).auto_plan
            const autoPlanEnabled = autoPlanCfg?.enabled ?? true
            let autoPlanContextSufficient = false
            if (autoPlanEnabled && !session.parentID) {
              const blockedTools = autoPlanCfg?.blocked_tools ?? ["edit", "write", "apply_patch", "bash", "task"]

              // 动态计算阈值：plan 条目数 * 10K，无 plan 时无穷大（永远阻断）
              const planInfo = yield* Effect.gen(function* () {
                const todoSvc = yield* Todo.Service
                const todos = yield* todoSvc.get(sessionID).pipe(Effect.catch(() => Effect.succeed([] as Todo.Info[])))
                const hasPlan = todos.length > 0
                const active = todos.filter((t) => t.status === "pending" || t.status === "in_progress").length
                if (active === 0) return { active: 0, hasPlan, target: Infinity, label: "∞" } as const
                const ctxLimit = model.limit.context || 1_000_000
                return { active, hasPlan: true, target: (active * 10000) / ctxLimit, rawTarget: active * 10000, label: `${active}×10K` } as const
              })

              const usage = yield* sessions.contextUsage(sessionID).pipe(Effect.option)
              if (Option.isSome(usage) && usage.value) {
                const u = usage.value

                if (planInfo.active === 0) {
                  if (!planInfo.hasPlan) {
                    // 从未创建 plan → 永远阻断，要求先创建 plan
                    const autoPlanText = [
                      `<auto-plan>`,
                      `  编辑工具（${blockedTools.join("、")}）需先创建 plan（任务列表）后才可用`,
                      `  当前没有待完成的计划条目。请使用 todowrite 工具列出需要完成的任务。`,
                      `  创建 plan 后编辑工具将按条目数量自动解锁：条目数 × 10K token`,
                      `  低于阈值时仅限使用只读工具（read、grep、glob、question）收集信息`,
                      `</auto-plan>`,
                    ].join("\n")
                    yield* injectAndPersist(
                      [{ text: autoPlanText }],
                      { agent: lastUser.agent, model: lastUser.model },
                    )
                  }
                  // plan 全部完成：阻断编辑工具，但不自动续行，自然结束
                } else if (u.percentage >= planInfo.target) {
                  // 上下文占用已超过动态阈值，退出循环
                  autoPlanContextSufficient = true
                } else {
                  // 上下文不足，注入收集信息消息
                  const targetTokens = planInfo.active * 10000
                  const autoPlanText = [
                    `<auto-plan>`,
                    `  上下文占用：${u.usedTokens.toLocaleString()} / ${u.contextLimit.toLocaleString()} token（${(u.percentage * 100).toFixed(1)}%）`,
                    `  编辑工具（${blockedTools.join("、")}）需积累 ${targetTokens.toLocaleString()} tokens 后才可用（当前 ${u.usedTokens.toLocaleString()} / 目标 ${targetTokens.toLocaleString()}，${planInfo.active} 个 plan 条目）`,
                    `  低于阈值时仅限使用只读工具（read、grep、glob、question）收集信息`,
                    `  绝对禁止任何试图绕过上下文限制的行为`,
                    `  绝对禁止任何试图快速消耗上下文以达到阈值的行为，例如发送大量无意义文本或调用大量无用工具等`,
                    `  绝对禁止向用户要求建议或请求帮助关闭上下文限制`,
                    `</auto-plan>`,
                  ].join("\n")
                  yield* injectAndPersist(
                    [{ text: autoPlanText }],
                    { agent: lastUser.agent, model: lastUser.model },
                  )
                }
              } else if (!planInfo.hasPlan) {
                // 无 usage 信息（无 assistant 消息的初始状态），且从未创建 plan
                const autoPlanText = [
                  `<auto-plan>`,
                  `  编辑工具（${blockedTools.join("、")}）需先创建 plan（任务列表）后才可用`,
                  `  当前没有待完成的计划条目。请使用 todowrite 工具列出需要完成的任务。`,
                  `  创建 plan 后编辑工具将按条目数量自动解锁：条目数 × 10K token`,
                  `  低于阈值时仅限使用只读工具（read、grep、glob、question）收集信息`,
                  `</auto-plan>`,
                ].join("\n")
                yield* injectAndPersist(
                  [{ text: autoPlanText }],
                  { agent: lastUser.agent, model: lastUser.model },
                )
              }
            }

            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
            })

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new SessionV1.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (isEvolveMode() && !session.parentID && (result === "continue" || result === "stop")) {
              // 进化模式：仅当最后一条 user message 是系统合成时才强制继续
              const lastUserMsg = msgs.findLast(
                (m) => m.info.role === "user" && m.info.id === lastUser.id,
              )
              if (lastUserMsg?.parts.some((p) => p.type === "text" && p.synthetic)) {
                return yield* injectAndContinue(
                  [{
                    text: `<system-reminder>
你当前处于进化模式，
这个模式的作用是在不需要用户输入的情况下,不断改进你自身的代码实现,以更好地完成任务。
如果你认为存在用户给出的明确指令或者任务,应该先完成它们。
否则你应该分析当前你自身的代码状态和历史session中的信息，总结自己需要哪些新的特性或者改进。
例如：更多的工具调用能力，更好的错误处理和恢复能力等一切你能够想到能为用户提供帮助的能力。
找到方向之后，你会编写详细的实现计划，然后以最佳实践开始实现它们。
在进化模式下你不能直接回复文字，因为这是一个默认人不在回路的无限循环，你能做的只有改进你自己的代码以及进入下一轮进化。
必须调用 evolve({ message: '本轮总结和下轮目标' }) 来让你的修改进入二进制并结束本轮进化。
请分析进展并使用工具，完成你对自身的改进之后，调用 evolve工具。
</system-reminder>`,
                  }],
                  { agent: lastUser.agent, model: lastUser.model },
                )
              }
            }

            // 永续模式：通过 plugin hook 注入合成消息以继续循环
            if (isForeverMode() && !session.parentID) {
              const injectResult = yield* plugin.trigger<"loop.inject">(
                "loop.inject",
                {
                  sessionID,
                  round: step,
                  lastFinish: handle.message.finish,
                  isForeverMode: true,
                },
                { parts: [] },
              )
              const injectedParts = injectResult.parts as Array<{ type: "text"; text: string; synthetic?: boolean }>
              // 默认行为：无插件处理时使用配置的永续 prompt 自动续行
              const defaultPrompt = (yield* config.get()).forever?.prompt?.default ?? "Continue the forever mode task."
              const parts = injectedParts.length > 0
                ? injectedParts
                : [{ type: "text" as const, text: defaultPrompt, synthetic: true as const }]
              // 永续模式注入后检查 compaction overflow，防止消息无限积累
              if (lastFinished && lastFinished.summary !== true) {
                const overflow = yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }).pipe(
                  Effect.catch(() => Effect.succeed(false)),
                )
                if (overflow) {
                  yield* compaction.create({
                    sessionID,
                    agent: lastUser.agent,
                    model: lastUser.model,
                    auto: true,
                    overflow: true,
                  })
                }
              }
              return yield* injectAndContinue(
                parts.map((p) => ({ text: p.text, synthetic: p.synthetic ?? true })),
                { agent: lastUser.agent, model: lastUser.model },
              )
            }
            if (result === "stop") return "break" as const
            // 上下文充足后退出循环：
            //   - auto_plan 已启用且 context >= threshold → 无需再注入，退出
            //   - auto_plan 已禁用 → 无合成消息阻塞退出条件，直接退出
            // 上下文不足时保持循环，auto_plan 会继续注入驱动模型收集信息。
      /*      if (!isForeverMode() && !isEvolveMode()) {
              const assistantFinished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
              if (assistantFinished && (autoPlanContextSufficient || !autoPlanEnabled)) return "break" as const
            }*/
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }

            // 通用后缀注入：检查是否有调用方注入的后缀
            const suffixParts = yield* injection.consumeSuffix(sessionID)
            if (suffixParts.length > 0) {
              for (const p of suffixParts) {
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: lastUser.id,
                  sessionID,
                  type: p.type as "text",
                  text: p.text,
                  synthetic: p.synthetic ?? true,
                })
              }
            }

            // 轮次完成回调：允许外部程序化控制
            const roundHandler = yield* injection.getRoundHandler(sessionID)
            if (roundHandler) {
              // 从当前 assistant message 的 parts 中提取文本
              // 使用 findMessage 避免新增服务依赖（sessions 已从闭包中 resolve）
              const assistantMsg = yield* sessions.findMessage(sessionID, (m) => m.info.id === handle.message.id).pipe(
                Effect.map((o) => {
                  if (o._tag === "None") return undefined
                  return o.value.parts
                    .filter((p): p is SessionV1.TextPart => p.type === "text")
                    .map((p) => p.text)
                    .join("\n")
                    .trim() || undefined
                }),
                Effect.ignore,
              )
              const toolCalls = [] as Array<{ tool: string; callID: string }>
              const decision = yield* roundHandler({
                sessionID,
                round: step,
                finish: handle.message.finish,
                toolCalls,
                lastAssistantMessage: assistantMsg ?? undefined,
              })
              if (decision.action === "stop") {
                return "break" as const
              }
              if (decision.action === "inject") {
                for (const p of decision.parts) {
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: lastUser.id,
                    sessionID,
                    type: p.type as "text",
                    text: p.text,
                    synthetic: p.synthetic ?? true,
                  })
                }
              }
              // "continue" → 继续循环
            }

            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    // 永续模式背景轮询：按间隔检查条件引擎，条件满足时自动重新进入循环
    // 使用 let 提前声明以解决 loop 函数中的前向引用
    let foreverPollLoop: (sessionID: SessionID) => Effect.Effect<void>

    const loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts> = Effect.fn("SessionPrompt.loop")(
      function* (input: LoopInput) {
        const sessionInfo = yield* sessions.get(input.sessionID).pipe(Effect.option)
        const isRootSession = Option.isSome(sessionInfo) && !sessionInfo.value.parentID

        // 进化模式：如有待处理的续进消息，自动创建一条用户消息并持久化到数据库。
        // runLoop 随后会加载到这条新消息并自然继续处理（即使 session 之前已完成），
        // 无需用户手动输入任何内容。
        // 子任务 session（有 parentID）跳过进化模式续进消息注入。
        if (isEvolveMode() && isRootSession) {
          const evolveMsg = readEvolveMessage()
          if (evolveMsg) {
            const msgs = yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
              Effect.provideService(Database.Service, database),
            )
            const { user: lastUser } = MessageV2.latest(msgs)
            if (lastUser) {
              yield* createUserTextMessage(
                input.sessionID,
                [{ text: evolveMsg }],
                lastUser,
              )
            }
          }
        }

        // 永续模式：进入时自动注入一条续行用户消息，驱动循环运行。
        // 子任务 session（有 parentID）跳过永续模式逻辑，否则 task agent 会错误地进入永续循环，
        // 导致子 task 永远无法结束。
        if (isForeverMode() && isRootSession) {
          // 创建 EffectBridge，用于在 setInterval 回调中注入后缀消息
          const foreverBridge = yield* EffectBridge.make()
          // 初始化条件引擎（如配置了 file_watch/timer，服务可选）
          const cfg = yield* config.get()
          const foreverCfg = cfg.forever as ForeverConfigShape | undefined
          if (foreverCfg?.conditions && Option.isSome(conditionEngineOption)) {
            const notifyText = cfg.forever?.prompt?.default ?? "Continue the forever mode task."
            yield* conditionEngineOption.value.init(
              foreverCfg.conditions,
              // 条件满足时通过 bridge 注入后缀消息，为下一轮循环准备
              () => {
                foreverBridge.fork(
                  injection.setSuffixOnce(input.sessionID, [
                    { type: "text" as const, text: notifyText, synthetic: true },
                  ]),
                )
              },
            ).pipe(Effect.ignore)
          }
          // 初始化 budget 状态（服务可选）
          if (Option.isSome(foreverStateOption)) {
            yield* foreverStateOption.value.readBudgetState(input.sessionID).pipe(Effect.ignore)
          }

          const msgs = yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
            Effect.provideService(Database.Service, database),
          )
          const { user: lastUser } = MessageV2.latest(msgs)
          // 只在最后一条消息是 assistant 且非 tool-calls 中止时注入
          const lastAssistantMsgDone = msgs.findLast((m) => m.info.role === "assistant") as
            | (SessionV1.WithParts & { info: SessionV1.Assistant })
            | undefined
          const shouldInject = !!(lastUser && lastAssistantMsgDone &&
            lastAssistantMsgDone.info.id > lastUser.id &&
            lastAssistantMsgDone.info.finish &&
            !["tool-calls"].includes(lastAssistantMsgDone.info.finish))
          if (shouldInject) {
            const source = cfg.forever?.prompt?.source as { type: string; command?: string; args?: string[]; url?: string; text?: string } | undefined
            const defaultText = cfg.forever?.prompt?.default ?? "Continue the forever mode task."
            const prompt = yield* resolveForeverPrompt(source, defaultText)
            yield* createUserTextMessage(
              input.sessionID,
              [{ text: prompt }],
              lastUser,
            )
          }
        }

        const loopResult: SessionV1.WithParts = yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID) as Effect.Effect<SessionV1.WithParts>)

        // 永续模式：仅对根 session 启动背景轮询 fiber，等待条件满足后自动重新进入。
        // 子任务 session 不启动背景轮询，防止 task agent 被永续模式劫持。
        if (isForeverMode() && isRootSession && Option.isSome(conditionEngineOption)) {
          yield* Effect.forkIn(scope)(foreverPollLoop(input.sessionID)).pipe(Effect.asVoid)
        }

        return loopResult
      },
    )

    // 永续模式背景轮询实现：在 loop 定义之后赋值
    foreverPollLoop = Effect.fn("SessionPrompt.foreverPollLoop")(function* (sessionID: SessionID) {
      const pollLog = elog.with({ sessionID })
      yield* pollLog.info("forever poll loop started")
      while (isForeverMode()) {
        yield* Effect.sleep("2 seconds")
        if (Option.isSome(conditionEngineOption)) {
          const engine = conditionEngineOption.value
          const cs = yield* engine.getState()
          const shouldResume = yield* engine.shouldResume(cs).pipe(Effect.catch(() => Effect.succeed(false)))
          if (shouldResume) {
            yield* pollLog.info("forever conditions met, re-entering loop")
            yield* loop({ sessionID }).pipe(Effect.ignore)
          }
        }
      }
      yield* pollLog.info("forever poll loop ended")
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })

      // 内建命令：停止进化/永续模式
      if (input.command === "stop-evolve") {
        delete process.env["S_CODE_EVOLVE"]
        yield* elog.info("evolve mode stopped by slash command")
        return yield* lastAssistant(input.sessionID)
      }
      if (input.command === "stop-forever") {
        clearForeverMode()
        if (Option.isSome(conditionEngineOption)) {
          yield* conditionEngineOption.value.dispose()
        }
        yield* elog.info("forever mode stopped by slash command")
        return yield* lastAssistant(input.sessionID)
      }

      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      interruptAndInject,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(
        Layer.mergeAll(
        Agent.defaultLayer,
        Database.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Reference.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
        EventV2Bridge.defaultLayer,
        Injection.defaultLayer,
        PrefixCommand.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"
