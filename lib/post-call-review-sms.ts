// After answered inbound calls (>60s), wait 15 minutes then send a Google review SMS
// only if an intake lead or invoice already exists for that caller phone.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  getCallLogSnapshotForTelemetry,
  getOwnerSmsSettings,
  getUser,
  isReasonablePstnDialString,
  normalizePhoneNumberE164,
} from "@/lib/db"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { defaultTemplate, renderTemplate } from "@/lib/sms-pipeline"
import { SITE_NAME } from "@/lib/brand"
import { isAutomatedCallHandler } from "@/lib/missed-call-telemetry"

const REVIEW_GATE_MIN = Math.max(1, Number(process.env.ZING_CALL_REVIEW_DELAY_MIN ?? 15) || 15)
const MIN_TALK_SECONDS = 60

function sql() {
  return neon(resolveNeonDatabaseUrl())
}

function brandLabel(): string {
  const name = SITE_NAME.trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Lyncr"
}

/** Queue a 15-minute review gate for this completed inbound call (idempotent per call_sid). */
export async function maybeQueuePostCallReviewSms(params: {
  callSid: string
  callStatus: string
  durationSeconds: number
  fromNumber?: string
  direction?: string
}): Promise<void> {
  const status = params.callStatus.trim().toLowerCase().replace(/_/g, "-")
  if (status !== "completed") return
  if (params.durationSeconds < MIN_TALK_SECONDS) return

  const dir = (params.direction || "").toLowerCase()
  if (dir.includes("outbound")) return

  const snapshot = await getCallLogSnapshotForTelemetry(params.callSid).catch(() => null)
  if (!snapshot) return
  if (isAutomatedCallHandler(snapshot.routed_to_name)) return
  if (!snapshot.answered_at) return

  const talk = Math.max(params.durationSeconds, snapshot.duration_seconds ?? 0)
  if (talk < MIN_TALK_SECONDS) return

  const caller =
    normalizePhoneNumberE164(params.fromNumber || snapshot.from_number || "") ||
    ""
  if (!isReasonablePstnDialString(caller)) return

  const checkAfter = new Date(Date.now() + REVIEW_GATE_MIN * 60_000)
  try {
    await sql()`
      INSERT INTO pending_call_review_sms (
        owner_user_id, call_sid, caller_e164, check_after, status
      )
      VALUES (
        ${snapshot.user_id},
        ${params.callSid},
        ${caller},
        ${checkAfter.toISOString()},
        'pending'
      )
      ON CONFLICT (call_sid) DO NOTHING
    `
  } catch (e) {
    console.warn("[post-call-review] queue failed:", e)
  }
}

async function hasIntakeOrInvoiceForPhone(
  ownerUserId: string,
  callerE164: string
): Promise<boolean> {
  const digits = callerE164.replace(/\D/g, "")
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits
  try {
    const leadRows = await sql()`
      SELECT id FROM ai_leads
      WHERE user_id = ${ownerUserId}
        AND created_at > now() - interval '24 hours'
        AND (
          regexp_replace(coalesce(caller_e164, ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}
          OR regexp_replace(coalesce(collected->>'phone', ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}
          OR regexp_replace(coalesce(collected->>'customer_phone', ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}
        )
      LIMIT 1
    `
    if (leadRows.length > 0) return true
  } catch (e) {
    console.warn("[post-call-review] lead lookup failed:", e)
  }

  try {
    const invRows = await sql()`
      SELECT id FROM job_invoices
      WHERE owner_user_id = ${ownerUserId}
        AND regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}
        AND created_at > now() - interval '24 hours'
      LIMIT 1
    `
    if (invRows.length > 0) return true
  } catch (e) {
    console.warn("[post-call-review] invoice lookup failed:", e)
  }

  try {
    const custRows = await sql()`
      SELECT id FROM customers
      WHERE user_id = ${ownerUserId}
        AND regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}
        AND updated_at > now() - interval '24 hours'
        AND (
          nullif(trim(display_name), '') IS NOT NULL
          OR nullif(trim(address_line1), '') IS NOT NULL
          OR nullif(trim(notes), '') IS NOT NULL
        )
      LIMIT 1
    `
    if (custRows.length > 0) return true
  } catch (e) {
    console.warn("[post-call-review] customer lookup failed:", e)
  }

  return false
}

