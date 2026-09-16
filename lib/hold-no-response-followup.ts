// Closed-hours "no response" follow-up — requested directly by the owner.
//
// A closed-hours caller who out-waits the hold (or presses 1) gets a booking-link
// SMS, and the owner keeps the option of waking up and taking the job. But when
// the owner does NOT react within the wait window, the customer shouldn't sit up
// expecting a call: the every-5-min cron (app/api/cron/hold-no-response) finds
// those holds and texts an honest expectation-setter — team unavailable, next
// scheduled opening, door left open ("if anything frees up sooner, we'll call").
//
// Fires only while the account's presence is CLOSED at send time (owner's choice:
// closed hours only). Any sign the conversation moved on — an outbound text from
// the workspace, an answered call, a completed booking — cancels the send.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAccountPresence } from "@/lib/account-presence"
import {
  getAccountWeeklyHours,
  nextScheduledOpeningLabel,
  type AccountWeeklyHours,
} from "@/lib/account-weekly-hours"
import { buildBookQueryUrl, createBookingInvite } from "@/lib/booking-invite"
import { getActivePhoneNumberByE164 } from "@/lib/db"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { lyncrLog } from "@/lib/lyncr-env"

/** Owner gets this long to react before the customer is told the team is unavailable. */
const NO_RESPONSE_WAIT_MINUTES = 15
/** Never message about holds older than this (cron backlog / downtime safety). */
const NO_RESPONSE_MAX_AGE_MINUTES = 120
/** Outbound SMS this close to hold end is the automated booking link, not the owner. */
const AUTO_SMS_GRACE_SECONDS = 120
/** Max candidates per sweep — keeps one slow account from starving the rest. */
const SWEEP_LIMIT = 200

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

function last10Digits(phone: string | null | undefined): string {
  return String(phone || "")
    .replace(/\D/g, "")
    .slice(-10)
}

/** Evening/overnight in the shop's timezone — drives "tonight" vs "right now". */
export function isLocalNight(timezone: string, now: Date = new Date()): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(
        now
      )
    )
    return hour >= 18 || hour < 5
  } catch {
    return false
  }
}

/**
 * The "Honest + door open" copy the owner picked: states unavailability and the
 * next opening, but never closes the door on an earlier call. One CTA, link last.
 */
export function buildHoldNoResponseSmsBody(opts: {
  shopLabel?: string | null
  /** True → "tonight", false → "right now" (shop-local evening/overnight). */
  night: boolean
  /** e.g. "tomorrow at 9:00 AM" — omitted when the schedule can't provide one. */
  nextOpenLabel?: string | null
  link: string
}): string {
  const shop = (opts.shopLabel || "").trim().replace(/\s+/g, " ") || "Key Squad"
  const when = opts.night ? "tonight" : "right now"
  const nextOpen = opts.nextOpenLabel?.trim()
  if (nextOpen) {
    return `${shop} — sorry, our whole team is still unavailable ${when}. We're back ${nextOpen} and you're at the top of our list. If anything frees up sooner, we'll call you right away. Book anytime: ${opts.link}`
  }
  return `${shop} — sorry, our whole team is still unavailable ${when}. You're at the top of our list — if anything frees up, we'll call you right away. Book anytime: ${opts.link}`
}

/**
 * Owner texting the shop line "HANDLED" (or "GOT IT" / "ON IT" / "MINE") from
 * their alert phone — a call made from a personal cell is invisible to the
 * platform, so this is how the owner says "I'm already on it" and stops the
 * no-response follow-up. Optionally targets one customer by trailing digits
 * ("HANDLED 0137"); bare keyword means the most recent waiting customer.
 */
export function parseOwnerHandledCommand(
  text: string
): { targetDigits: string | null } | null {
  const m = String(text || "")
    .trim()
    .match(/^(handled|got\s*it|on\s*it|mine)\b[\s.,!:-]*(\d{4,10})?\s*$/i)
  if (!m) return null
  return { targetDigits: m[2] || null }
}

/**
 * Mark the owner's most recent hold (or the digits-matched one) as handled so the
 * sweep never texts that customer. Also covers a STILL-ACTIVE hold (waiting /
 * holding): the long-wait alert fires mid-hold, so "HANDLED" often arrives before
 * the row times out — pre-setting the marker keeps the later timeout silent.
 */
