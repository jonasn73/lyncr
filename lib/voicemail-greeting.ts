// Professional voicemail copy for inbound TeXML `<Say>` + `<Record>`.

import { VoiceResponse } from "@/lib/telnyx"
import { resolveWorkspaceDisplayName } from "@/lib/inbound-branded-greeting"
import { texmlSayNatural } from "@/lib/texml-say-voice"

/** Substrings that mean “no real greeting configured” — replace with branded default. */
const GENERIC_VOICEMAIL_MARKERS = [
  "sorry we could not reach you",
  "please leave a message after the beep",
  "please leave a message after the tone",
  "we're sorry, no one is available",
  "no one is available right now",
] as const

export function buildProfessionalVoicemailGreeting(displayName: string): string {
  const name = displayName.trim() || "our office"
  return (
    `Thank you for calling ${name}. ` +
    `We're unable to take your call right now. ` +
    `Please leave your name, phone number, and a brief message after the tone, ` +
    `and we'll return your call as soon as we can.`
  )
}

/** True when routing `ai_greeting` is empty or still a legacy placeholder. */
export function isGenericVoicemailGreeting(greeting: string | null | undefined): boolean {
  const g = (greeting ?? "").trim().toLowerCase()
  if (!g) return true
  return GENERIC_VOICEMAIL_MARKERS.some((marker) => g.includes(marker))
}

export function resolveVoicemailGreetingText(opts: {
  customGreeting?: string | null
  organizationName?: string | null
  phoneLineLabel?: string | null
  businessName?: string | null
  accountBusinessName?: string | null
}): string {
  const custom = opts.customGreeting?.trim()
  if (custom && !isGenericVoicemailGreeting(custom)) return custom

  const displayName = resolveWorkspaceDisplayName({
    organization_name: opts.organizationName,
    phone_line_label: opts.phoneLineLabel,
    business_name: opts.businessName ?? opts.accountBusinessName,
  })
  return buildProfessionalVoicemailGreeting(displayName)
}

/** Speak greeting, brief pause, then start recording (shared TeXML shape). */
export function appendVoicemailRecordTexml(
  texml: InstanceType<typeof VoiceResponse>,
  params: {
    greetingText: string
    appUrl: string
    userId: string
    callSid: string
  }
): void {
  texmlSayNatural(texml, params.greetingText)
  texml.pause({ length: 1 })
  texml.record({
    maxLength: 120,
    recordingStatusCallback: `${params.appUrl}/api/voice/telnyx/recording-status`,
    action: `${params.appUrl}/api/voice/telnyx/voicemail-complete?userId=${params.userId}&callSid=${params.callSid}`,
  })
}
