// Platform-level outbound SMS sender (admin operator invites, legacy admin SMS invites).
// Never use the logged-in admin user's lines — they may not be on the Telnyx messaging profile.

import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { listProviderLinkedActiveNumbers, normalizePhoneNumberE164 } from "@/lib/db"
import {
  configureNumberMessaging,
  isTelnyxOwnedNumber,
  listMessagingProfilePhoneNumbers,
} from "@/lib/telnyx-messaging-config"

export type PlatformSmsSenderResult =
  | { ok: true; from_e164: string }
  | { ok: false; message: string }

/** Ordered Telnyx lines to try for platform SMS (profile-ready lines first). */
export async function listPlatformSmsFromCandidates(): Promise<string[]> {
  const candidates: string[] = []

  for (const number of await listMessagingProfilePhoneNumbers()) {
    if (!candidates.includes(number)) candidates.push(number)
  }

  const envFrom = process.env.TELNYX_MESSAGING_FROM_E164?.trim()
  if (envFrom) {
    const normalized = normalizePhoneNumberE164(envFrom)
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }

  for (const number of await listProviderLinkedActiveNumbers()) {
    const normalized = normalizePhoneNumberE164(number)
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }

  return candidates
}

/** Pick the first Telnyx line that can send platform SMS. */
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
    return {
      ok: false,
      message: formatPlatformSmsFailure(failures[0]),
    }
  }

  return {
    ok: false,
    message:
      "No Telnyx SMS line is configured yet. Buy a business line in Lyncr or run Repair SMS under Admin → Dev sandbox.",
  }
}

/** Plain-language SMS failure for admin operator invites. */
export function formatPlatformSmsFailure(raw: string | undefined): string {
  if (!raw?.trim()) {
    return "Automatic texts aren't available right now. Copy the setup link and send it manually."
  }
  const blob = raw.toLowerCase()
  if (
    blob.includes("could not enable messaging") ||
    blob.includes("messaging profile") ||
    blob.includes("40305") ||
    blob.includes("invalid 'from'")
  ) {
    return "Automatic texts aren't set up on your business line yet. Copy the setup link below, or run Repair SMS under Admin → Dev sandbox."
  }
  if (blob.includes("10dlc")) {
    return "US carrier registration (10DLC) is still pending. Copy the setup link below for now."
  }
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw
}
