// Abandoned-hold rescue text — the engine the Missed Call Rescue toggle never had.
//
// Measured live (30 days): 251 of 262 hold-queue callers hung up mid-hold and 92%
// of them never received any text, while booking links converted ~45% of sends
// into leads. This sweep (same every-5-min cron as the closed-hours follow-up)
// finds holds that ended in a hangup and texts the caller the booking link a few
// minutes later — with their captured intake riding along as /book pre-fill.
//
// Guards, in order:
// - users.missed_call_textback_enabled (the long-orphaned toggle) gates per owner
// - quick hangups (< MIN_HOLD_SECS with no intake answered) are skipped — those
//   are overwhelmingly robocalls, not customers (72/251 abandons were < 30s)
// - toll-free callers never get texted (guaranteed carrier failure)
// - any sign the conversation moved on (owner texted/answered, customer booked)
//   cancels the send; the sender's own 45-min outbound cooldown backstops that
// - one decision per caller, marked on call_queue.no_response_followup_at (the
//   shared "follow-up decision made" marker; 'left' rows are disjoint from the
//   closed-hours follow-up's timed_out/sms_left rows, so the column serves both)

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import { conversationMovedOn, resolveShopLabel } from "@/lib/hold-no-response-followup"
import { getMissedCallTextbackEnabled } from "@/lib/missed-call-textback"
import { bookingIntakePrefillFromCollected } from "@/lib/book-customer-request"
import { CAPTURE_STATUS_HOLD_ABANDON_RESCUE } from "@/lib/inbound-time-capture"
import { isTollFreeE164 } from "@/lib/phone-e164"
import { lyncrLog } from "@/lib/lyncr-env"

/** Give the caller a beat to redial (and the owner to catch the retry) first. */
const RESCUE_DELAY_MINUTES = 3
/** Never rescue holds older than this (cron backlog / downtime safety). */
const RESCUE_MAX_AGE_MINUTES = 60
/** Below this hold time with no intake answered, treat as robocall noise. */
const MIN_HOLD_SECS = 30
const SWEEP_LIMIT = 200

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function last10Digits(phone: string | null | undefined): string {
  return String(phone || "")
    .replace(/\D/g, "")
    .slice(-10)
}

/**
 * Pure eligibility check — a real customer either waited a meaningful amount of
 * time or engaged with the intake questions before giving up. Exported for tests.
 */
export function shouldRescueAbandonedHold(params: {
  heldSecs: number
  answeredIntake: boolean
  callerE164: string
}): boolean {
  if (isTollFreeE164(params.callerE164)) return false
  return params.answeredIntake || params.heldSecs >= MIN_HOLD_SECS
}

type RescueCandidate = {
  user_id: string
  caller_e164: string
  business_line_e164: string | null
  call_control_id: string
  enqueued_at: string
  left_at: string
  collected: Record<string, unknown> | null
}

export type AbandonedHoldRescueResult = {
  checked: number
  sent: number
  skippedNoise: number
  skippedDisabled: number
  skippedMovedOn: number
  failed: number
}

