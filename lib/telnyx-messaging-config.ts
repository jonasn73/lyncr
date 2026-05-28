// Telnyx messaging profile + assign purchased numbers for outbound SMS lead alerts.

import { normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { SITE_NAME } from "@/lib/brand"
import { findTelnyxPhoneNumberId, getTelnyxApiKey, telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

const MESSAGING_PROFILE_NAMES = [
  `${SITE_NAME} SMS`,
  "Lyncr SMS",
  "Zing SMS",
  "HeySigo SMS",
] as const

function messagingProfileWebhookUrl(): string {
  return `${getAppUrl().replace(/\/$/, "")}/api/webhooks/telnyx/messaging`
}

function telnyxErrorMessage(body: unknown, fallback: string): string {
  const errors = (body as { errors?: { detail?: string; title?: string }[] })?.errors
  return errors?.[0]?.detail || errors?.[0]?.title || fallback
}

/** Optional explicit profile id from Vercel — skips list/create. */
export function getConfiguredMessagingProfileId(): string | null {
  return process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || null
}

/** Find or create the platform SMS messaging profile. */
export async function getOrCreateMessagingProfile(): Promise<string> {
  const configured = getConfiguredMessagingProfileId()
  if (configured) return configured

  getTelnyxApiKey()

  const listRes = await fetch(`${TELNYX_BASE}/messaging_profiles?page[size]=50`, {
    headers: telnyxHeaders(),
  })
  const listBody = (await listRes.json().catch(() => ({}))) as {
    data?: { id?: string; name?: string }[]
  }
  const profiles = listBody.data ?? []
  const existing = profiles.find((p) =>
    MESSAGING_PROFILE_NAMES.includes(p.name as (typeof MESSAGING_PROFILE_NAMES)[number])
  )
  if (existing?.id) return String(existing.id)
  if (profiles[0]?.id) return String(profiles[0].id)

  const createRes = await fetch(`${TELNYX_BASE}/messaging_profiles`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      name: `${SITE_NAME} SMS`,
      webhook_url: messagingProfileWebhookUrl(),
      webhook_api_version: "2",
      enabled: true,
    }),
  })
  const createBody = await createRes.json().catch(() => ({}))
  const profileId = (createBody as { data?: { id?: string } })?.data?.id
  if (!profileId) {
    throw new Error(telnyxErrorMessage(createBody, "Could not create Telnyx messaging profile"))
  }
  console.log(`[Telnyx] Created messaging profile ${profileId}`)
  return String(profileId)
}

/** Assign one E.164 line to the platform messaging profile (idempotent). */
export async function configureNumberMessaging(phoneNumberE164: string): Promise<void> {
  const target = normalizePhoneNumberE164(phoneNumberE164.trim())
  if (!target) return

  getTelnyxApiKey()
  const profileId = await getOrCreateMessagingProfile()
  const telnyxId = await findTelnyxPhoneNumberId(target)
  if (!telnyxId) {
    throw new Error(
      `${target} is not on your Telnyx account — remove bad TELNYX_MESSAGING_FROM_E164 in Vercel or buy the number first`
    )
  }

  const bulkRes = await fetch(`${TELNYX_BASE}/messaging_numbers/bulk_updates`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      messaging_profile_id: profileId,
      numbers: [target],
    }),
  })
  if (bulkRes.ok) {
    console.log(`[Telnyx] Messaging profile ${profileId} bulk-assigned to ${target}`)
    return
  }

  const assignRes = await fetch(`${TELNYX_BASE}/messaging_profiles/${profileId}/phone_numbers`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({ phone_number_id: telnyxId }),
  })
  if (assignRes.ok) {
    console.log(`[Telnyx] Messaging profile ${profileId} assigned to ${target}`)
    return
  }

  const patchRes = await fetch(`${TELNYX_BASE}/phone_numbers/${telnyxId}/messaging`, {
    method: "PATCH",
    headers: telnyxHeaders(),
    body: JSON.stringify({ messaging_profile_id: profileId }),
  })
  if (patchRes.ok) {
    console.log(`[Telnyx] Messaging profile ${profileId} patched onto ${target}`)
    return
  }

  const bulkBody = await bulkRes.json().catch(() => ({}))
  const assignBody = await assignRes.json().catch(() => ({}))
  const patchBody = await patchRes.json().catch(() => ({}))
  throw new Error(
    `Could not assign ${target} to messaging profile: ${telnyxErrorMessage(
      patchBody,
      telnyxErrorMessage(assignBody, telnyxErrorMessage(bulkBody, `HTTP ${patchRes.status}`))
    )}`
  )
}

/** True when this E.164 exists on the linked Telnyx account. */
export async function isTelnyxOwnedNumber(e164: string): Promise<boolean> {
  try {
    getTelnyxApiKey()
  } catch {
    return false
  }
  const id = await findTelnyxPhoneNumberId(normalizePhoneNumberE164(e164.trim()))
  return Boolean(id)
}

/** Assign every purchased Telnyx line we know about (best-effort). */
export async function ensureProviderNumbersMessagingReady(numbers: string[]): Promise<string[]> {
  const warnings: string[] = []
  const unique = [...new Set(numbers.map((n) => normalizePhoneNumberE164(n.trim())).filter(Boolean))]
  for (const number of unique) {
    try {
      await configureNumberMessaging(number)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`${number}: ${msg}`)
    }
  }
  return warnings
}
