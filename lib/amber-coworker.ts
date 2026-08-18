/**
 * Amber leftover book-form coworker — ping owner, draft, send only on SEND.
 */

import { getUser } from "@/lib/db"
import { sendAmberOwnerSms } from "@/lib/amber-owner-sms"
import {
  AMBER_SILENT_LEFTOVER_MS,
  buildAmberDraftPreviewText,
  buildAmberLeftoverPingText,
  buildCustomerDraftFromInstruction,
  buildGotItHoldingCustomerSms,
  buildGotItOwnerRecapSms,
  amberCustomerFirstName,
  amberPhoneLast4,
  shouldHoldLeftoverPing,
} from "@/lib/amber-coworker-commands"
import {
  claimAmberLeftoverThread,
  countAmberPingsSince,
  customerAlreadyGotOutboundSms,
  expireStaleAmberDrafts,
  listLeftoverBookFormCandidates,
  listSilentOpenAmberThreads,
  lostLeadRecoveryAlreadySent,
  markAmberThreadPingFailed,
  updateAmberJobThread,
  type AmberJobThreadRow,
} from "@/lib/amber-coworker-db"
import { sendGotItHoldingCustomerSms } from "@/lib/got-it-customer-sms"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import { resolveWorkspaceSmsSender } from "@/lib/workspace-sms-sender"
import { insertAmberAuditEvent, type AmberWorkspaceRow } from "@/lib/amber-db"

const DRAFT_TTL_MS = 15 * 60 * 1000
const MAX_PINGS_PER_DAY = 5

