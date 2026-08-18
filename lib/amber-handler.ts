/**
 * Amber inbound SMS handler — owner commands on the business-owned Amber DID.
 */

import { setAccountPresence, getAccountPresence } from "@/lib/account-presence"
import {
  amberHelpText,
  formatAmberUntilLabel,
  parseAmberCommand,
  resolveAmberUntilInstant,
} from "@/lib/amber-commands"
import {
  getAmberWorkspaceByControlE164,
  insertAmberAuditEvent,
  setAmberPresenceAvailableAt,
  type AmberWorkspaceRow,
} from "@/lib/amber-db"
import { sendAmberOwnerSms } from "@/lib/amber-owner-sms"
import { normalizePhoneNumberE164 } from "@/lib/db"

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePhoneNumberE164(a || "")
  const y = normalizePhoneNumberE164(b || "")
  if (!x || !y || x.length < 10 || y.length < 10) return false
  return x.slice(-10) === y.slice(-10)
}

async function replyFromAmber(params: {
  amber: AmberWorkspaceRow
  toOwnerMobile: string
  text: string
  amberOnly?: boolean
}): Promise<void> {
  const sent = await sendAmberOwnerSms({
    userId: params.amber.user_id,
    organizationId: params.amber.organization_id,
    amberNumber: params.amber.amber_number,
    toOwnerMobile: params.toOwnerMobile,
    text: params.text,
    amberOnly: params.amberOnly,
  })
  if (!sent.ok) {
    console.warn(`[amber] reply failed: ${sent.error}`)
  }
}

/**
 * If To is an Amber control DID, handle as owner assistant SMS.
 * Returns true when the message was consumed (do not treat as customer SMS).
 */
