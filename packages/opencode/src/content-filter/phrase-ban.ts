import { Effect, Ref } from "effect"
import type { SessionID } from "@/session/schema"
import { GlobalBus } from "@/bus/global"

export * as PhraseBan from "./phrase-ban"

export interface BannedPhrase {
  phrase: string
  grace: number
  maxGrace: number
}

type BannedMap = Map<string, Map<string, BannedPhrase>>

const stateRef = Effect.runSync(
  Ref.make<BannedMap>(new Map()),
)

const emitChange = (sessionID: SessionID) => {
  const state = Ref.get(stateRef).pipe(
    Effect.map((s) => {
      const session = s.get(sessionID)
      const phrases: BannedPhrase[] = session ? Array.from(session.values()) : []
      return phrases
    }),
  )
  Effect.runPromise(
    Effect.map(state, (phrases) => {
      GlobalBus.emit("event", {
        payload: {
          type: "session.banned_phrases",
          properties: { sessionID, phrases },
        },
      })
    }),
  ).catch(() => {})
}

export const ban = (sessionID: SessionID, phrase: string, grace = 1) =>
  Effect.gen(function* () {
    const key = phrase.toLowerCase()
    yield* Ref.update(stateRef, (state) => {
      const session = new Map(state.get(sessionID) ?? [])
      const existing = session.get(key)
      session.set(key, { phrase: key, grace, maxGrace: existing ? existing.maxGrace : grace })
      const next = new Map(state)
      next.set(sessionID, session)
      return next
    })
    emitChange(sessionID)
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
    emitChange(sessionID)
  })

export const list = (sessionID: SessionID) =>
  Effect.gen(function* () {
    return yield* Ref.get(stateRef).pipe(
      Effect.map((state) => {
        const session = state.get(sessionID)
        if (!session) return [] as BannedPhrase[]
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
        emitChange(sessionID)
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
    emitChange(sessionID)
  })