function startOfLocalDayIso(timezone: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "01"
  const y = get("year")
  const m = get("month")
  const d = get("day")
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`).toISOString()
}

async function pingOwnerFromAmber(params: {
  userId: string
  organizationId: string | null
  amberNumber: string
  toOwnerMobile: string
  text: string
}): Promise<{ ok: boolean; error?: string }> {
  const sent = await sendAmberOwnerSms({
    userId: params.userId,
    organizationId: params.organizationId,
    amberNumber: params.amberNumber,
    toOwnerMobile: params.toOwnerMobile,
    text: params.text,
    amberOnly: true,
  })
  if (!sent.ok) return { ok: false, error: sent.error }
  if (sent.delivery_warning) return { ok: false, error: sent.delivery_warning }
  const used = sent.used_from || ""
  if (used && used !== params.amberNumber) {
    return { ok: false, error: "Amber ping must come from the Amber number." }
  }
  return { ok: true }
}

async function polishDraft(params: {
  instruction: string
  customerFirstName: string
  businessName: string
}): Promise<string> {
  const fallback = buildCustomerDraftFromInstruction(params)
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return fallback
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 180,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Write one customer SMS from the owner's instruction. Return JSON {\"draft\":\"...\"}. Under 280 characters. Do not invent prices, times, or promises the owner did not say. Use the customer first name and business sign-off when given.",
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction: params.instruction,
              customerFirstName: params.customerFirstName,
              businessName: params.businessName,
              heuristic: fallback,
            }),
          },
        ],
      }),
    })
    if (!res.ok) return fallback
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = json.choices?.[0]?.message?.content?.trim()
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { draft?: unknown }
    const draft = typeof parsed.draft === "string" ? parsed.draft.trim() : ""
    return draft ? draft.slice(0, 280) : fallback
  } catch {
    return fallback
  }
}

/** Cron: leftover book forms → ping, then cover if the owner stays silent. */
export async function processAmberLeftoverBookJobs(): Promise<{
  pinged: number
  skipped: number
  autoHeld: number
}> {
  const expired = await expireStaleAmberDrafts()
  for (const thread of expired) {
    await insertAmberAuditEvent({
      userId: thread.user_id,
      organizationId: thread.organization_id,
      eventType: "coworker_draft_expired",
      detail: { lead_id: thread.lead_id, thread_id: thread.id },
    })
  }

  // Unstick unanswered leftovers before claiming a new one.
  const silent = await processSilentAmberLeftovers()

  const candidates = await listLeftoverBookFormCandidates(12)
  let pinged = 0
  let skipped = 0
  const claimedWorkspaces = new Set<string>()

  for (const c of candidates) {
    if (claimedWorkspaces.has(c.amber_workspace_id)) {
      skipped += 1
      continue
    }
    if (shouldHoldLeftoverPing({ urgency: c.urgency, timezone: c.timezone })) {
      skipped += 1
      continue
    }
    const alreadySms = await customerAlreadyGotOutboundSms({
      userId: c.user_id,
      customerPhone: c.caller_e164,
      sinceIso: c.created_at,
    })
    if (alreadySms) {
      skipped += 1
      continue
    }
    const recovered = await lostLeadRecoveryAlreadySent({
      userId: c.user_id,
      customerPhone: c.caller_e164,
    })
    if (recovered) {
      skipped += 1
      continue
    }
    const dayCount = await countAmberPingsSince({
      userId: c.user_id,
      sinceIso: startOfLocalDayIso(c.timezone),
    })
    if (dayCount >= MAX_PINGS_PER_DAY) {
      skipped += 1
      continue
    }

    const claimed = await claimAmberLeftoverThread({
      amberWorkspaceId: c.amber_workspace_id,
      userId: c.user_id,
      organizationId: c.organization_id,
      leadId: c.lead_id,
      customerPhone: c.caller_e164,
      customerName: c.customer_name,
      jobLabel: c.job_label,
      addressSnippet: c.address_snippet,
      urgency: c.urgency,
    })
    if (!claimed) {
      skipped += 1
      continue
    }
    claimedWorkspaces.add(c.amber_workspace_id)

    const minutesAgo = Math.max(1, Math.round((Date.now() - Date.parse(c.created_at)) / 60_000))
    const user = await getUser(c.user_id)
    const businessName = String(user?.business_name ?? "").trim() || "us"
    const first = amberCustomerFirstName(c.customer_name)
    // Quote a safe got-it draft so the owner can reply ok — no SEND password.
    const holding = buildGotItHoldingCustomerSms({
      customerFirstName: first,
      businessName,
    })
    await updateAmberJobThread({
      threadId: claimed.id,
      state: "awaiting_send",
      draftBody: holding,
      draftExpiresAt: new Date(Date.now() + AMBER_SILENT_LEFTOVER_MS),
    })
    const text = buildAmberLeftoverPingText({
      customerName: c.customer_name || "Customer",
      jobLabel: c.job_label,
      addressSnippet: c.address_snippet,
      minutesAgo,
      urgency: c.urgency,
      last4: amberPhoneLast4(c.caller_e164),
      draftBody: holding,
    })
    const sent = await pingOwnerFromAmber({
      userId: c.user_id,
      organizationId: c.organization_id,
      amberNumber: c.amber_number,
      toOwnerMobile: c.owner_mobile_e164,
      text,
    })
    if (!sent.ok) {
      await markAmberThreadPingFailed(claimed.id)
      await insertAmberAuditEvent({
        userId: c.user_id,
        organizationId: c.organization_id,
        eventType: "coworker_ping_failed",
        detail: { lead_id: c.lead_id, error: sent.error ?? "send_failed" },
      })
      skipped += 1
      continue
    }
    pinged += 1
    await insertAmberAuditEvent({
      userId: c.user_id,
      organizationId: c.organization_id,
      eventType: "coworker_pinged",
      detail: { lead_id: c.lead_id, thread_id: claimed.id },
    })
  }

  return { pinged, skipped, autoHeld: silent.autoHeld }
}

/** After 45 minutes with no SEND/SKIP, text the customer a holding note and free the queue. */
export async function processSilentAmberLeftovers(): Promise<{ autoHeld: number; skipped: number }> {
  const stale = await listSilentOpenAmberThreads()
  let autoHeld = 0
  let skipped = 0
  for (const thread of stale) {
    const first = amberCustomerFirstName(thread.customer_name)
    // If the shop already texted after this leftover ping, don't send a second note.
    const already = await customerAlreadyGotOutboundSms({
      userId: thread.user_id,
      customerPhone: thread.customer_phone,
      sinceIso: thread.pinged_at,
    })
    let sentOk = already
    if (!already) {
      const hold = await sendGotItHoldingCustomerSms({
        ownerUserId: thread.user_id,
        organizationId: thread.organization_id,
        leadId: thread.lead_id,
        customerPhone: thread.customer_phone,
        customerName: thread.customer_name,
        amberNumber: thread.amber_number,
      })
      sentOk = hold.sent
      if (!hold.sent) {
        await insertAmberAuditEvent({
          userId: thread.user_id,
          organizationId: thread.organization_id,
          eventType: "coworker_auto_hold_failed",
          detail: { lead_id: thread.lead_id, thread_id: thread.id, error: hold.error ?? "send_failed" },
        })
        // Close anyway so later leftovers can ping; owner gets a recap.
        await updateAmberJobThread({ threadId: thread.id, state: "expired" })
        await pingOwnerFromAmber({
          userId: thread.user_id,
          organizationId: thread.organization_id,
          amberNumber: thread.amber_number,
          toOwnerMobile: thread.owner_mobile_e164,
          text: `Couldn't text ${first} from your business line. I closed that leftover so the next one can ping. Try Messages if you still want to follow up.`,
        })
        skipped += 1
        continue
      }
    }
    await updateAmberJobThread({ threadId: thread.id, state: "sent" })
    await insertAmberAuditEvent({
      userId: thread.user_id,
      organizationId: thread.organization_id,
      eventType: "coworker_auto_hold",
      detail: {
        lead_id: thread.lead_id,
        thread_id: thread.id,
        already_sent: already,
        last4: amberPhoneLast4(thread.customer_phone),
      },
    })
    await pingOwnerFromAmber({
      userId: thread.user_id,
      organizationId: thread.organization_id,
      amberNumber: thread.amber_number,
      toOwnerMobile: thread.owner_mobile_e164,
      text: buildGotItOwnerRecapSms({ customerFirstName: first, alreadySent: already }),
    })
    if (sentOk) autoHeld += 1
  }
  return { autoHeld, skipped }
}

