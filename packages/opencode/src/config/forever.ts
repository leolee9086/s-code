// 永续模式（Forever Mode）配置定义
//
// 启用后，代理循环可在可配置条件下持续运行，无需用户手动输入。
// 使用方式：
//   1. 在 opencode.json 中配置 enabled: true
//   2. 在聊天中使用 `永续: <任务描述>` 前缀命令启动
//   3. 或通过 POST /api/session/:sessionID/forever HTTP API 触发
//
// 配置示例：
//   {
//     "forever": {
//       "enabled": true,
//       "prompt": { "default": "Continue the task. Focus on completing the remaining work." },
//       "budget": { "max_rounds": 100, "max_cost_usd": 5.0 },
//       "conditions": {
//         "timer": { "enabled": true, "interval_ms": 30000 },
//         "file_watch": { "enabled": true, "paths": ["."] }
//       }
//     }
//   }
import { Schema } from "effect"

export const ForeverConditionFileWatch = Schema.Struct({
  enabled: Schema.Boolean,
  paths: Schema.Array(Schema.String),
  debounce_ms: Schema.optional(Schema.Number),
  ignore: Schema.optional(Schema.Array(Schema.String)),
})

export const ForeverConditionTimer = Schema.Struct({
  enabled: Schema.Boolean,
  interval_ms: Schema.Number,
})

export const ForeverPromptSource = Schema.Struct({
  type: Schema.Literals(["script", "file", "http", "inline"]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
})

export const ForeverBudget = Schema.Struct({
  max_cost_usd: Schema.optional(Schema.Number),
  max_rounds: Schema.optional(Schema.Number),
  max_duration_minutes: Schema.optional(Schema.Number),
  max_sleep_minutes: Schema.optional(Schema.Number),
})

export const ForeverInfo = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  conditions: Schema.optional(
    Schema.Struct({
      file_watch: Schema.optional(ForeverConditionFileWatch),
      timer: Schema.optional(ForeverConditionTimer),
    }),
  ),
  prompt: Schema.optional(
    Schema.Struct({
      default: Schema.optional(Schema.String),
      source: Schema.optional(ForeverPromptSource),
    }),
  ),
  budget: Schema.optional(ForeverBudget),
})

export type ForeverInfo = Schema.Schema.Type<typeof ForeverInfo>

export * as ConfigForever from "./forever"
