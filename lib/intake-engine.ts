// Call intake engine — persist AI leads and dispatch optional owner SMS alerts.

import {
  getOnboardingProfile,
  getUser,
  insertAiLead,
  updateAiLeadSmsOutcome,
} from "@/lib/db"
import { buildLeadAlertSmsText } from "@/lib/lead-sms-alert"
import { resolveLeadAlertSmsRecipient } from "@/lib/lead-sms-recipient"
import { shouldSendLeadSmsForPlatformAdmin } from "@/lib/master-toggle-dispatch"
import { sendTelnyxSms } from "@/lib/telnyx-sms"

/** US 555-01xx numbers are reserved for fiction — Telnyx cannot deliver SMS to them. */
function isLikelyFictionalUs555Number(e164: string): boolean {
  const digits = e164.replace(/\D/g, "")
  if (digits.length < 11) return false
  const national = digits.startsWith("1") ? digits.slice(1) : digits
  return national.length === 10 && national.slice(3, 6) === "555"
}

export type SaveCallIntakeParams = {
  user_id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  vapi_call_id: string | null
}

export type SaveCallIntakeResult = {
  id: string
  sms_sent: boolean
  sms_error: string | null
  telnyx_message_id: string | null
  sms_from: string | null
  sms_to: string | null
}

async function maybeDispatchLeadSmsAlert(params: {
  userId: string
  leadId: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
}): Promise<{
  sms_sent: boolean
  sms_error: string | null
  telnyx_message_id: string | null
  sms_from: string | null
  sms_to: string | null
}> {
  const [profile, user] = await Promise.all([
    getOnboardingProfile(params.userId),
    getUser(params.userId),
  ])

  if (!profile?.sms_leads_enabled) {
    return {
      sms_sent: false,
      sms_error: null,
      telnyx_message_id: null,
      sms_from: null,
      sms_to: null,
    }
  }

  if (user && !shouldSendLeadSmsForPlatformAdmin(user)) {
    console.info("[master-toggle] suppressed lead SMS for platform admin", {
      userId: params.userId,
      mode: user.master_toggle_mode ?? "admin",
    })
    return {
      sms_sent: false,
      sms_error: null,
      telnyx_message_id: null,
      sms_from: null,
      sms_to: null,
    }
  }

  const targetSmsNumber = resolveLeadAlertSmsRecipient(profile, user)
  if (!targetSmsNumber) {
    return {
      sms_sent: false,
      sms_error: "No dispatch or profile phone configured for SMS alerts",
      telnyx_message_id: null,
      sms_from: null,
      sms_to: null,
    }
  }

  if (isLikelyFictionalUs555Number(targetSmsNumber)) {
    return {
      sms_sent: false,
      sms_error:
        "Dispatch number is a sandbox 555 line — set SANDBOX_SMS_DISPATCH_E164 in Vercel to your real cell, then re-seed",
      telnyx_message_id: null,
      sms_from: null,
      sms_to: targetSmsNumber,
    }
  }

  const text = buildLeadAlertSmsText({
    businessName: user?.business_name?.trim() || user?.name?.trim() || "Your business",
    callerE164: params.caller_e164,
    intentSlug: params.intent_slug,
    collected: params.collected,
    summary: params.summary,
  })

  const sent = await sendTelnyxSms({ toE164: targetSmsNumber, text, userId: params.userId })
  if (sent.ok) {
    return {
      sms_sent: true,
      sms_error: sent.delivery_warning,
      telnyx_message_id: sent.message_id,
      sms_from: sent.from,
      sms_to: sent.to,
    }
  }
  return {
    sms_sent: false,
    sms_error: sent.error,
    telnyx_message_id: null,
    sms_from: null,
    sms_to: targetSmsNumber,
  }
}

/**
 * Save an AI intake lead, then optionally text the owner when SMS alerts are enabled.
 */
export async function saveCallIntake(params: SaveCallIntakeParams): Promise<SaveCallIntakeResult> {
  const leadId = await insertAiLead({
    user_id: params.user_id,
    caller_e164: params.caller_e164,
    intent_slug: params.intent_slug,
    collected: params.collected,
    summary: params.summary,
    sms_sent: false,
    sms_error: null,
    vapi_call_id: params.vapi_call_id,
  })

  const smsOutcome = await maybeDispatchLeadSmsAlert({
    userId: params.user_id,
    leadId,
    caller_e164: params.caller_e164,
    intent_slug: params.intent_slug,
    collected: params.collected,
    summary: params.summary,
  })

  if (smsOutcome.sms_sent || smsOutcome.sms_error) {
    await updateAiLeadSmsOutcome(leadId, smsOutcome)
  }

  return {
    id: leadId,
    sms_sent: smsOutcome.sms_sent,
    sms_error: smsOutcome.sms_error,
    telnyx_message_id: smsOutcome.telnyx_message_id,
    sms_from: smsOutcome.sms_from,
    sms_to: smsOutcome.sms_to,
  }
}