export async function draftAmberCustomerSms(params: {
  amber: AmberWorkspaceRow
  thread: AmberJobThreadRow
  instruction: string
}): Promise<string> {
  const user = await getUser(params.amber.user_id)
  const businessName = String(user?.business_name ?? "").trim() || "us"
  const first = amberCustomerFirstName(params.thread.customer_name)
  const draft = await polishDraft({
    instruction: params.instruction,
    customerFirstName: first,
    businessName,
  })
  const expires = new Date(Date.now() + DRAFT_TTL_MS)
  await updateAmberJobThread({
    threadId: params.thread.id,
    state: "awaiting_send",
    draftBody: draft,
    draftExpiresAt: expires,
    lastInstruction: params.instruction.slice(0, 400),
  })
  return buildAmberDraftPreviewText({
    customerFirstName: first,
    last4: amberPhoneLast4(params.thread.customer_phone),
    draftBody: draft,
  })
}

export async function sendAmberApprovedCustomerSms(params: {
  amber: AmberWorkspaceRow
  thread: AmberJobThreadRow
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const draft = params.thread.draft_body?.trim()
  if (!draft) return { ok: false, error: "No draft to send. Tell me what to say first." }
  const expires = params.thread.draft_expires_at ? Date.parse(params.thread.draft_expires_at) : 0
  if (expires && expires < Date.now()) {
    await updateAmberJobThread({ threadId: params.thread.id, state: "expired" })
    return { ok: false, error: "That draft expired. Tell me what to say and I’ll draft again." }
  }

  const sender = await resolveWorkspaceSmsSender(
    params.amber.user_id,
    params.amber.organization_id
  )
  if (!sender.ok) return { ok: false, error: sender.message }
  if (params.amber.amber_number && sender.from_e164 === params.amber.amber_number) {
    return { ok: false, error: "Could not send from your business line." }
  }

  const sent = await sendAndLogWorkspaceCustomerSms({
    ownerUserId: params.amber.user_id,
    organizationId: params.amber.organization_id,
    toE164: params.thread.customer_phone,
    fromE164: sender.from_e164,
    text: draft,
  })
  if (!sent.ok) {
    return { ok: false, error: sent.error || "Could not send. Try again or open Messages." }
  }
  if (sent.delivery_warning) {
    return { ok: false, error: sent.delivery_warning }
  }
  await updateAmberJobThread({ threadId: params.thread.id, state: "sent" })
  await insertAmberAuditEvent({
    userId: params.amber.user_id,
    organizationId: params.amber.organization_id,
    eventType: "coworker_sent",
    detail: {
      lead_id: params.thread.lead_id,
      thread_id: params.thread.id,
      last4: amberPhoneLast4(params.thread.customer_phone),
    },
  })
  return { ok: true }
}

export async function skipAmberJobThread(params: {
  amber: AmberWorkspaceRow
  thread: AmberJobThreadRow
}): Promise<void> {
  await updateAmberJobThread({ threadId: params.thread.id, state: "skipped" })
  await insertAmberAuditEvent({
    userId: params.amber.user_id,
    organizationId: params.amber.organization_id,
    eventType: "coworker_skipped",
    detail: { lead_id: params.thread.lead_id, thread_id: params.thread.id },
  })
}