export async function tryHandleAmberInboundSms(params: {
  fromE164: string
  toE164: string
  text: string
  telnyxMessageId?: string | null
}): Promise<boolean> {
  const amber = await getAmberWorkspaceByControlE164(params.toE164)
  if (!amber || !amber.enabled) return false

  const from = normalizePhoneNumberE164(params.fromE164)
  const verified = amber.owner_mobile_e164

  const { claimAmberInboundMessageId } = await import("@/lib/amber-coworker-db")
  const fresh = await claimAmberInboundMessageId(params.telnyxMessageId)
  if (!fresh) return true

  // Strangers: no business data, optional STOP/HELP only.
  if (!verified || !phonesMatch(from, verified)) {
    const upper = params.text.trim().toUpperCase()
    if (upper === "STOP" || upper === "STOPALL" || upper === "UNSUBSCRIBE" || upper === "CANCEL" || upper === "END" || upper === "QUIT") {
      // Never fall back to the shop line for a stranger who texted Amber.
      await replyFromAmber({
        amber,
        toOwnerMobile: from,
        text: "Amber alerts paused for this phone. Text START to the business support team or turn Amber back on in Lyncr Settings.",
        amberOnly: true,
      })
    } else if (upper === "HELP" || upper === "INFO") {
      // Same rule: Amber DID only, so the business number stays off this thread.
      await replyFromAmber({
        amber,
        toOwnerMobile: from,
        text: "Amber · Lyncr business assistant. Only the verified owner mobile can run commands. Msg&data rates may apply.",
        amberOnly: true,
      })
    }
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "inbound_unauthorized",
      detail: { from, telnyxMessageId: params.telnyxMessageId ?? null },
    })
    return true
  }

  const {
    parseAmberCoworkerCommand,
    isAmberStopKeyword,
    isAmberStartKeyword,
    isBareAmberPresenceCommand,
    extractAmberSkipCustomerName,
    amberSkipNameMatchesCustomer,
  } = await import("@/lib/amber-coworker-commands")
  const {
    getOpenAmberJobThread,
    setAmberCoworkerPaused,
  } = await import("@/lib/amber-coworker-db")
  const {
    draftAmberCustomerSms,
    sendAmberApprovedCustomerSms,
    skipAmberJobThread,
  } = await import("@/lib/amber-coworker")

  let reply = ""

  if (isAmberStopKeyword(params.text)) {
    await setAmberCoworkerPaused({ amberWorkspaceId: amber.id, paused: true })
    reply =
      "Leftover job pings paused. Text START to resume. BUSY / AVAILABLE still work."
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "coworker_paused",
      detail: { source: "sms" },
    })
    await replyFromAmber({ amber, toOwnerMobile: from, text: reply, amberOnly: true })
    return true
  }
  if (isAmberStartKeyword(params.text)) {
    await setAmberCoworkerPaused({ amberWorkspaceId: amber.id, paused: false })
    reply = "Leftover job pings are on again. I’ll text you when a book form sits too long."
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "coworker_resumed",
      detail: { source: "sms" },
    })
    await replyFromAmber({ amber, toOwnerMobile: from, text: reply, amberOnly: true })
    return true
  }

  let coworkerChannel = false
  const cmd = parseAmberCommand(params.text)
  const thread = await getOpenAmberJobThread({
    userId: amber.user_id,
    amberWorkspaceId: amber.id,
  })
  const honorPresence =
    !thread ||
    isBareAmberPresenceCommand(params.text) ||
    cmd.kind === "help" ||
    cmd.kind === "greeting" ||
    cmd.kind === "status" ||
    cmd.kind === "briefing"

  if (honorPresence && cmd.kind === "help") {
    reply = amberHelpText()
  } else if (honorPresence && cmd.kind === "greeting") {
    const presence = await getAccountPresence(amber.user_id)
    const busy = presence.presenceStatus === "ON_JOB" || presence.presenceStatus === "CLOSED"
    const until = amber.presence_available_at
      ? formatAmberUntilLabel(new Date(amber.presence_available_at), amber.timezone)
      : null
    const { loadAmberBriefingLines, formatAmberHelloSms } = await import("@/lib/amber-briefing")
    const lines = await loadAmberBriefingLines({ amber })
    reply = formatAmberHelloSms({ busy, untilLabel: until, lines })
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "greeting",
      detail: { leftoverCount: lines.length },
    })
  } else if (honorPresence && cmd.kind === "status") {
    const presence = await getAccountPresence(amber.user_id)
    const busy = presence.presenceStatus === "ON_JOB" || presence.presenceStatus === "CLOSED"
    const until = amber.presence_available_at
      ? formatAmberUntilLabel(new Date(amber.presence_available_at), amber.timezone)
      : null
    reply = busy
      ? until
        ? `STATUS: Busy until ${until}. Your Busy call-routing is on (phone does not ring first).`
        : "STATUS: Busy. Your Busy call-routing is on (phone does not ring first)."
      : "STATUS: Available. Your phone rings first."
  } else if (honorPresence && cmd.kind === "briefing") {
    const presence = await getAccountPresence(amber.user_id)
    const busy = presence.presenceStatus === "ON_JOB" || presence.presenceStatus === "CLOSED"
    const { loadAmberBriefingLines, formatAmberBriefingSms } = await import("@/lib/amber-briefing")
    const lines = await loadAmberBriefingLines({ amber })
    reply = formatAmberBriefingSms({ busy, lines })
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "briefing",
      detail: { leftoverCount: lines.length },
    })
  } else if (honorPresence && cmd.kind === "available") {
    await setAccountPresence({ ownerUserId: amber.user_id, presenceStatus: "AVAILABLE" })
    await setAmberPresenceAvailableAt({ amberWorkspaceId: amber.id, availableAt: null })
    reply =
      "You're Available again. Your phone rings first. Logged in Lyncr."
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "presence_available",
      detail: { source: "sms" },
    })
  } else if (honorPresence && cmd.kind === "busy") {
    await setAccountPresence({ ownerUserId: amber.user_id, presenceStatus: "ON_JOB" })
    let untilLabel: string | null = null
    if (cmd.untilLocalTime) {
      const when = resolveAmberUntilInstant({
        untilLocalTime: cmd.untilLocalTime,
        timezone: amber.timezone,
      })
      if (!when) {
        reply =
          "You're Busy now, but I couldn't read that time. Reply like: BUSY until 4:30pm — or AVAILABLE to go free."
        await setAmberPresenceAvailableAt({ amberWorkspaceId: amber.id, availableAt: null })
      } else {
        await setAmberPresenceAvailableAt({ amberWorkspaceId: amber.id, availableAt: when })
        untilLabel = formatAmberUntilLabel(when, amber.timezone)
        reply = `You're Busy until ${untilLabel}. Your Busy call-routing is on (phone does not ring first). I'll set you Available at ${untilLabel}. Reply AVAILABLE anytime to go free now.`
      }
    } else {
      await setAmberPresenceAvailableAt({ amberWorkspaceId: amber.id, availableAt: null })
      reply =
        "You're Busy. Your Busy call-routing is on (phone does not ring first). Reply AVAILABLE when you're free, or BUSY until 4:30pm to auto-return."
    }
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "presence_busy",
      detail: { source: "sms", until: untilLabel, untilRaw: cmd.untilLocalTime },
    })
  } else {
    const coworker = parseAmberCoworkerCommand(params.text)
    coworkerChannel = Boolean(thread) || coworker.kind === "skip"
    if (thread && coworker.kind === "send") {
      if (thread.state !== "awaiting_send") {
        reply =
          "Nothing to send yet. Tell me what you want them to hear — I’ll show you a draft first."
      } else {
        const sent = await sendAmberApprovedCustomerSms({ amber, thread })
        reply = sent.ok
          ? `Sent to ${thread.customer_name?.trim().split(/\s+/)[0] || "the customer"} from your business line.`
          : sent.error
      }
    } else if (coworker.kind === "skip") {
      const saidName = extractAmberSkipCustomerName(params.text)
      if (!thread) {
        reply = saidName
          ? `Nothing leftover open for ${saidName[0]}${saidName.slice(1).toLowerCase()}. If they’re still on Lines, tap Clear on that card.`
          : "Nothing leftover waiting right now."
      } else if (!amberSkipNameMatchesCustomer(saidName, thread.customer_name)) {
        const holding = thread.customer_name?.trim().split(/\s+/)[0] || "them"
        const said = saidName
          ? `${saidName[0]}${saidName.slice(1).toLowerCase()}`
          : "them"
        reply = `I’m holding ${holding}, not ${said}. Reply skip ${holding} to close that, or tell me what to text them.`
      } else {
        const first = thread.customer_name?.trim().split(/\s+/)[0] || "them"
        await skipAmberJobThread({ amber, thread })
        reply = `Okay — ${first} is off the leftover list. I won’t text them about that request.`
      }
    } else if (thread && coworker.kind === "instruction" && coworker.text) {
      const { resolveAmberLeftoverIntent, buildAmberClarifySms } = await import("@/lib/amber-intent")
      const first = thread.customer_name?.trim().split(/\s+/)[0] || "them"
      const hasQuotedDraft = thread.state === "awaiting_send" && Boolean(thread.draft_body?.trim())
      const intent = await resolveAmberLeftoverIntent({
        text: coworker.text,
        customerFirstName: first,
        hasQuotedDraft,
      })
      if (intent === "skip") {
        await skipAmberJobThread({ amber, thread })
        reply = "Okay — I won’t text them about that request."
      } else if (intent === "send") {
        if (thread.state !== "awaiting_send") {
          reply =
            "Nothing to send yet. Tell me what you want them to hear — I’ll show you a draft first."
        } else {
          const sent = await sendAmberApprovedCustomerSms({ amber, thread })
          reply = sent.ok
            ? `Sent to ${first} from your business line.`
            : sent.error
        }
      } else if (intent === "status") {
        const presence = await getAccountPresence(amber.user_id)
        const busy = presence.presenceStatus === "ON_JOB" || presence.presenceStatus === "CLOSED"
        const until = amber.presence_available_at
          ? formatAmberUntilLabel(new Date(amber.presence_available_at), amber.timezone)
          : null
        reply = busy
          ? until
            ? `STATUS: Busy until ${until}. Your Busy call-routing is on (phone does not ring first).`
            : "STATUS: Busy. Your Busy call-routing is on (phone does not ring first)."
          : "STATUS: Available. Your phone rings first."
      } else if (intent === "ask") {
        reply = buildAmberClarifySms({ customerFirstName: first, hasQuotedDraft })
      } else {
        reply = await draftAmberCustomerSms({
          amber,
          thread,
          instruction: coworker.text,
        })
      }
    } else {
      reply = thread
        ? "I didn’t catch that. Try skip plus their name, ok to send a draft, What’s my status, Any important events?, or I’m free."
        : "I didn’t catch that. Try What’s my status, Any important events?, I’m slammed until 4:30, or I’m free."
      await insertAmberAuditEvent({
        userId: amber.user_id,
        organizationId: amber.organization_id,
        eventType: "inbound_unknown",
        detail: { raw: params.text.slice(0, 200) },
      })
    }
  }

  if (reply) {
    await replyFromAmber({
      amber,
      toOwnerMobile: from,
      text: reply,
      amberOnly: coworkerChannel,
    })
  }
  return true
}

