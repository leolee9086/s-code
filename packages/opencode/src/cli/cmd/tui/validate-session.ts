import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { SessionID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Schema } from "effect"

const decodeSessionID = Schema.decodeUnknownSync(SessionID)
const log = Log.create({ service: "validate-session" })

export async function validateSession(input: {
  url: string
  sessionID?: string
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
}) {
  if (!input.sessionID) return

  const requestID = crypto.randomUUID().slice(0, 8)

  log.info("validating session", {
    requestID,
    sessionID: input.sessionID,
    url: input.url,
    directory: input.directory,
  })

  let sessionID: SessionID
  try {
    sessionID = decodeSessionID(input.sessionID)
  } catch (error) {
    log.error("invalid session ID", {
      requestID,
      sessionID: input.sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(`Invalid session ID: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error })
  }

  try {
    await createOpencodeClient({
      baseUrl: input.url,
      directory: input.directory,
      fetch: input.fetch,
      headers: input.headers,
    }).session.get({ sessionID }, { throwOnError: true })
    log.info("session validated", { requestID, sessionID: input.sessionID })
  } catch (error) {
    log.error("session validation failed", {
      requestID,
      sessionID: input.sessionID,
      error: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
      httpStatus: (error as any)?.response?.status,
      httpBody: (error as any)?.response?.body,
    })
    throw error
  }
}
