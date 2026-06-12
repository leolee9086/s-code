import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

/** 从父助理消息提取的模型信息。 */
export interface ParentMessageModel {
  readonly modelID: ModelV2.ID
  readonly providerID: ProviderV2.ID
  readonly variant?: string
}

/**
 * 从已加载的 WithParts 消息中提取模型信息。
 * 仅 Assistant 消息有顶层 modelID/providerID/variant。
 * 纯函数，不涉及任何 Effect。
 *
 * 使用方式（task.ts 风格）：
 *   const msg = yield* MessageV2.get({...})
 *   const parent = extractParentModel(msg)
 *   if (!parent) return yield* Effect.fail(...)
 *   const model = subagent.model ?? parent
 */
export function extractParentModel(msg: SessionV1.WithParts): ParentMessageModel | undefined {
  if (msg.info.role !== "assistant") return undefined
  return {
    modelID: msg.info.modelID,
    providerID: msg.info.providerID,
    variant: msg.info.variant,
  }
}

export * as InheritModel from "./inherit-model"
