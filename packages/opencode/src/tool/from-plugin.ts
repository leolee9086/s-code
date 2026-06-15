// s-code: src/tool/from-plugin.ts
//
// Shared utilities for converting plugin-style ToolDefinition → internal Tool.Def.
// Extracted to its own file to avoid circular imports between registry.ts and dynamic.ts.

import { Effect, Schema } from "effect"
import z from "zod"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { EffectBridge } from "@/effect/bridge"
import { Agent } from "../agent/agent"
import * as Truncate from "./truncate"
import * as Tool from "./tool"

/**
 * Convert a plugin-style ToolDefinition into an internal Tool.Def,
 * with explicit directory / worktree instead of capturing from InstanceContext.
 */
export function fromPluginDef(
  id: string,
  def: ToolDefinition,
  sourcePath: string | undefined,
  directory: string,
  worktree: string,
  agentSvc: Agent.Interface,
  truncateSvc: Truncate.Interface,
): Tool.Def {
  const args = def.args ?? {}
  const entries = Object.entries(args)
  const allZod = entries.every((entry) => isZodType(entry[1]))
  const zodParams = allZod ? z.object(args) : undefined
  const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
  const parameters = zodParams
    ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
    : Schema.Unknown
  return {
    id,
    parameters,
    jsonSchema,
    sourcePath,
    description: def.description,
    execute: (args, toolCtx) =>
      Effect.gen(function* () {
        const bridge = yield* EffectBridge.make()
        const pluginCtx: PluginToolContext = {
          ...toolCtx,
          ask: (req) => bridge.promise(toolCtx.ask(req)),
          directory,
          worktree,
        }
        const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
        const output = typeof result === "string" ? result : result.output
        const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
        const attachments = typeof result === "string" ? undefined : result.attachments
        const info = yield* agentSvc.get(toolCtx.agent)
        const out = yield* truncateSvc.output(output, {}, info)
        return {
          title: typeof result === "string" ? "" : (result.title ?? ""),
          output: out.truncated ? out.content : output,
          attachments,
          metadata: {
            ...metadata,
            truncated: out.truncated,
            ...(out.truncated && { outputPath: out.outputPath }),
          },
        }
      }).pipe(
        Effect.withSpan("Tool.execute", {
          attributes: {
            "tool.name": id,
            "session.id": toolCtx.sessionID,
            "message.id": toolCtx.messageID,
            ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
          },
        }),
      ),
  }
}

// ─── Helper functions (moved from registry.ts) ─────────────────

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as FromPlugin from "./from-plugin"
