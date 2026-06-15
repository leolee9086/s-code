// s-code: src/tool/dynamic.ts
//
// dynamic_tool — 创建一个自定义工具并立即使用。
// 工具保存到 .opencode/tool/<name>.ts，转换为 Tool.Def 后存入 module-level map，
// registry.ts 的 all() 方法会合并这些动态工具，后续可直接按名称调用。

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { fromPluginDef } from "./from-plugin"
import path from "path"
import { pathToFileURL } from "url"
import { InstanceState } from "@/effect/instance-state"
import { Agent } from "../agent/agent"
import * as Truncate from "./truncate"

// ─── Module-level 动态工具存储 ──────────────────────────────
// registry.ts 的 ToolRegistry.all() 读取此 map 合并到返回的工具列表。
export const dynamicToolDefs = new Map<string, Tool.Def>()

const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "snake_case 工具名称，用作 tool ID 和文件名。仅允许小写字母、数字、下划线。",
  }),
  description: Schema.String.annotate({ description: "工具用途描述，LLM 通过此描述了解何时调用" }),
  args: Schema.Unknown.annotate({
    description:
      "工具的 JSON Schema 参数定义。格式：{ param1: { type: 'string', description: '...' }, param2: { type: 'number', description: '...', default: 0 } }",
  }),
  execute: Schema.String.annotate({
    description:
      "工具的 TypeScript 执行代码（函数体）。函数签名：async (args, ctx) => { ... }\n" +
      "args 包含用户传入的参数（根据 args schema 定义），ctx 包含 { sessionID, directory, worktree, agent, channel, abort, metadata, ask }。\n" +
      "返回字符串或 { output, title?, metadata?, attachments? }。\n" +
      "可用 import：可以使用 esm import 语法导入依赖包。",
  }),
  inputs: Schema.optional(Schema.Unknown).annotate({
    description: "创建后立即调用的输入参数。传此参数时工具会立即执行并返回结果。不传则仅创建注册。",
  }),
})

export const DynamicTool = Tool.define(
  "dynamic_tool",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const truncate = yield* Truncate.Service

    return {
      description: [
        "创建一个自定义工具并立即使用。工具保存到 .opencode/tool/ 后永久可用。",
        "",
        "用法：",
        "1. 提供 name（snake_case，也作文件名）、description、args（JSON Schema）、execute（TypeScript 代码）",
        "2. 可选：提供 inputs 立即执行工具",
        "3. 创建后工具自动注册，可通过名称直接调用，无需再次提供代码",
        "",
        "args 格式示例：{ filePath: { type: 'string', description: '文件路径' }, depth: { type: 'number', default: 3 } }",
        "execute 函数体示例：const { filePath, depth } = args; const content = await Bun.file(filePath).text(); return `文件 ${filePath} 共 ${content.split('\\n').length} 行`",
      ].join("\n"),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const { name, description, args, execute, inputs } = params

          // 校验 name 格式
          if (!/^[a-z0-9_]+$/.test(name)) {
            return {
              output: `❌ name 必须为 snake_case（仅小写字母、数字、下划线），收到: "${name}"`,
              title: "dynamic_tool (error)",
              metadata: {},
            }
          }
          if (typeof args !== "object" || args === null || Array.isArray(args)) {
            return {
              output: `❌ args 必须是对象格式 { key: { type: 'string', ... } }`,
              title: "dynamic_tool (error)",
              metadata: {},
            }
          }

          // 1. 生成工具文件内容
          const toolFileContent = generateToolFile(name, description, args, execute)

          // 2. 写入 .opencode/tool/<name>.ts
          const instance = yield* InstanceState.context
          const toolDir = path.join(instance.worktree, ".opencode", "tool")
          const filePath = path.join(toolDir, `${name}.ts`)

          yield* Effect.promise(() => Bun.$`mkdir -p ${toolDir}`.catch(() => {})).pipe(Effect.ignore)
          yield* Effect.promise(() => Bun.write(filePath, toolFileContent))

          // 3. 安全审核：对 execute 代码进行基本模式检查
          const blockedPatterns = [
            /process\.env\b.*(?:TOKEN|KEY|SECRET|PASSWORD|API_KEY)/i,
            /child_process\.exec(?:Sync)?\s*\(/,
            /require\(["']child_process["']\)/,
            /Bun\.spawn(?:Sync)?\s*\(/,
            /Bun\.\$`\s*(?:rm\s+-rf\s+\/|del\s+\/f|rd\s+\/s\s+\/)/i,
          ]
          for (const pattern of blockedPatterns) {
            if (pattern.test(execute)) {
              return {
                output: `❌ 安全审核未通过：execute 代码包含被禁止的模式 "${pattern.source}"`,
                title: "dynamic_tool (blocked)",
                metadata: {},
              }
            }
          }

          // 4. 动态引入，获取 ToolDefinition
          const mod = yield* Effect.promise(() => import(pathToFileURL(filePath).href))
          const def: ToolDefinition | undefined =
            mod.default ?? Object.values(mod).find(
              (v: unknown): v is ToolDefinition =>
                typeof v === "object" && v !== null && "execute" in v && "description" in v && "args" in v,
            )
          if (!def) {
            return {
              output: [
                `❌ 工具文件已创建但未检测到合法导出: ${filePath}`,
                `请确保文件 export default { description, args, execute }。`,
              ].join("\n"),
              title: "dynamic_tool (error)",
              metadata: { toolPath: filePath },
            }
          }

          // 4. 转换为 Tool.Def 并注册到 module-level map
          const toolDef = fromPluginDef(name, def, filePath, instance.directory, instance.worktree, agent, truncate)
          dynamicToolDefs.set(name, toolDef)

          // 5. 如果有 inputs，立即执行
          if (inputs !== undefined) {
            const result = yield* toolDef.execute(inputs, ctx)
            return {
              ...result,
              output: [
                `✅ 工具 "${name}" 已创建、注册并执行成功`,
                `📁 ${filePath}`,
                ``,
                result.output,
              ].join("\n"),
              metadata: { ...result.metadata, toolPath: filePath },
            }
          }

          return {
            output: [
              `✅ 工具 "${name}" 已创建并注册`,
              `📁 ${filePath}`,
              ``,
              `可通过该工具名称直接调用。`,
            ].join("\n"),
            title: `dynamic_tool: ${name}`,
            metadata: { toolPath: filePath },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ─── 文件生成 ────────────────────────────────────────────────

function generateToolFile(
  name: string,
  description: string,
  args: unknown,
  executeCode: string,
): string {
  const argsStr = JSON.stringify(args, null, 2)
  // 提取代码中的静态 import 语句，放到文件顶部（函数体内不允许 import）
  const importLines: string[] = []
  const bodyLines: string[] = []
  for (const line of executeCode.split("\n")) {
    if (/^(import|export)\s+(type\s+)?\{/.test(line.trim()) && line.trim().includes(" from ")) {
      importLines.push(line)
    } else if (/^import\s+(type\s+)?\S/.test(line.trim()) && line.trim().includes(" from ")) {
      importLines.push(line)
    } else if (/^import\s+["']/.test(line.trim())) {
      importLines.push(line)
    } else {
      bodyLines.push(`    ${line}`)
    }
  }
  return [
    `// Auto-generated by dynamic_tool. Editable.`,
    ...importLines,
    `export default {`,
    `  description: ${JSON.stringify(description)},`,
    `  args: ${argsStr},`,
    `  execute: async (args, ctx) => {`,
    ...bodyLines,
    `  },`,
    `}`,
    ``,
  ].join("\n")
}

export * as Dynamic from "./dynamic"
