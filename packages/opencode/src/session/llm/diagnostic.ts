import type { Prepared } from "./request"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "llm.diagnostic" })

/**
 * Per-session tracker that records the previous request's serialised payload
 * for the same session, so the next request can report where they diverge.
 */
const sessionCache = new Map<string, { payload: string; timestamp: number }>()

/**
 * Compare the just-built `prepared` payload against the previous one for the
 * same session and log the exact character offset at which they first differ.
 *
 * This is intentionally *not* a token-level comparison — the goal is to expose
 * whether early-queue mutations (prefix injection, suffix injection, synthetic
 * messages inserted before existing content) keep shifting the beginning of
 * the conversation and therefore defeat LLM-side prefix caching / context
 * caching.
 *
 * Call this right after `LLMRequestPrep.prepare` returns and before the
 * payload is handed to the provider SDK.
 */
export function diagnosePayloadDiff(
  sessionID: string,
  prepared: Pick<Prepared, "system" | "messages">,
): void {
  // Serialise the full conversation payload as it will be sent to the LLM.
  const serialised = JSON.stringify({ system: prepared.system, messages: prepared.messages })

  const prev = sessionCache.get(sessionID)
  if (!prev) {
    // First request for this session — nothing to compare against yet.
    sessionCache.set(sessionID, { payload: serialised, timestamp: Date.now() })
    return
  }

  const currentLen = serialised.length
  const prevLen = prev.payload.length
  const compareLen = Math.min(currentLen, prevLen)

  let diffOffset = -1
  for (let i = 0; i < compareLen; i++) {
    if (serialised[i] !== prev.payload[i]) {
      diffOffset = i
      break
    }
  }

  if (diffOffset === -1 && currentLen === prevLen) {
    // Payloads are identical — cache was a full hit.  Nothing to report.
    sessionCache.set(sessionID, { payload: serialised, timestamp: Date.now() })
    return
  }

  // If one payload is a prefix of the other, report the shorter length as the
  // divergence point.
  if (diffOffset === -1) {
    diffOffset = compareLen
  }

  const msSinceLast = Date.now() - prev.timestamp

  // Extract a small context window around the diff point.
  const ctxStart = Math.max(diffOffset - 40, 0)
  const ctxEnd = Math.min(diffOffset + 80, currentLen)
  const windowBefore = serialised.slice(ctxStart, diffOffset)
  const windowAfter = serialised.slice(diffOffset, ctxEnd)
  const markerLine = " ".repeat(Math.min(diffOffset - ctxStart, 40)) + "^"

  log.warn("payload diff detected", {
    sessionID,
    diffCharOffset: diffOffset,
    currentPayloadLength: currentLen,
    previousPayloadLength: prevLen,
    msSincePreviousRequest: msSinceLast,
    contextBefore: windowBefore,
    contextAfter: windowAfter,
    marker: markerLine,
  })
  log.warn(
    `[${sessionID}] payload differs at character ${diffOffset} ` +
    `(current=${currentLen}B, previous=${prevLen}B, ${msSinceLast}ms since last request). ` +
    `Preceding context: ${JSON.stringify(windowBefore)} | Differing at: ${JSON.stringify(windowAfter.slice(0, 60))}`,
  )

  // Update cache for next comparison.
  sessionCache.set(sessionID, { payload: serialised, timestamp: Date.now() })
}

/**
 * Clear the stored diagnostic state for a session (e.g. when we know the
 * session is fully done and won't produce more LLM requests).
 */
export function clearDiagnosticState(sessionID: string): void {
  sessionCache.delete(sessionID)
}

export * as LLMDiagnostic from "./diagnostic"