/** Cron: flip Busy → Available when presence_available_at is due. */
export async function processAmberScheduledAvailable(): Promise<{ flipped: number }> {
  const { listAmberDueForAvailable } = await import("@/lib/amber-db")
  const due = await listAmberDueForAvailable()
  let flipped = 0
  for (const amber of due) {
    try {
      await setAccountPresence({ ownerUserId: amber.user_id, presenceStatus: "AVAILABLE" })
      await setAmberPresenceAvailableAt({ amberWorkspaceId: amber.id, availableAt: null })
      flipped += 1
      if (amber.owner_mobile_e164 && amber.amber_number) {
        await replyFromAmber({
          amber,
          toOwnerMobile: amber.owner_mobile_e164,
          text: "You're Available again (scheduled). Your phone rings first.",
        })
      }
      await insertAmberAuditEvent({
        userId: amber.user_id,
        organizationId: amber.organization_id,
        eventType: "presence_available_scheduled",
        detail: {},
      })
    } catch (e) {
      console.warn("[amber-cron] flip failed:", e)
      if (amber.owner_mobile_e164 && amber.amber_number) {
        await replyFromAmber({
          amber,
          toOwnerMobile: amber.owner_mobile_e164,
          text: "I couldn't switch you to Available automatically. Reply AVAILABLE or open Lyncr → Lines.",
        }).catch(() => {})
      }
    }
  }
  return { flipped }
}