export async function cancelPendingHoldFollowup(params: {
  ownerUserId: string
  targetDigits?: string | null
}): Promise<{ canceledCallerE164: string | null }> {
  const sql = sqlClient()
  const target = String(params.targetDigits || "").replace(/\D/g, "")
  try {
    const rows = (await sql`
      SELECT caller_e164
      FROM call_queue
      WHERE user_id = ${params.ownerUserId}::uuid
        AND status IN ('waiting', 'holding', 'timed_out', 'sms_left')
        AND no_response_followup_at IS NULL
        AND COALESCE(left_at, enqueued_at) > now() - (${NO_RESPONSE_MAX_AGE_MINUTES}::text || ' minutes')::interval
        AND (
          ${target} = ''
          OR RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), ${target.length || 4}) = ${target}
        )
      ORDER BY COALESCE(left_at, enqueued_at) DESC
      LIMIT 1
    `) as { caller_e164: string | null }[]
    const caller = rows[0]?.caller_e164?.trim() || null
    if (!caller) return { canceledCallerE164: null }
    const callerDigits = last10Digits(caller)
    await sql`
      UPDATE call_queue
      SET no_response_followup_at = now()
      WHERE user_id = ${params.ownerUserId}::uuid
        AND no_response_followup_at IS NULL
        AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
    `
    console.log(
      lyncrLog("hold-no-response-owner-handled", { userId: params.ownerUserId })
    )
    return { canceledCallerE164: caller }
  } catch (e) {
    console.warn(lyncrLog("hold-no-response-cancel-failed", { error: String(e) }))
    return { canceledCallerE164: null }
  }
}

type SweepCandidate = {
  user_id: string
  caller_e164: string
  business_line_e164: string | null
  left_at: string
}

type OwnerContext = {
  presenceClosed: boolean
  hours: AccountWeeklyHours | null
  nextOpenLabel: string | null
  night: boolean
}

async function loadOwnerContext(userId: string): Promise<OwnerContext> {
  try {
    const presence = await getAccountPresence(userId)
    if (presence.presenceStatus !== "CLOSED") {
      return { presenceClosed: false, hours: null, nextOpenLabel: null, night: false }
    }
    const hours = await getAccountWeeklyHours(userId)
    return {
      presenceClosed: true,
      hours,
      nextOpenLabel: nextScheduledOpeningLabel(hours),
      night: isLocalNight(hours.timezone),
    }
  } catch (e) {
    console.warn(lyncrLog("hold-no-response-owner-context-failed", { userId, error: String(e) }))
    // Fail closed — better to skip a follow-up than text during open hours.
    return { presenceClosed: false, hours: null, nextOpenLabel: null, night: false }
  }
}

/** True when the owner (or the customer themselves) already moved this along. */
export async function conversationMovedOn(params: {
  userId: string
  callerDigits: string
  leftAtIso: string
}): Promise<boolean> {
  const sql = sqlClient()
  const { userId, callerDigits, leftAtIso } = params

  // Outbound workspace SMS after the automated-link grace window = owner replied.
  const smsRows = await sql`
    SELECT 1 FROM sms_messages
    WHERE owner_user_id = ${userId}::uuid
      AND direction = 'outbound'
      AND RIGHT(regexp_replace(COALESCE(to_number, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      AND created_at > ${leftAtIso}::timestamptz + (${AUTO_SMS_GRACE_SECONDS}::text || ' seconds')::interval
    LIMIT 1
  `
  if (smsRows[0]) return true

  // A later answered call between them (owner picked up a retry, or called back
  // through the platform).
  const callRows = await sql`
    SELECT 1 FROM call_logs
    WHERE user_id = ${userId}::uuid
      AND (
        RIGHT(regexp_replace(COALESCE(from_number, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
        OR RIGHT(regexp_replace(COALESCE(to_number, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      )
      AND created_at > ${leftAtIso}::timestamptz
      AND answered_at IS NOT NULL
    LIMIT 1
  `
  if (callRows[0]) return true

  // Customer already booked through the link — the form said we'll confirm.
  const leadRows = await sql`
    SELECT 1 FROM ai_leads
    WHERE user_id = ${userId}::uuid
      AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      AND created_at > ${leftAtIso}::timestamptz
    LIMIT 1
  `
  return Boolean(leadRows[0])
}

/** Org name for the line (multi-shop), else the owner's business name. */
export async function resolveShopLabel(params: {
  userId: string
  businessLineE164: string | null
}): Promise<{ shopLabel: string | null; organizationId: string | null }> {
  const sql = sqlClient()
  let organizationId: string | null = null
  try {
    if (params.businessLineE164) {
      const line = await getActivePhoneNumberByE164(params.businessLineE164)
      if (line?.organization_id && !line.organization_id.startsWith("legacy-")) {
        organizationId = line.organization_id
        const org = await sql`
          SELECT name FROM organizations WHERE id = ${organizationId}::uuid LIMIT 1
        `
        const name = (org[0] as { name?: string } | undefined)?.name?.trim()
        if (name) return { shopLabel: name, organizationId }
      }
    }
    const user = await sql`
      SELECT business_name FROM users WHERE id = ${params.userId}::uuid LIMIT 1
    `
    const biz = (user[0] as { business_name?: string } | undefined)?.business_name?.trim()
    return { shopLabel: biz || null, organizationId }
  } catch (e) {
    console.warn(lyncrLog("hold-no-response-shop-label-failed", { error: String(e) }))
    return { shopLabel: null, organizationId }
  }
}

export type HoldNoResponseSweepResult = {
  checked: number
  sent: number
  skippedOpen: number
  skippedResponded: number
  failed: number
}

