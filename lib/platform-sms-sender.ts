// Platform-level outbound SMS sender (admin operator invites, legacy admin SMS invites).
// Never use the logged-in admin user's lines — they may not be on the Telnyx messaging profile.

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { listProviderLinkedActiveNumbers, normalizePhoneNumberE164 } from "@/lib/db"
import {
  configureNumberMessaging,
  isTelnyxOwnedNumber,
} from "@/lib/telnyx-messaging-config"

export type PlatformSmsSenderResult =
  | { ok: true; from_e164: string }
  | { ok: false; message: string }

/** Ordered Telnyx lines to try for platform SMS (env override first, then Neon lines). */
export async function listPlatformSmsFromCandidates(): Promise<string[]> {
  const candidates: string[] = []

  const envFrom = process.env.TELNYX_MESSAGING_FROM_E164?.trim()
  if (envFrom) candidates.push(normalizePhoneNumberE164(envFrom))

  for (const number of await listProviderLinkedActiveNumbers()) {
    const normalized = normalizePhoneNumberE164(number)
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }

  return candidates
}

/** Pick the first Telnyx line that is on the account AND on the messaging profile. */
export async function resolvePlatformSmsFromE164(): Promise<PlatformSmsSenderResult> {
  const candidates = await listPlatformSmsFromCandidates()
  const failures: string[] = []

  for (const from of candidates) {
    if (!(await isTelnyxOwnedNumber(from))) {
      failures.push(`${formatPhoneDisplay(from)} is not on your Telnyx account`)
      continue
    }
    try {
      await configureNumberMessaging(from)
      return { ok: true, from_e164: from }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`${formatPhoneDisplay(from)}: ${msg}`)
      console.warn("[platform-sms] skip candidate:", from, msg)
    }
  }

  if (candidates.length > 0) {
    const detail = failures[0] ?? "Could not attach any line to the Telnyx messaging profile"
    return {
      ok: false,
      message: `${detail}. Open Admin → Dev sandbox and click Repair SMS, or set TELNYX_MESSAGING_FROM_E164 to a line that supports SMS (e.g. +15025758166).`,
    }
  }

  return {
    ok: false,
    message:
      "No Telnyx SMS line is configured yet. Buy a business line in Lyncr or run Repair SMS under Admin → Dev sandbox.",
  }
}
