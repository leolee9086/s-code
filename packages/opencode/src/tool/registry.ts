import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { ReadTool } from "./read"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { WriteTool } from "./write"
import { ApplyPatchTool } from "./apply_patch"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { TodoWriteTool } from "./todo"
import { TaskTool } from "./task"
import { SkillTool } from "./skill"
import { InvalidTool } from "./invalid"
import { SessionQueryTool } from "./session_query"
import { SessionMessageReadTool } from "./session_message_read"
import { SpawnTool } from "./spawn"
import { RelayMessageTool } from "./relay-message"
import { SendChannelMessageTool } from "./send-channel-message"
import { ListChannelsTool } from "./list-channels"
import { ScreenshotTool } from "./screenshot"
import { DynamicTool, dynamicToolDefs } from "./dynamic"
import { BunSecurity } from "./bun-security"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"
import { Database } from "@opencode-ai/core/database/database"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolDefinition } from "@opencode-ai/plugin"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"

import * as Log from "@opencode-ai/core/util/log"
import { LspTool } from "./lsp"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { Format } from "../format"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { Reference } from "@/reference/reference"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { isEvolveMode } from "@/evolve/file-protocol"
import { ModelV2 } from "@opencode-ai/core/model"
import { fromPluginDef } from "./from-plugin"
import * as Truncate from "./truncate"

const log = Log.create({ service: "tool.registry" })

export function webSearchEnabled(providerID: ProviderV2.ID, _flags = { exa: false, parallel: false }): boolean {
  // 始终启用：内置 DuckDuckGo 搜索无需 API key
  return true
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    agent: Agent.Info
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | BackgroundJob.Service
  | Provider.Service
  | Reference.Service
  | LSP.Service
  | Instruction.Service
  | FSUtil.Service
  | EventV2Bridge.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
  | RuntimeFlags.Service
  | Database.Service
  | BunSecurity.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const sessionQuery = yield* SessionQueryTool
    const sessionMsgRead = yield* SessionMessageReadTool
    const spawn = yield* SpawnTool
    const relayMsg = yield* RelayMessageTool
    const sendChannelMsg = yield* SendChannelMessageTool
    const listChannels = yield* ListChannelsTool
    const screenshot = yield* ScreenshotTool
    const dynamicTool = yield* DynamicTool
    const agent = yield* Agent.Service

    const state = yield* InstanceState.make<State>(
      (ctx: InstanceContext) => Effect.gen(function* () {
        const custom: Tool.Def[] = []

        // Thin wrapper that binds the closure's ctx.directory / ctx.worktree
        const fromPlugin = (id: string, def: ToolDefinition, sourcePath?: string): Tool.Def =>
          fromPluginDef(id, def, sourcePath, ctx.directory, ctx.worktree, agent, truncate)

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def, match))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          session_query: Tool.init(sessionQuery),
          session_message_read: Tool.init(sessionMsgRead),
          spawn: Tool.init(spawn),
          relay_message: Tool.init(relayMsg),
          send_channel_message: Tool.init(sendChannelMsg),
           list_channels: Tool.init(listChannels),
           screenshot: Tool.init(screenshot),
           dynamic_tool: Tool.init(dynamicTool),
         })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.dynamic_tool,
            tool.todo,
            tool.search,
            tool.skill,
            tool.patch,
            ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ...(flags.experimentalPlanMode && flags.client === "cli" ? [tool.plan] : []),
            tool.session_query,
            tool.session_message_read,
            tool.spawn,
            tool.relay_message,
            tool.send_channel_message,
            tool.list_channels,
            tool.screenshot,
          ],
          task: tool.task,
          read: tool.read,
        }
      })
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom, ...dynamicToolDefs.values()] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "此子代理只能由用户手动调用。"}`,
        )
        .join("\n")
      return ["可用的代理类型及其拥有的工具：", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID, { exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        // 非进化模式下隐藏 evolve 工具
        if (tool.id === "evolve") return isEvolveMode()

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          return {
            id: tool.id,
            description: [
              output.description,
              tool.sourcePath ? `Source: ${tool.sourcePath}` : undefined,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
    })
  )

export const defaultLayer = Layer.suspend(() =>
  layer
    .pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(BackgroundJob.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
      Layer.provide(BunSecurity.defaultLayer),
    )
    .pipe(Layer.provide(Database.defaultLayer), Layer.provide(RuntimeFlags.defaultLayer)),
)

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

export * as ToolRegistry from "./registry"