/** One cron pass — see file header for the guard chain. */
export async function runAbandonedHoldRescueSweep(
  now: Date = new Date()
): Promise<AbandonedHoldRescueResult> {
  const sql = sqlClient()
  const result: AbandonedHoldRescueResult = {
    checked: 0,
    sent: 0,
    skippedNoise: 0,
    skippedDisabled: 0,
    skippedMovedOn: 0,
    failed: 0,
  }

  let rows: RescueCandidate[] = []
  try {
    rows = (await sql`
      SELECT user_id, caller_e164, business_line_e164, call_control_id, enqueued_at, left_at, collected
      FROM call_queue
      WHERE status = 'left'
        AND no_response_followup_at IS NULL
        AND left_at IS NOT NULL
        AND left_at <= ${now.toISOString()}::timestamptz - (${RESCUE_DELAY_MINUTES}::text || ' minutes')::interval
        AND left_at > ${now.toISOString()}::timestamptz - (${RESCUE_MAX_AGE_MINUTES}::text || ' minutes')::interval
      ORDER BY left_at DESC
      LIMIT ${SWEEP_LIMIT}
    `) as RescueCandidate[]
  } catch (e) {
    console.warn(lyncrLog("abandon-rescue-sweep-query-failed", { error: String(e) }))
    return result
  }

  // Latest abandon per (owner, caller) wins; older duplicates are marked with it.
  const byOwnerCaller = new Map<string, RescueCandidate>()
  for (const row of rows) {
    const digits = last10Digits(row.caller_e164)
    if (digits.length < 10 || !row.user_id) continue
    const key = `${row.user_id}:${digits}`
    if (!byOwnerCaller.has(key)) byOwnerCaller.set(key, row)
  }

  const textbackEnabled = new Map<string, boolean>()

  for (const [key, candidate] of byOwnerCaller) {
    result.checked += 1
    const callerDigits = key.slice(key.indexOf(":") + 1)

    const markDecided = async () => {
      await sql`
        UPDATE call_queue
        SET no_response_followup_at = now()
        WHERE user_id = ${candidate.user_id}::uuid
          AND status = 'left'
          AND no_response_followup_at IS NULL
          AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      `.catch((e) => console.warn(lyncrLog("abandon-rescue-mark-failed", { error: String(e) })))
    }

    // Atomically claim the follow-up before sending. This is now the sole cross-instance
    // idempotency guard for the abandoned-hold text: the shared claimIvrAction key is
    // pre-set by the mid-hold hangup handler, so the sender bypasses it (see
    // sendInboundBookingSmsAndTag.bypassIvrClaim). Winning this UPDATE (RETURNING a row)
    // means this pass owns the send; a concurrent pass gets 0 rows and stands down.
    const claimForSend = async (): Promise<boolean> => {
      try {
        const rows = (await sql`
          UPDATE call_queue
          SET no_response_followup_at = now()
          WHERE user_id = ${candidate.user_id}::uuid
            AND status = 'left'
            AND no_response_followup_at IS NULL
            AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
          RETURNING id
        `) as { id: string }[]
        return rows.length > 0
      } catch (e) {
        console.warn(lyncrLog("abandon-rescue-claim-failed", { error: String(e) }))
        return false
      }
    }

    // Undo the claim so a transient send failure retries on a later pass (mirrors the
    // pre-claim behavior where a failed send left no_response_followup_at NULL).
    const releaseClaim = async () => {
      await sql`
        UPDATE call_queue
        SET no_response_followup_at = NULL
        WHERE user_id = ${candidate.user_id}::uuid
          AND status = 'left'
          AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      `.catch((e) => console.warn(lyncrLog("abandon-rescue-release-failed", { error: String(e) })))
    }

    try {
      let enabled = textbackEnabled.get(candidate.user_id)
      if (enabled === undefined) {
        enabled = await getMissedCallTextbackEnabled(candidate.user_id).catch(() => false)
        textbackEnabled.set(candidate.user_id, enabled)
      }
      if (!enabled) {
        result.skippedDisabled += 1
        await markDecided()
        continue
      }

      const heldSecs = Math.max(
        0,
        (Date.parse(candidate.left_at) - Date.parse(candidate.enqueued_at)) / 1000
      )
      const collected =
        candidate.collected && typeof candidate.collected === "object" ? candidate.collected : {}
      const answeredIntake = typeof collected.intent_slug === "string" && collected.intent_slug !== ""
      if (
        !shouldRescueAbandonedHold({
          heldSecs,
          answeredIntake,
          callerE164: candidate.caller_e164,
        })
      ) {
        result.skippedNoise += 1
        await markDecided()
        continue
      }

      if (
        await conversationMovedOn({
          userId: candidate.user_id,
          callerDigits,
          leftAtIso: candidate.left_at,
        })
      ) {
        result.skippedMovedOn += 1
        await markDecided()
        continue
      }

      // Claim before sending — the sender no longer self-guards via claimIvrAction
      // for this path, so this is what prevents an overlapping pass double-texting.
      if (!(await claimForSend())) {
        result.skippedMovedOn += 1
        continue
      }

      const { shopLabel } = await resolveShopLabel({
        userId: candidate.user_id,
        businessLineE164: candidate.business_line_e164,
      })
      const summary =
        [collected.intent_label, collected.vehicle_year_label, collected.vehicle_make_model_label]
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
          .join(" — ") || null

      const { outcome, error } = await sendInboundBookingSmsAndTag({
        fromE164: candidate.caller_e164,
        ownerUserId: candidate.user_id,
        businessLineE164: candidate.business_line_e164 || "",
        callSid: candidate.call_control_id,
        routedToName: CAPTURE_STATUS_HOLD_ABANDON_RESCUE,
        source: "cc_hold_abandon_rescue",
        callType: "missed",
        businessLabel: shopLabel,
        tone: "missed_call",
        // The hangup handler already set ivr_action_completed for this call, so the
        // shared claim would always lose here — our call_queue claim above is the guard.
        bypassIvrClaim: true,
        intake: {
          summary,
          prefill: bookingIntakePrefillFromCollected(collected),
        },
      })

      if (outcome === "failed") {
        // Transient failures retry on the next pass until the window ages out;
        // permanent ones (e.g. undeliverable destination) just stop mattering then.
        await releaseClaim()
        result.failed += 1
        console.warn(
          lyncrLog("abandon-rescue-send-failed", { userId: candidate.user_id, error: error || null })
        )
        continue
      }

      if (outcome === "sent") {
        result.sent += 1
        console.log(
          lyncrLog("abandon-rescue-sent", {
            userId: candidate.user_id,
            heldSecs: Math.round(heldSecs),
            hadIntake: answeredIntake,
          })
        )
      } else {
        // skipped (recent text) or not_attempted (another webhook claimed it).
        result.skippedMovedOn += 1
      }
    } catch (e) {
      result.failed += 1
      console.warn(
        lyncrLog("abandon-rescue-candidate-failed", { userId: candidate.user_id, error: String(e) })
      )
    }
  }

  return result
}
