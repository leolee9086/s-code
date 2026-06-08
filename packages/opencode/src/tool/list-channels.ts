// s-code: src/tool/list-channels.ts
//
// list_channels 工具 — LLM 通过此工具查询已注册的外部消息通道及其状态。
//
// 从 ChannelRegistry 获取已注册的适配器列表，返回通道 ID、状态和能力信息。

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { RegistryService } from "@/channel/registry"
import { Capability } from "@/channel/types"

export const Parameters = Schema.Struct({})

export const ListChannelsTool = Tool.define<typeof Parameters, never, never>(
  "list_channels",
  Effect.gen(function* () {
    return {
      description:
        "列出所有已注册的外部消息通道及其状态。调用 send_channel_message 前可先用此工具查找可用的 channelId。参考 s-forge list_magi_channels。",
      parameters: Parameters,
      execute: () =>
        Effect.gen(function* () {
          const registryOpt = yield* Effect.serviceOption(RegistryService)
          if (registryOpt._tag === "None") {
            return {
              title: "list_channels",
              output: "通道注册表不可用。当前没有已注册的外部消息通道。",
              metadata: {} as never,
            } satisfies Tool.ExecuteResult<never>
          }

          const registry = registryOpt.value
          const adapters = yield* registry.all()
          const statuses = yield* registry.statuses()

          if (adapters.length === 0) {
            return {
              title: "list_channels",
              output: "当前没有已注册的外部消息通道。",
              metadata: {} as never,
            } satisfies Tool.ExecuteResult<never>
          }

          const capLabel = (cap: Capability): string => {
            const labels: string[] = []
            if (cap & Capability.Receive) labels.push("receive")
            if (cap & Capability.ProactiveSend) labels.push("proactive_send")
            if (cap & Capability.Attachments) labels.push("attachments")
            return labels.length > 0 ? labels.join(", ") : "none"
          }

          const lines: string[] = [`已注册的通道（${adapters.length} 个）：`, ""]
          for (let i = 0; i < adapters.length; i++) {
            const a = adapters[i]
            const s = statuses[i]
            const connectedLabel = s.connected ? "connected" : "disconnected"
            lines.push(`  ${i + 1}. ${a.id}`)
            lines.push(`     - status: ${connectedLabel}${s.error ? ` (error: ${s.error})` : ""}`)
            lines.push(`     - capabilities: [${capLabel(a.capabilities())}]`)
            if (s.accountID) lines.push(`     - accountId: ${s.accountID}`)
            if (s.userCount > 0) lines.push(`     - userCount: ${s.userCount}`)
            if (s.lastMessageAt) {
              lines.push(`     - lastMessageAt: ${new Date(s.lastMessageAt).toISOString()}`)
            }
          }

          return {
            title: "list_channels",
            output: lines.join("\n"),
            metadata: {} as never,
          } satisfies Tool.ExecuteResult<never>
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, never>
  }),
)
