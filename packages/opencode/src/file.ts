/**
 * 文件访问服务
 *
 * 提供带路径遍历保护的文件读取和目录列表功能。
 * HTTP API (GET /file/content, GET /file) 直接使用此服务。
 */
import { Context, Effect, Layer } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import fs from "fs/promises"
import type { InstanceContext } from "./project/instance-context"
import { containsPath } from "./project/instance-context"
import { InstanceState } from "./effect/instance-state"

export interface ReadResult {
  readonly content: string
}

export interface ListEntry {
  readonly name: string
  readonly path: string
}

export interface Interface {
  readonly read: (file: string) => Effect.Effect<ReadResult, AccessDeniedError>
  readonly list: (dir: string) => Effect.Effect<readonly ListEntry[], AccessDeniedError>
}

export class AccessDeniedError extends Error {
  readonly _tag = "AccessDeniedError"
  constructor(path: string) {
    super(`Access denied: path escapes project directory`)
    this.name = "AccessDeniedError"
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/File") {}

export const use = serviceUse(Service)

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context

    const read = Effect.fn("File.read")(function* (file: string) {
      const resolved = path.resolve(ctx.directory, file)
      if (!containsPath(resolved, ctx as InstanceContext)) {
        return yield* Effect.fail(new AccessDeniedError(file))
      }
      const content = yield* Effect.promise(() => Bun.file(resolved).text())
      return { content }
    })

    const list = Effect.fn("File.list")(function* (dir: string) {
      const resolved = path.resolve(ctx.directory, dir)
      if (!containsPath(resolved, ctx as InstanceContext)) {
        return yield* Effect.fail(new AccessDeniedError(dir))
      }
      const names: string[] = yield* Effect.promise(() =>
        fs.readdir(resolved).then(
          (files) => files,
          () => [] as string[],
        ),
      )
      const entries: ListEntry[] = names.map((name: string) => ({ name, path: path.join(dir, name) }))
      return entries as readonly ListEntry[]
    })

    return Service.of({ read, list })
  }),
)

export * as File from "./file"
