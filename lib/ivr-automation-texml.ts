// Shared TeXML builder for presence / holiday automation Gather (+ bypass length + voice).

import type { AccountPresence } from "@/lib/account-presence"
import { resolvePresenceAutomationGreeting } from "@/lib/account-presence"
import {
  IVR_BYPASS_DIAL_E164,
  resolveAutomationGatherNumDigits,
  resolveHolidayGreetingText,
  resolveIvrTexmlVoice,
} from "@/lib/ivr-automation-settings"
import {
  buildHolidayOverrideGatherXml,
  buildIvrBypassDialXml,
  buildPresenceClosedGatherXml,
  buildPresenceOnJobGatherXml,
} from "@/lib/inbound-time-capture"

export type AutomationGatherKind = "presence_closed" | "presence_on_job" | "holiday"

/** Build Gather XML for holiday override or ON_JOB / CLOSED with custom voice + bypass digits. */
export function buildAutomationPresenceGatherXml(opts: {
  kind: AutomationGatherKind
  actionUrl: string
  presence: AccountPresence
  now?: Date
}): string {
  const voice = resolveIvrTexmlVoice(opts.presence.ivrVoiceEngineModel)
  const numDigits = resolveAutomationGatherNumDigits(opts.presence.ivrBypassCode)

  // Holiday window wins over ON_JOB / CLOSED scripts when active.
  const holidayText = resolveHolidayGreetingText(
    {
      holidayOverrideStart: opts.presence.holidayOverrideStart,
      holidayOverrideEnd: opts.presence.holidayOverrideEnd,
      holidayGreetingText: opts.presence.holidayGreetingText,
    },
    opts.now ?? new Date()
  )
  if (holidayText || opts.kind === "holiday") {
    return buildHolidayOverrideGatherXml(
      opts.actionUrl,
      holidayText || opts.presence.holidayGreetingText || opts.presence.closedGreetingText,
      voice,
      numDigits
    )
  }

  if (opts.kind === "presence_on_job") {
    const say = resolvePresenceAutomationGreeting({
      presenceStatus: "ON_JOB",
      onJobGreetingText: opts.presence.onJobGreetingText,
    })
    return buildPresenceOnJobGatherXml(opts.actionUrl, say, voice, numDigits)
  }

  const say = resolvePresenceAutomationGreeting({
    presenceStatus: "CLOSED",
    closedGreetingText: opts.presence.closedGreetingText,
  })
  return buildPresenceClosedGatherXml(opts.actionUrl, say, voice, numDigits)
}

/** Force-dial owner cell when secret bypass DTMF matches. */
export function buildAutomationBypassDialXml(opts?: {
  callerId?: string | null
  ringE164?: string | null
}): string {
  return buildIvrBypassDialXml({
    ringE164: (opts?.ringE164 && opts.ringE164.trim()) || IVR_BYPASS_DIAL_E164,
    callerId: opts?.callerId ?? null,
    timeoutSeconds: 45,
  })
}
