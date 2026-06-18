import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { Installation } from "@/installation"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { EventV2 } from "@opencode-ai/core/event"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: EventV2.define({
    type: "command.executed",
    schema: {
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    },
  }),
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & {
  template: Promise<string> | string
  /** 直接执行工具（不经过模型），存在时优先于 template */
  execute?: (ctx: { worktree: string; directory: string }) => Effect.Effect<string>
}

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }
      commands["stop-evolve"] = {
        name: "stop-evolve",
        description: "stop evolution mode and return to normal interaction",
        source: "command",
        template: "/stop-evolve",
        hints: [],
      }

      // 源码模式（Installation.isLocal()）下暴露构建命令到 slash 菜单，直接执行工具
      if (Installation.isLocal()) {
        commands["build"] = {
          name: "build",
          description: "构建 opencode 自身（源码模式）",
          source: "command",
          template: "build",
          hints: [],
          execute: (toolCtx) =>
            Effect.gen(function* () {
              const { pathToFileURL } = yield* Effect.promise(() => import("url"))
              const mPath = yield* Effect.promise(() => import("path"))
              const toolPath = mPath.join(toolCtx.worktree, ".opencode", "tool", "build_opencode.ts")
              const mod = yield* Effect.promise(() => import(pathToFileURL(toolPath).href))
              const fn = mod.default?.execute
              if (!fn) return `错误：未找到 build_opencode 工具`
              const result = yield* Effect.promise(() =>
                fn({}, { worktree: toolCtx.worktree, directory: toolCtx.directory }),
              )
              return typeof result === "string" ? result : (result as any).output ?? String(result)
            }),
        }
        commands["build-and-deploy"] = {
          name: "build-and-deploy",
          description: "构建 opencode 并部署到全局安装位置（源码模式）",
          source: "command",
          template: "build-and-deploy",
          hints: [],
          execute: (toolCtx) =>
            Effect.gen(function* () {
              const { pathToFileURL } = yield* Effect.promise(() => import("url"))
              const mPath = yield* Effect.promise(() => import("path"))
              const toolPath = mPath.join(toolCtx.worktree, ".opencode", "tool", "build_and_deploy_opencode.ts")
              const mod = yield* Effect.promise(() => import(pathToFileURL(toolPath).href))
              const fn = mod.default?.execute
              if (!fn) return `错误：未找到 build_and_deploy_opencode 工具`
              const result = yield* Effect.promise(() =>
                fn({}, { worktree: toolCtx.worktree, directory: toolCtx.directory }),
              )
              return typeof result === "string" ? result : (result as any).output ?? String(result)
            }),
        }
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            return item.content
          },
          hints: [],
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    return Service.of({ get, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Command from "."
