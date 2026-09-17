// Abandoned-hold rescue text — the engine the Missed Call Rescue toggle never had.
//
// Measured live (30 days): 251 of 262 hold-queue callers hung up mid-hold and 92%
// of them never received any text, while booking links converted ~45% of sends
// into leads. Hangup can fire immediately; the every-5-min cron
// (app/api/cron/hold-no-response) also sweeps leftovers — with captured intake
// riding along as /book pre-fill.
//
// Timing (owner rule):
// - Early hangup / incomplete intake → text right away (hangup path + delay 0)
// - After hours AND complete intake → wait 15 minutes (give the shop a chance
//   to call back before the auto booking link)
// - Urgent intent (locked out, stranded, active leak — see
//   hold-queue-intake-prompts.ts `urgent`) → always immediate, even after hours
//   with complete intake. The 15-minute wait only helps if the owner is both
//   notified AND free to call back; someone standing at a locked car cannot
//   wait out a "give the shop a chance" window meant for routine requests.
//
// Guards, in order:
// - users.missed_call_textback_enabled (the long-orphaned toggle) gates per owner
// - quick hangups (< MIN_HOLD_SECS with no intake answered) are skipped — those
//   are overwhelmingly robocalls, not customers (72/251 abandons were < 30s)
// - toll-free callers never get texted (guaranteed carrier failure)
// - any prior outbound shop text in the last 24h cancels — no spam on redial
// - any sign the conversation moved on (owner texted/answered, customer booked)
//   cancels the send; the sender's own 24h outbound cooldown backstops that
// - one decision per caller, marked on call_queue.no_response_followup_at (the
//   shared "follow-up decision made" marker; 'left' rows are disjoint from the
//   closed-hours follow-up's timed_out/sms_left rows, so the column serves both)

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { sendInboundBookingSmsAndTag } from "@/lib/inbound-booking-sms"
import { conversationMovedOn, resolveShopLabel } from "@/lib/hold-no-response-followup"
import { getMissedCallTextbackEnabled } from "@/lib/missed-call-textback"
import { bookingIntakePrefillFromCollected } from "@/lib/book-customer-request"
import { isUrgentHoldQueueIntentSlug } from "@/lib/hold-queue-intake-prompts"
import { CAPTURE_STATUS_HOLD_ABANDON_RESCUE } from "@/lib/inbound-time-capture"
import { isTollFreeE164 } from "@/lib/phone-e164"
import { getAccountPresence } from "@/lib/account-presence"
import { hasOutboundSmsToCustomerRecently } from "@/lib/booking-sms-guards"
import { lyncrLog } from "@/lib/lyncr-env"

/** Early / incomplete hangups are eligible immediately (hangup path + cron). */
const RESCUE_DELAY_IMMEDIATE_MINUTES = 0
/**
 * After hours + complete intake: wait this long so the shop can call back first.
 * Same window as the closed-hours no-response follow-up.
 */
const RESCUE_DELAY_AFTER_HOURS_COMPLETE_MINUTES = 15
/** Never rescue holds older than this (cron backlog / downtime safety). */
const RESCUE_MAX_AGE_MINUTES = 60
/** Below this hold time with no intake answered, treat as robocall noise. */
const MIN_HOLD_SECS = 30
/** Do not auto-text again if the shop already texted this caller recently. */
const PRIOR_SMS_LOOKBACK_HOURS = 24
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

/**
 * True when hold intake captured everything that path asked for (Phase 1 + Phase 2
 * when a vehicle follow-up applied). Exported for tests.
 */
export function hasCompleteHoldIntake(
  collected: Record<string, unknown> | null | undefined
): boolean {
  if (!collected || typeof collected !== "object") return false
  const intent =
    typeof collected.intent_slug === "string" ? collected.intent_slug.trim() : ""
  if (!intent) return false

  const yearRaw =
    typeof collected.vehicle_year === "string" ? collected.vehicle_year.trim() : ""
  const yearOk = /^\d{4}$/.test(yearRaw)
  const make =
    typeof collected.vehicle_make === "string" ? collected.vehicle_make.trim() : ""
  const makeModel =
    typeof collected.vehicle_make_model_label === "string"
      ? collected.vehicle_make_model_label.trim()
      : ""
  const hasVehicleDetail = yearOk || Boolean(make) || Boolean(makeModel)

  // Still waiting on the spoken vehicle clip — not complete yet.
  if (collected.vehicle_voice_pending === true) return false

  // Key-generation (and similar) asked for year / make-model on hold.
  if (/key_generation/i.test(intent)) return hasVehicleDetail

  // Any other intent that started a vehicle answer must finish it.
  if (
    collected.vehicle_year != null ||
    collected.vehicle_make != null ||
    collected.vehicle_make_model_label != null
  ) {
    return hasVehicleDetail
  }

  return true
}

