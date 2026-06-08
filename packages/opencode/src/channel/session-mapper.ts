// s-code: src/channel/session-mapper.ts
//
// conversationToken → sessionID 映射。
// 外部消息通过 conversationToken 指向目标 session，dispatch handler 据此路由。

import { Context, Effect, Layer } from "effect"

export interface SessionMapperInterface {
  readonly resolve: (token: string) => string | undefined
  readonly bind: (token: string, sessionID: string) => void
  readonly unbind: (token: string) => void
}

export class SessionMapper extends Context.Service<SessionMapper, SessionMapperInterface>()("@opencode/SessionMapper") {}

const map = new Map<string, string>()

export const SessionMapperLive = Layer.succeed(
  SessionMapper,
  SessionMapper.of({
    resolve: (token) => map.get(token),
    bind: (token, sessionID) => { map.set(token, sessionID) },
    unbind: (token) => { map.delete(token) },
  }),
)
