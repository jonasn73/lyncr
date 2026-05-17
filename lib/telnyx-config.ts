// ============================================
// Telnyx Configuration Helpers
// ============================================
// Shared functions for setting up TeXML apps, outbound voice profiles,
// and configuring phone numbers. Used by buy, configure, and porting routes.

import { getAppUrl } from "@/lib/telnyx"
import { SITE_NAME } from "@/lib/brand"

const TELNYX_BASE = "https://api.telnyx.com/v2"

/** Telnyx TeXML app friendly names: newest uses SITE_NAME; legacy names kept for existing Telnyx apps. */
const TEXML_ROUTER_FRIENDLY_NAME = `${SITE_NAME} Call Router` as const
export const TEXML_ROUTER_NAMES = [
  TEXML_ROUTER_FRIENDLY_NAME,
  "HeySigo Call Router",
  "Hey Sigo Call Router",
  "Sigo Call Router",
  "Zing Call Router",
] as const

/** Outbound voice profile names for the same reason. */
const OUTBOUND_VOICE_PROFILE_NAME = `${SITE_NAME} Outbound` as const
const OUTBOUND_PROFILE_NAMES = [
  OUTBOUND_VOICE_PROFILE_NAME,
  "HeySigo Outbound",
  "Hey Sigo Outbound",
  "Sigo Outbound",
  "Zing Outbound",
] as const

export function getTelnyxApiKey(): string {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error("Missing TELNYX_API_KEY")
  return key
}

export function telnyxHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getTelnyxApiKey()}`,
    "Content-Type": "application/json",
  }
}

/** @deprecated Use getAppUrl from @/lib/telnyx — kept for any external imports. */
export function getZingAppUrl(): string {
  return getAppUrl()
}

// Find or create an outbound voice profile so the TeXML app can place outbound calls
async function getOrCreateOutboundVoiceProfile(): Promise<string> {
  const listRes = await fetch(`${TELNYX_BASE}/outbound_voice_profiles?page[size]=50`, {
    headers: telnyxHeaders(),
  })
  const listBody = await listRes.json()
  const profiles = listBody?.data || []

  const existing = profiles.find((p: Record<string, unknown>) =>
    OUTBOUND_PROFILE_NAMES.includes(p.name as (typeof OUTBOUND_PROFILE_NAMES)[number])
  )
  if (existing?.id) {
    return String(existing.id)
  }

  if (profiles.length > 0 && profiles[0]?.id) {
    return String(profiles[0].id)
  }

  const createRes = await fetch(`${TELNYX_BASE}/outbound_voice_profiles`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      name: OUTBOUND_VOICE_PROFILE_NAME,
      traffic_type: "conversational",
      whitelisted_destinations: ["US", "CA"],
    }),
  })
  const createBody = await createRes.json()
  const profileId = createBody?.data?.id
  if (!profileId) {
    console.error("[Sigo] Failed to create outbound voice profile:", createBody)
    throw new Error("Failed to create outbound voice profile")
  }
  console.log(`[Sigo] Created outbound voice profile: ${profileId}`)
  return String(profileId)
}

// Find or create the lyncr Call Router TeXML application with outbound calling enabled
export async function getOrCreateTexmlApp(): Promise<string> {
  const appUrl = getAppUrl()

  const listRes = await fetch(`${TELNYX_BASE}/texml_applications?page[size]=50`, {
    headers: telnyxHeaders(),
  })
  const listBody = await listRes.json()
  const apps = listBody?.data || []
  const existing = apps.find((a: Record<string, string>) =>
    TEXML_ROUTER_NAMES.includes(a.friendly_name as (typeof TEXML_ROUTER_NAMES)[number])
  )

  if (existing?.id) {
    const currentProfileId = existing.outbound?.outbound_voice_profile_id
    if (!currentProfileId) {
      try {
        const profileId = await getOrCreateOutboundVoiceProfile()
        const patchRes = await fetch(`${TELNYX_BASE}/texml_applications/${existing.id}`, {
          method: "PATCH",
          headers: telnyxHeaders(),
          body: JSON.stringify({
            outbound: { outbound_voice_profile_id: profileId },
          }),
        })
        const patchBody = await patchRes.json().catch(() => ({}))
        if (patchRes.ok) {
          console.log(`[Sigo] Assigned outbound voice profile ${profileId} to TeXML app ${existing.id}`)
        } else {
          console.error(`[Sigo] Failed to PATCH outbound profile:`, patchBody)
        }
      } catch (err) {
        console.error("[Sigo] Failed to assign outbound voice profile:", err)
      }
    }
    return String(existing.id)
  }

  const profileId = await getOrCreateOutboundVoiceProfile()

  const createRes = await fetch(`${TELNYX_BASE}/texml_applications`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      friendly_name: TEXML_ROUTER_FRIENDLY_NAME,
      voice_url: `${appUrl}/api/voice/telnyx/incoming`,
      voice_method: "POST",
      voice_fallback_url: `${appUrl}/api/voice/telnyx/incoming`,
      status_callback_url: `${appUrl}/api/voice/telnyx/status`,
      status_callback_method: "POST",
      outbound: { outbound_voice_profile_id: profileId },
    }),
  })
  const createBody = await createRes.json()
  if (!createRes.ok) {
    const errMsg = createBody?.errors?.[0]?.detail || JSON.stringify(createBody)
    throw new Error(`Failed to create TeXML app: ${errMsg}`)
  }
  const appId = createBody?.data?.id
  if (!appId) throw new Error("TeXML app created but no ID returned")
  console.log(`[Sigo] Created TeXML application ${appId} with outbound profile ${profileId}`)
  return String(appId)
}

// Assign a phone number to our TeXML application so incoming calls route to our webhook
export async function configureNumberVoice(phoneNumber: string, texmlAppId: string): Promise<void> {
  const searchRes = await fetch(
    `${TELNYX_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}&page[size]=1`,
    { headers: telnyxHeaders() }
  )
  const searchBody = await searchRes.json()
  const numberRecord = searchBody?.data?.[0]
  if (!numberRecord?.id) {
    console.error(`[Sigo] Could not find Telnyx record for ${phoneNumber}`)
    return
  }

  const patchRes = await fetch(`${TELNYX_BASE}/phone_numbers/${numberRecord.id}/voice`, {
    method: "PATCH",
    headers: telnyxHeaders(),
    body: JSON.stringify({ connection_id: texmlAppId, tech_prefix_enabled: false }),
  })
  if (!patchRes.ok) {
    const patchBody = await patchRes.json().catch(() => ({}))
    console.error(`[Sigo] Failed to configure voice for ${phoneNumber}:`, patchBody)
  } else {
    console.log(`[Sigo] Voice configured for ${phoneNumber} → TeXML app ${texmlAppId}`)
  }
}