/** Process due review gates (cron / flush). */
export async function flushDuePostCallReviewSms(
  limit = 20
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0
  let skipped = 0
  let failed = 0
  let rows: Array<Record<string, unknown>> = []
  try {
    rows = (await sql()`
      SELECT id, owner_user_id, call_sid, caller_e164
      FROM pending_call_review_sms
      WHERE status = 'pending' AND check_after <= now()
      ORDER BY check_after ASC
      LIMIT ${Math.min(Math.max(limit, 1), 50)}
    `) as Array<Record<string, unknown>>
  } catch (e) {
    console.warn("[post-call-review] list due failed:", e)
    return { sent: 0, skipped: 0, failed: 0 }
  }

  for (const row of rows) {
    const id = String(row.id)
    const ownerUserId = String(row.owner_user_id)
    const callerE164 = String(row.caller_e164)

    // Claim row so concurrent flushers don't double-send.
    try {
      const claimed = await sql()`
        UPDATE pending_call_review_sms
        SET status = 'processing', processed_at = now()
        WHERE id = ${id}::uuid AND status = 'pending' AND check_after <= now()
        RETURNING id
      `
      if (claimed.length === 0) continue
    } catch {
      continue
    }

    const hasRecord = await hasIntakeOrInvoiceForPhone(ownerUserId, callerE164)
    if (!hasRecord) {
      try {
        await sql()`
          UPDATE pending_call_review_sms
          SET status = 'skipped', skip_reason = 'no-intake-or-invoice', processed_at = now()
          WHERE id = ${id}::uuid
        `
      } catch {
        /* ignore */
      }
      skipped++
      continue
    }

    const settings = await getOwnerSmsSettings(ownerUserId)
    if (settings.sms_review_enabled !== true) {
      try {
        await sql()`
          UPDATE pending_call_review_sms
          SET status = 'skipped', skip_reason = 'phase-disabled', processed_at = now()
          WHERE id = ${id}::uuid
        `
      } catch {
        /* ignore */
      }
      skipped++
      continue
    }

    const reviewUrl = settings.google_review_url?.trim() || ""
    if (!reviewUrl) {
      try {
        await sql()`
          UPDATE pending_call_review_sms
          SET status = 'skipped', skip_reason = 'no-review-url', processed_at = now()
          WHERE id = ${id}::uuid
        `
      } catch {
        /* ignore */
      }
      skipped++
      continue
    }

    const owner = await getUser(ownerUserId)
    const template = settings.sms_review_template?.trim() || defaultTemplate("review")
    const body = renderTemplate(template, {
      customer_name: "there",
      business_name: owner?.business_name?.trim() || brandLabel(),
      review_url: reviewUrl,
      time_slot: "",
      tech_name: "",
      location: "",
    })

    // Prefer Key Squad copy from the product request when using the default template.
    const finalBody =
      !settings.sms_review_template?.trim()
        ? `Thanks for choosing Key Squad! If we got you out of a jam today, could you leave us a quick review? It helps a local small business a ton: ${reviewUrl}`
        : body

    const res = await sendTelnyxSms({
      toE164: callerE164,
      text: finalBody,
      userId: ownerUserId,
    })
    if (!res.ok) {
      try {
        await sql()`
          UPDATE pending_call_review_sms
          SET status = 'failed', skip_reason = ${String(res.error || "send-failed").slice(0, 200)}, processed_at = now()
          WHERE id = ${id}::uuid
        `
      } catch {
        /* ignore */
      }
      failed++
      continue
    }

    try {
      await sql()`
        UPDATE pending_call_review_sms
        SET status = 'sent', processed_at = now()
        WHERE id = ${id}::uuid
      `
    } catch {
      /* ignore */
    }
    sent++
  }

  return { sent, skipped, failed }
}