/**
 * Minutes to wait after hangup before the rescue text.
 * Only after-hours + complete intake waits 15 minutes; everyone else is immediate.
 * A "right now" urgent intent always skips the wait, even after hours.
 */
export function abandonedHoldRescueDelayMinutes(params: {
  presenceClosed: boolean
  completeIntake: boolean
  urgentIntent?: boolean
}): number {
  if (params.urgentIntent) return RESCUE_DELAY_IMMEDIATE_MINUTES
  if (params.presenceClosed && params.completeIntake) {
    return RESCUE_DELAY_AFTER_HOURS_COMPLETE_MINUTES
  }
  return RESCUE_DELAY_IMMEDIATE_MINUTES
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
  skippedTooSoon: number
  failed: number
}

type ProcessOutcome =
  | "sent"
  | "skipped_noise"
  | "skipped_disabled"
  | "skipped_moved_on"
  | "skipped_too_soon"
  | "failed"
  | "not_found"

async function isShopClosed(userId: string): Promise<boolean> {
  try {
    const presence = await getAccountPresence(userId)
    return String(presence.presenceStatus || "").trim().toUpperCase() === "CLOSED"
  } catch {
    // Fail open for delay (treat as open → immediate) so a presence blip never
    // parks a rescue for 15 minutes by mistake.
    return false
  }
}

async function alreadyGotShopText(params: {
  userId: string
  callerE164: string
}): Promise<boolean> {
  return hasOutboundSmsToCustomerRecently({
    ownerUserId: params.userId,
    customerPhone: params.callerE164,
    withinHours: PRIOR_SMS_LOOKBACK_HOURS,
  }).catch(() => false)
}

/**
 * Process one abandon candidate. Shared by the hangup path and the cron sweep.
 * `forceImmediate` skips the after-hours wait (hangup only uses it when delay is 0).
 */
async function processAbandonedHoldCandidate(
  candidate: RescueCandidate,
  opts: { now?: Date; requireDelayElapsed?: boolean } = {}
): Promise<ProcessOutcome> {
  const sql = sqlClient()
  const now = opts.now ?? new Date()
  const callerDigits = last10Digits(candidate.caller_e164)
  if (callerDigits.length < 10 || !candidate.user_id) return "not_found"

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

  const releaseClaim = async () => {
    await sql`
      UPDATE call_queue
      SET no_response_followup_at = NULL
      WHERE user_id = ${candidate.user_id}::uuid
        AND status = 'left'
        AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
    `.catch((e) => console.warn(lyncrLog("abandon-rescue-release-failed", { error: String(e) })))
  }

  let didClaim = false
  try {
    const enabled = await getMissedCallTextbackEnabled(candidate.user_id).catch(() => false)
    if (!enabled) {
      await markDecided()
      return "skipped_disabled"
    }

    const heldSecs = Math.max(
      0,
      (Date.parse(candidate.left_at) - Date.parse(candidate.enqueued_at)) / 1000
    )
    const collected =
      candidate.collected && typeof candidate.collected === "object" ? candidate.collected : {}
    const answeredIntake =
      typeof collected.intent_slug === "string" && collected.intent_slug !== ""
    if (
      !shouldRescueAbandonedHold({
        heldSecs,
        answeredIntake,
        callerE164: candidate.caller_e164,
      })
    ) {
      await markDecided()
      return "skipped_noise"
    }

    const completeIntake = hasCompleteHoldIntake(collected)
    const presenceClosed = await isShopClosed(candidate.user_id)
    const urgentIntent = isUrgentHoldQueueIntentSlug(
      typeof collected.intent_slug === "string" ? collected.intent_slug : null
    )
    const delayMinutes = abandonedHoldRescueDelayMinutes({
      presenceClosed,
      completeIntake,
      urgentIntent,
    })

    if (opts.requireDelayElapsed !== false && delayMinutes > 0) {
      const leftMs = Date.parse(candidate.left_at)
      const readyAt = leftMs + delayMinutes * 60_000
      if (!Number.isFinite(leftMs) || now.getTime() < readyAt) {
        // Leave unmarked — cron retries until the wait elapses or the row ages out.
        return "skipped_too_soon"
      }
    }

    // Already texted this caller recently (any shop outbound) — do not spam on redial.
    if (
      await alreadyGotShopText({
        userId: candidate.user_id,
        callerE164: candidate.caller_e164,
      })
    ) {
      await markDecided()
      return "skipped_moved_on"
    }

    if (
      await conversationMovedOn({
        userId: candidate.user_id,
        callerDigits,
        leftAtIso: candidate.left_at,
      })
    ) {
      await markDecided()
      return "skipped_moved_on"
    }

    if (!(await claimForSend())) {
      return "skipped_moved_on"
    }
    didClaim = true

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
      // Hangup already set ivr_action_completed — call_queue claim is the guard.
      bypassIvrClaim: true,
      intake: {
        summary,
        prefill: bookingIntakePrefillFromCollected(collected),
      },
    })

    if (outcome === "failed") {
      await releaseClaim()
      console.warn(
        lyncrLog("abandon-rescue-send-failed", {
          userId: candidate.user_id,
          error: error || null,
        })
      )
      return "failed"
    }

    if (outcome === "sent") {
      console.log(
        lyncrLog("abandon-rescue-sent", {
          userId: candidate.user_id,
          heldSecs: Math.round(heldSecs),
          hadIntake: answeredIntake,
          completeIntake,
          presenceClosed,
          delayMinutes,
        })
      )
      return "sent"
    }

    // skipped (recent text) or not_attempted — claim already marks decided.
    return "skipped_moved_on"
  } catch (e) {
    if (didClaim) await releaseClaim()
    console.warn(
      lyncrLog("abandon-rescue-candidate-failed", {
        userId: candidate.user_id,
        error: String(e),
      })
    )
    return "failed"
  }
}

