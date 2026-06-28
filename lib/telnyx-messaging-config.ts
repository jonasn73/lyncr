// Telnyx messaging profile + assign purchased numbers for outbound SMS lead alerts.

import { normalizePhoneNumberE164 } from "@/lib/db"
import { getPlatform10DlcCampaignId, isUsLocalDid } from "@/lib/telnyx-shared-campaign"
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

type MessagingProfileRow = {
  id?: string
  name?: string
  whitelisted_destinations?: string[] | null
}

function messagingProfileWebhookUrl(): string {
  return `${getAppUrl().replace(/\/$/, "")}/api/webhooks/telnyx/messaging`
}

function telnyxErrorMessage(body: unknown, fallback: string): string {
  const errors = (body as { errors?: { detail?: string; title?: string }[] })?.errors
  return errors?.[0]?.detail || errors?.[0]?.title || fallback
}

/** ISO country codes allowed for outbound SMS (Telnyx requires this on every profile). */
export function messagingWhitelistedDestinations(): string[] {
  const raw = process.env.TELNYX_MESSAGING_WHITELIST?.trim()
  if (raw) {
    return raw
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)
  }
  return ["US", "CA"]
}

/** Optional explicit profile id from Vercel — skips list/create. */
export function getConfiguredMessagingProfileId(): string | null {
  return process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || null
}

/** PATCH whitelisted_destinations onto a profile (required by Telnyx since 2024). */
export async function ensureMessagingProfileWhitelisted(profileId: string): Promise<void> {
  getTelnyxApiKey()
  const destinations = messagingWhitelistedDestinations()
  const patchRes = await fetch(`${TELNYX_BASE}/messaging_profiles/${profileId}`, {
    method: "PATCH",
    headers: telnyxHeaders(),
    body: JSON.stringify({ whitelisted_destinations: destinations }),
  })
  if (patchRes.ok) {
    console.log(`[Telnyx] Messaging profile ${profileId} destinations → ${destinations.join(", ")}`)
    return
  }
  const patchBody = await patchRes.json().catch(() => ({}))
  throw new Error(
    telnyxErrorMessage(patchBody, "Could not set whitelisted destinations on messaging profile")
  )
}

/** Find or create the platform SMS messaging profile. */
export async function getOrCreateMessagingProfile(): Promise<string> {
  const configured = getConfiguredMessagingProfileId()
  if (configured) {
    await ensureMessagingProfileWhitelisted(configured)
    return configured
  }

  getTelnyxApiKey()

  const listRes = await fetch(`${TELNYX_BASE}/messaging_profiles?page[size]=50`, {
    headers: telnyxHeaders(),
  })
  const listBody = (await listRes.json().catch(() => ({}))) as {
    data?: MessagingProfileRow[]
  }
  const profiles = listBody.data ?? []
  const existing = profiles.find((p) =>
    MESSAGING_PROFILE_NAMES.includes(p.name as (typeof MESSAGING_PROFILE_NAMES)[number])
  )
  const chosen = existing ?? profiles[0]
  if (chosen?.id) {
    const profileId = String(chosen.id)
    await ensureMessagingProfileWhitelisted(profileId)
    return profileId
  }

  const createRes = await fetch(`${TELNYX_BASE}/messaging_profiles`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      name: `${SITE_NAME} SMS`,
      webhook_url: messagingProfileWebhookUrl(),
      webhook_api_version: "2",
      enabled: true,
      whitelisted_destinations: messagingWhitelistedDestinations(),
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

/** Phone numbers already assigned to the platform messaging profile (SMS-ready). */
export async function listMessagingProfilePhoneNumbers(): Promise<string[]> {
  try {
    getTelnyxApiKey()
    const profileId = await getOrCreateMessagingProfile()
    const res = await fetch(
      `${TELNYX_BASE}/messaging_profiles/${profileId}/phone_numbers?page[size]=50`,
      { headers: telnyxHeaders() }
    )
    const body = (await res.json().catch(() => ({}))) as {
      data?: { phone_number?: string; number?: string }[]
    }
    if (!res.ok) return []
    return (body.data ?? [])
      .map((row) => normalizePhoneNumberE164(String(row.phone_number ?? row.number ?? "")))
      .filter(Boolean)
  } catch {
    return []
  }
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

export type Telnyx10DlcStatus = {
  assigned: boolean
  campaign_id: string | null
  detail: string | null
}

/** US local numbers need a 10DLC campaign or carriers silently drop SMS after API accept. */
export async function getTelnyx10DlcAssignmentStatus(e164: string): Promise<Telnyx10DlcStatus> {
  const target = normalizePhoneNumberE164(e164.trim())
  if (!target.startsWith("+1") || target.length < 12) {
    return { assigned: true, campaign_id: null, detail: null }
  }

  const platformCampaignId = getPlatform10DlcCampaignId()
  if (platformCampaignId && isUsLocalDid(target)) {
    return { assigned: true, campaign_id: platformCampaignId, detail: null }
  }

  try {
    getTelnyxApiKey()
  } catch {
    return { assigned: false, campaign_id: null, detail: "TELNYX_API_KEY missing" }
  }

  const res = await fetch(
    `${TELNYX_BASE}/10dlc/phoneNumberCampaign?phoneNumber=${encodeURIComponent(target)}`,
    { headers: telnyxHeaders() }
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      assigned: false,
      campaign_id: null,
      detail:
        "10DLC campaign not assigned — in Telnyx Mission Control go to Messaging → 10DLC, register a brand + campaign, then assign your business line.",
    }
  }

  const data = (body as { data?: Record<string, unknown> }).data ?? {}
  const campaignId =
    (data.campaignId as string | undefined) ||
    (data.campaign_id as string | undefined) ||
    (data.campaign as { id?: string } | undefined)?.id ||
    null

  if (campaignId) {
    return { assigned: true, campaign_id: String(campaignId), detail: null }
  }

  return {
    assigned: false,
    campaign_id: null,
    detail:
      "10DLC campaign not assigned — Telnyx accepted the API request but US carriers block delivery until you assign +15025758166 to an approved 10DLC campaign.",
  }
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