/**
 * One cron pass. Finds holds that ended in a booking-link SMS
 * (call_queue.status timed_out / sms_left) between WAIT and MAX_AGE minutes ago
 * with no decision yet, and — while the shop is still CLOSED and nobody has
 * responded — sends the unavailable-until text. Every evaluated hold is marked
 * (no_response_followup_at) so it is never re-processed.
 */
export async function runHoldNoResponseFollowupSweep(
  now: Date = new Date()
): Promise<HoldNoResponseSweepResult> {
  const sql = sqlClient()
  const result: HoldNoResponseSweepResult = {
    checked: 0,
    sent: 0,
    skippedOpen: 0,
    skippedResponded: 0,
    failed: 0,
  }

  let rows: SweepCandidate[] = []
  try {
    rows = (await sql`
      SELECT user_id, caller_e164, business_line_e164, left_at
      FROM call_queue
      WHERE status IN ('timed_out', 'sms_left')
        AND no_response_followup_at IS NULL
        AND left_at IS NOT NULL
        AND left_at <= ${now.toISOString()}::timestamptz - (${NO_RESPONSE_WAIT_MINUTES}::text || ' minutes')::interval
        AND left_at > ${now.toISOString()}::timestamptz - (${NO_RESPONSE_MAX_AGE_MINUTES}::text || ' minutes')::interval
      ORDER BY left_at DESC
      LIMIT ${SWEEP_LIMIT}
    `) as SweepCandidate[]
  } catch (e) {
    // Pre-migration (177) or missing table — nothing to sweep.
    console.warn(lyncrLog("hold-no-response-sweep-query-failed", { error: String(e) }))
    return result
  }

  // Latest hold per (owner, caller) wins; older duplicates are marked with it.
  const byOwnerCaller = new Map<string, SweepCandidate>()
  for (const row of rows) {
    const digits = last10Digits(row.caller_e164)
    if (digits.length < 10 || !row.user_id) continue
    const key = `${row.user_id}:${digits}`
    if (!byOwnerCaller.has(key)) byOwnerCaller.set(key, row)
  }

  const ownerContexts = new Map<string, OwnerContext>()

  for (const [key, candidate] of byOwnerCaller) {
    result.checked += 1
    const callerDigits = key.slice(key.indexOf(":") + 1)

    const markDecided = async () => {
      await sql`
        UPDATE call_queue
        SET no_response_followup_at = now()
        WHERE user_id = ${candidate.user_id}::uuid
          AND status IN ('timed_out', 'sms_left')
          AND no_response_followup_at IS NULL
          AND RIGHT(regexp_replace(COALESCE(caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${callerDigits}
      `.catch((e) =>
        console.warn(lyncrLog("hold-no-response-mark-failed", { error: String(e) }))
      )
    }

    try {
      let ctx = ownerContexts.get(candidate.user_id)
      if (!ctx) {
        ctx = await loadOwnerContext(candidate.user_id)
        ownerContexts.set(candidate.user_id, ctx)
      }

      // Shop is open (or presence lookup failed) — the "unavailable until we
      // reopen" message would be nonsense. Mark decided so a later closed window
      // doesn't resurrect a stale hold.
      if (!ctx.presenceClosed) {
        result.skippedOpen += 1
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
        result.skippedResponded += 1
        await markDecided()
        continue
      }

      // Reuses the open invite from the hold SMS (same /b code, prefill intact).
      const line = candidate.business_line_e164?.trim() || ""
      const invite = line
        ? await createBookingInvite({
            ownerUserId: candidate.user_id,
            businessLine: line,
            callerPhone: candidate.caller_e164,
            source: "closed_no_response_followup",
            reuseOpen: true,
          })
        : null
      const link =
        invite?.url ||
        buildBookQueryUrl({ callerPhone: candidate.caller_e164, businessLine: line || candidate.caller_e164 })

      const { shopLabel, organizationId } = await resolveShopLabel({
        userId: candidate.user_id,
        businessLineE164: candidate.business_line_e164,
      })

      const text = buildHoldNoResponseSmsBody({
        shopLabel,
        night: ctx.night,
        nextOpenLabel: ctx.nextOpenLabel,
        link,
      })

      const sent = await sendAndLogWorkspaceCustomerSms({
        ownerUserId: candidate.user_id,
        toE164: candidate.caller_e164,
        text,
        fromE164: candidate.business_line_e164 || null,
        organizationId,
      })
      if (!sent.ok) {
        // Leave unmarked — the next pass retries until MAX_AGE ages it out.
        result.failed += 1
        console.warn(
          lyncrLog("hold-no-response-send-failed", { userId: candidate.user_id, error: sent.error })
        )
        continue
      }

      await markDecided()
      result.sent += 1
      console.log(
        lyncrLog("hold-no-response-sent", {
          userId: candidate.user_id,
          nextOpenLabel: ctx.nextOpenLabel,
        })
      )
    } catch (e) {
      result.failed += 1
      console.warn(
        lyncrLog("hold-no-response-candidate-failed", {
          userId: candidate.user_id,
          error: String(e),
        })
      )
    }
  }

  return result
}