/**
 * Hangup path — text right away when the delay rule says immediate.
 * After-hours + complete intake is left for the cron (15-minute wait).
 */
export async function tryImmediateAbandonedHoldRescue(
  callControlId: string
): Promise<{ outcome: ProcessOutcome }> {
  const id = String(callControlId || "").trim()
  if (!id) return { outcome: "not_found" }

  const sql = sqlClient()
  let rows: RescueCandidate[] = []
  try {
    rows = (await sql`
      SELECT user_id, caller_e164, business_line_e164, call_control_id, enqueued_at, left_at, collected
      FROM call_queue
      WHERE call_control_id = ${id}
        AND status = 'left'
        AND no_response_followup_at IS NULL
      LIMIT 1
    `) as RescueCandidate[]
  } catch (e) {
    console.warn(lyncrLog("abandon-rescue-immediate-lookup-failed", { error: String(e) }))
    return { outcome: "failed" }
  }

  const candidate = rows[0]
  if (!candidate) return { outcome: "not_found" }

  const collected =
    candidate.collected && typeof candidate.collected === "object" ? candidate.collected : {}
  const completeIntake = hasCompleteHoldIntake(collected)
  const presenceClosed = await isShopClosed(candidate.user_id)
  const urgentIntent = isUrgentHoldQueueIntentSlug(
    typeof collected.intent_slug === "string" ? collected.intent_slug : null
  )
  const delayMinutes = abandonedHoldRescueDelayMinutes({
    presenceClosed,
    completeIntake,
    urgentIntent,
  })

  // After-hours complete intake waits — cron sends after 15 minutes. Urgent intents
  // (see isUrgentHoldQueueIntentSlug) always come back immediate above.
  if (delayMinutes > 0) {
    console.log(
      lyncrLog("abandon-rescue-deferred-after-hours", {
        callControlId: id,
        delayMinutes,
      })
    )
    return { outcome: "skipped_too_soon" }
  }

  const outcome = await processAbandonedHoldCandidate(candidate, {
    requireDelayElapsed: false,
  })
  return { outcome }
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
    skippedTooSoon: 0,
    failed: 0,
  }

  let rows: RescueCandidate[] = []
  try {
    // Floor at delay 0 so early hangups are eligible as soon as the cron runs;
    // per-candidate logic still enforces the 15-minute after-hours+complete wait.
    rows = (await sql`
      SELECT user_id, caller_e164, business_line_e164, call_control_id, enqueued_at, left_at, collected
      FROM call_queue
      WHERE status = 'left'
        AND no_response_followup_at IS NULL
        AND left_at IS NOT NULL
        AND left_at <= ${now.toISOString()}::timestamptz
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

  for (const candidate of byOwnerCaller.values()) {
    result.checked += 1
    const outcome = await processAbandonedHoldCandidate(candidate, {
      now,
      requireDelayElapsed: true,
    })
    if (outcome === "sent") result.sent += 1
    else if (outcome === "skipped_noise") result.skippedNoise += 1
    else if (outcome === "skipped_disabled") result.skippedDisabled += 1
    else if (outcome === "skipped_too_soon") result.skippedTooSoon += 1
    else if (outcome === "failed") result.failed += 1
    else result.skippedMovedOn += 1
  }

  return result
}
