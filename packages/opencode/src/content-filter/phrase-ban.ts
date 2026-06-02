import { Effect, Ref } from "effect"
import type { SessionID } from "@/session/schema"

export * as PhraseBan from "./phrase-ban"

interface BannedPhrase {
  phrase: string
  grace: number
}

type BannedMap = Map<string, Map<string, BannedPhrase>>

const stateRef = Effect.runSync(
  Ref.make<BannedMap>(new Map()),
)

export const ban = (sessionID: SessionID, phrase: string, grace = 1) =>
  Effect.gen(function* () {
    const key = phrase.toLowerCase()
    yield* Ref.update(stateRef, (state) => {
      const session = new Map(state.get(sessionID) ?? [])
      session.set(key, { phrase: key, grace })
      const next = new Map(state)
      next.set(sessionID, session)
      return next
    })
  })

export const unban = (sessionID: SessionID, phrase: string) =>
  Effect.gen(function* () {
    const key = phrase.toLowerCase()
    yield* Ref.update(stateRef, (state) => {
      const session = state.get(sessionID)
      if (!session) return state
      const next = new Map(state)
      const nextSession = new Map(session)
      nextSession.delete(key)
      if (nextSession.size === 0) {
        next.delete(sessionID)
      } else {
        next.set(sessionID, nextSession)
      }
      return next
    })
  })

export const list = (sessionID: SessionID) =>
  Effect.gen(function* () {
    return yield* Ref.get(stateRef).pipe(
      Effect.map((state) => {
        const session = state.get(sessionID)
        if (!session) return [] as Array<{ phrase: string; grace: number }>
        return Array.from(session.values()).map((b) => ({ phrase: b.phrase, grace: b.grace }))
      }),
    )
  })

export const check = (sessionID: SessionID, text: string) =>
  Ref.modify(stateRef, (state) => {
    const session = state.get(sessionID)
    if (!session || session.size === 0) return [undefined, state] as const

    const lower = text.toLowerCase()
    let matched: string | undefined

    for (const [key, bp] of session) {
      if (!lower.includes(key)) continue
      if (bp.grace > 0) {
        bp.grace--
        continue
      }
      matched = bp.phrase
      break
    }

    return [matched, new Map(state)] as const
  })

export const clear = (sessionID: SessionID) =>
  Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      const next = new Map(state)
      next.delete(sessionID)
      return next
    })
  })
