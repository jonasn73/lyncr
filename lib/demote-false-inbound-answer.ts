// Clear a false cell-VM / machine "answer" stamp when the dial falls through to Lyncr VM or AI.

import { broadcastCallCompletedBySid } from "@/lib/call-telemetry-realtime"
import { updateCallLog } from "@/lib/db"
import { VOICEMAIL_ROUTED_TO_NAME } from "@/lib/missed-call-telemetry"
import type { CallType } from "@/lib/types"

export type DemoteFalseInboundAnswerReason = "voicemail" | "missed" | "ai"

/** Prefer Next.js `after()` when available; otherwise fire-and-forget (tests / non-request). */
function scheduleBackground(work: () => Promise<void>): void {
  try {
    // Dynamic require keeps unit tests from needing a Next request context.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as { after?: (fn: () => Promise<void>) => void }
    if (typeof after === "function") {
      try {
        after(work)
        return
      } catch {
        // outside a request scope — fall through to void
      }
    }
  } catch {
    /* fall through */
  }
  void work().catch((e) => {
    console.warn("[demote-false-inbound-answer] background work failed:", e)
  })
}

/**
 * Owner Number URL stamps answered_at the moment the cell "answers" — including carrier
 * voicemail. When Dial `action` falls through to Lyncr Record / AI, clear that stamp so
 * Activities + intake never keep green "Answered".
 */
export function demoteFalseInboundAnswer(params: {
  callSid: string
  reason: DemoteFalseInboundAnswerReason
  /** Optional talk seconds from the Dial callback. */
  durationSeconds?: number
  /** Override routed_to_name (defaults: Voicemail / AI Receptionist). */
  routedToName?: string | null
}): void {
  const sid = params.callSid.trim()
  if (!sid) return

  const callType: CallType =
    params.reason === "voicemail" ? "voicemail" : params.reason === "ai" ? "incoming" : "missed"
  const routed =
    params.routedToName?.trim() ||
    (params.reason === "voicemail"
      ? VOICEMAIL_ROUTED_TO_NAME
      : params.reason === "ai"
        ? "AI Receptionist"
        : null)

  scheduleBackground(async () => {
    try {
      await updateCallLog(sid, {
        call_type: callType,
        answered_at: null,
        ...(routed ? { routed_to_name: routed } : {}),
        ...(params.durationSeconds != null && params.durationSeconds > 0
          ? { duration_seconds: params.durationSeconds }
          : {}),
        // Keep the parent leg live while Lyncr Record / AI runs — status webhook closes it.
        status: params.reason === "missed" ? "no-answer" : "in-progress",
      })
    } catch (e) {
      console.warn("[demote-false-inbound-answer] updateCallLog failed:", e)
      return
    }
    try {
      // Push call-completed so open intake demotes CALL ANSWERED → Missed / Voicemail.
      await broadcastCallCompletedBySid(sid)
    } catch (e) {
      console.warn("[demote-false-inbound-answer] broadcast failed:", e)
    }
  })
}
