// s-code: src/channel/registry.ts
//
// 通道适配器注册表。参考 s-forge kernel/nerv/magi/channel/registry.go。
// 全局单例，管理所有已注册的 ChannelAdapter。

import { Context, Effect } from "effect"
import type { ChannelAdapter } from "./adapter"
import type { ChannelStatus } from "./types"

/** 通道注册表接口 */
export interface RegistryInterface {
  /** 注册适配器（同名冲突会覆盖） */
  readonly register: (adapter: ChannelAdapter) => Effect.Effect<void>

  /** 注销适配器 */
  readonly unregister: (id: string) => Effect.Effect<void>

  /** 按 ID 查找适配器 */
  readonly get: (id: string) => Effect.Effect<ChannelAdapter | undefined>

  /** 列出所有已注册适配器 */
  readonly all: () => Effect.Effect<ChannelAdapter[]>

  /** 列出所有已注册适配器的状态 */
  readonly statuses: () => Effect.Effect<ChannelStatus[]>
}

// 全局状态（Effect 的 Context.Service 不会自动全局化，
// 用 module-level Map 模拟单例，与 s-forge globalRegistry 一致）
const adapters = new Map<string, ChannelAdapter>()

/** 注册表默认实现 */
export const makeRegistry = (): RegistryInterface => ({
  register: (adapter) =>
    Effect.sync(() => {
      adapters.set(adapter.id, adapter)
    }),

  unregister: (id) =>
    Effect.sync(() => {
      adapters.delete(id)
    }),

  get: (id) =>
    Effect.sync(() => adapters.get(id)),

  all: () =>
    Effect.sync(() => [...adapters.values()]),

  statuses: () =>
    Effect.forEach([...adapters.values()], (a) => a.status()),
})

/** 注册表 Context Service */
export class RegistryService extends Context.Service<
  RegistryService,
  RegistryInterface
>()("@opencode/ChannelRegistry") {}

export * as ChannelRegistry from "./registry"
