/**
 * Amber inbound SMS handler — owner commands on the business-owned Amber DID.
 */

import { setAccountPresence, getAccountPresence } from "@/lib/account-presence"
import {
  amberHelpText,
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

function formatUntilLabel(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at)
  } catch {
    return at.toISOString()
  }
}

async function replyFromAmber(params: {
  amber: AmberWorkspaceRow
  toOwnerMobile: string
  text: string
}): Promise<void> {
  const sent = await sendAmberOwnerSms({
    userId: params.amber.user_id,
    organizationId: params.amber.organization_id,
    amberNumber: params.amber.amber_number,
    toOwnerMobile: params.toOwnerMobile,
    text: params.text,
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

  // Strangers: no business data, optional STOP/HELP only.
  if (!verified || !phonesMatch(from, verified)) {
    const upper = params.text.trim().toUpperCase()
    if (upper === "STOP" || upper === "STOPALL" || upper === "UNSUBSCRIBE" || upper === "CANCEL" || upper === "END" || upper === "QUIT") {
      await replyFromAmber({
        amber,
        toOwnerMobile: from,
        text: "Amber alerts paused for this phone. Text START to the business support team or turn Amber back on in Lyncr Settings.",
      })
    } else if (upper === "HELP" || upper === "INFO") {
      await replyFromAmber({
        amber,
        toOwnerMobile: from,
        text: "Amber · Lyncr business assistant. Only the verified owner mobile can run commands. Msg&data rates may apply.",
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

  const cmd = parseAmberCommand(params.text)
  let reply = ""

  if (cmd.kind === "help") {
    reply = amberHelpText()
  } else if (cmd.kind === "status") {
    const presence = await getAccountPresence(amber.user_id)
    const busy = presence.presenceStatus === "ON_JOB" || presence.presenceStatus === "CLOSED"
    const until = amber.presence_available_at
      ? formatUntilLabel(new Date(amber.presence_available_at), amber.timezone)
      : null
    reply = busy
      ? until
        ? `STATUS: Busy until ${until}. Your Busy call-routing is on (phone does not ring first).`
        : "STATUS: Busy. Your Busy call-routing is on (phone does not ring first)."
      : "STATUS: Available. Your phone rings first."
  } else if (cmd.kind === "available") {
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
  } else if (cmd.kind === "busy") {
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
        untilLabel = formatUntilLabel(when, amber.timezone)
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
    reply =
      "I didn't catch that. Reply HELP for commands, or try: BUSY until 4:30pm / AVAILABLE / STATUS."
    await insertAmberAuditEvent({
      userId: amber.user_id,
      organizationId: amber.organization_id,
      eventType: "inbound_unknown",
      detail: { raw: params.text.slice(0, 200) },
    })
  }

  if (reply) {
    await replyFromAmber({ amber, toOwnerMobile: from, text: reply })
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
