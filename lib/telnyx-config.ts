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

/** Preferred alias — same as getAppUrl. */
export function getLyncrAppUrl(): string {
  return getAppUrl()
}

/** @deprecated Use getLyncrAppUrl / getAppUrl — kept for any external imports. */
export function getZingAppUrl(): string {
  return getAppUrl()
}

// Find or create an outbound voice profile so voice apps can place outbound calls.
export async function getOrCreateOutboundVoiceProfile(): Promise<string> {
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
    console.error("[lyncr] Failed to create outbound voice profile:", createBody)
    throw new Error("Failed to create outbound voice profile")
  }
  console.log(`[lyncr] Created outbound voice profile: ${profileId}`)
  return String(profileId)
}

/** Telnyx pass-2 routing webhook (`lyncrGreet=1` after instant edge greet). */
export function getInboundTexmlVoiceUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/voice/telnyx/incoming`
}

/** Pass 1 — Edge `/greet` answers instantly (no Node cold-start ringback). */
export function getInboundTexmlGreetVoiceUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/voice/telnyx/greet`
}

/** Pass-2 routing after greeting (`lyncrGreet=1`). */
export function getInboundTexmlRoutingVoiceUrl(appUrl: string): string {
  return getInboundTexmlVoiceUrl(appUrl)
}

async function ensureTexmlAppVoiceUrls(appId: string, appUrl: string): Promise<void> {
  const greetUrl = getInboundTexmlGreetVoiceUrl(appUrl)
  const routingUrl = getInboundTexmlVoiceUrl(appUrl)
  try {
    const patchRes = await fetch(`${TELNYX_BASE}/texml_applications/${appId}`, {
      method: "PATCH",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        voice_url: greetUrl,
        voice_method: "GET",
        voice_fallback_url: routingUrl,
      }),
    })
    const patchBody = await patchRes.json().catch(() => ({}))
    if (patchRes.ok) {
      console.log(`[lyncr] TeXML app ${appId} voice_url → ${greetUrl} (fallback → ${routingUrl})`)
    } else {
      console.error(`[lyncr] Failed to PATCH TeXML voice_url:`, patchBody)
    }
  } catch (err) {
    console.error("[lyncr] Failed to PATCH TeXML voice_url:", err)
  }
}

// Find or create the lyncr Call Router TeXML application with outbound calling enabled
export async function getOrCreateTexmlApp(): Promise<string> {
  const appUrl = getAppUrl()
  const greetUrl = getInboundTexmlGreetVoiceUrl(appUrl)
  const routingUrl = getInboundTexmlVoiceUrl(appUrl)

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
          console.log(`[lyncr] Assigned outbound voice profile ${profileId} to TeXML app ${existing.id}`)
        } else {
          console.error(`[lyncr] Failed to PATCH outbound profile:`, patchBody)
        }
      } catch (err) {
        console.error("[lyncr] Failed to assign outbound voice profile:", err)
      }
    }
    await ensureTexmlAppVoiceUrls(String(existing.id), appUrl)
    return String(existing.id)
  }

  const profileId = await getOrCreateOutboundVoiceProfile()

  const createRes = await fetch(`${TELNYX_BASE}/texml_applications`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      friendly_name: TEXML_ROUTER_FRIENDLY_NAME,
      voice_url: greetUrl,
      voice_method: "GET",
      voice_fallback_url: routingUrl,
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
  console.log(`[lyncr] Created TeXML application ${appId} with outbound profile ${profileId}`)
  return String(appId)
}

// Assign a phone number to our voice connection (TeXML or Call Control when enabled).
export async function configureNumberVoice(phoneNumber: string, texmlAppId: string): Promise<void> {
  let connectionId = texmlAppId
  try {
    const { readInboundCallControlEnabled } = await import("@/lib/telnyx-call-control-inbound")
    const { getOrCreateCallControlApp } = await import("@/lib/telnyx-call-control-config")
    if (readInboundCallControlEnabled()) {
      connectionId = await getOrCreateCallControlApp()
    }
  } catch (e) {
    console.warn("[lyncr] Call Control app resolution failed; using TeXML app:", e)
  }

  const searchRes = await fetch(
    `${TELNYX_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}&page[size]=1`,
    { headers: telnyxHeaders() }
  )
  const searchBody = await searchRes.json()
  const numberRecord = searchBody?.data?.[0]
  if (!numberRecord?.id) {
    console.error(`[lyncr] Could not find Telnyx record for ${phoneNumber}`)
    return
  }

  const patchRes = await fetch(`${TELNYX_BASE}/phone_numbers/${numberRecord.id}/voice`, {
    method: "PATCH",
    headers: telnyxHeaders(),
    body: JSON.stringify({ connection_id: connectionId, tech_prefix_enabled: false }),
  })
  if (!patchRes.ok) {
    const patchBody = await patchRes.json().catch(() => ({}))
    console.error(`[lyncr] Failed to configure voice for ${phoneNumber}:`, patchBody)
  } else {
    console.log(`[lyncr] Voice configured for ${phoneNumber} → connection ${connectionId}`)
  }
}

/** Look up Telnyx inventory record id for an E.164 DID (used for voice/messaging patches). */
export async function findTelnyxPhoneNumberId(e164: string): Promise<string | null> {
  const res = await fetch(
    `${TELNYX_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(e164.trim())}&page[size]=1`,
    { headers: telnyxHeaders() }
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return null
  const id = (body as { data?: { id?: string }[] })?.data?.[0]?.id
  return id ? String(id) : null
}
