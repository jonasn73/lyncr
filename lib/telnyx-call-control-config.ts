// Telnyx Voice API (Call Control) application — instant answer before greeting/dial.

import { getAppUrl } from "@/lib/telnyx"
import { SITE_NAME } from "@/lib/brand"
import { telnyxHeaders } from "@/lib/telnyx-config"

const TELNYX_BASE = "https://api.telnyx.com/v2"

const CALL_CONTROL_APP_NAMES = [
  `${SITE_NAME} Voice API`,
  "Lyncr Voice API",
  "HeySigo Voice API",
  "Zing Voice API",
] as const

export function getInboundCallControlWebhookUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/webhooks/telnyx/voice`
}

/** Resolve Voice API application id for inbound Call Control (env override or Telnyx lookup). */
export async function getOrCreateCallControlApp(): Promise<string> {
  const fromEnv =
    process.env.TELNYX_CALL_CONTROL_CONNECTION_ID?.trim() ||
    process.env.TELNYX_VOICE_API_APPLICATION_ID?.trim() ||
    ""
  if (fromEnv) return fromEnv

  const appUrl = getAppUrl()
  const webhookUrl = getInboundCallControlWebhookUrl(appUrl)

  const listRes = await fetch(`${TELNYX_BASE}/call_control_applications?page[size]=50`, {
    headers: telnyxHeaders(),
  })
  const listBody = await listRes.json()
  const apps = (listBody?.data || []) as Array<Record<string, string>>
  const existing = apps.find((a) =>
    CALL_CONTROL_APP_NAMES.includes(a.application_name as (typeof CALL_CONTROL_APP_NAMES)[number])
  )

  if (existing?.id) {
    await patchCallControlAppWebhook(String(existing.id), webhookUrl)
    return String(existing.id)
  }

  const createRes = await fetch(`${TELNYX_BASE}/call_control_applications`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      application_name: `${SITE_NAME} Voice API`,
      webhook_event_url: webhookUrl,
      webhook_api_version: "2",
      active: true,
      first_command_timeout: true,
      first_command_timeout_secs: 30,
    }),
  })
  const createBody = await createRes.json()
  const appId = createBody?.data?.id
  if (!appId) {
    const errMsg = createBody?.errors?.[0]?.detail || JSON.stringify(createBody)
    throw new Error(`Failed to create Call Control app: ${errMsg}`)
  }
  console.log(`[Sigo] Created Call Control application ${appId} → ${webhookUrl}`)
  return String(appId)
}

async function patchCallControlAppWebhook(appId: string, webhookUrl: string): Promise<void> {
  try {
    const res = await fetch(`${TELNYX_BASE}/call_control_applications/${appId}`, {
      method: "PATCH",
      headers: telnyxHeaders(),
      body: JSON.stringify({
        webhook_event_url: webhookUrl,
        webhook_api_version: "2",
        active: true,
      }),
    })
    if (res.ok) {
      console.log(`[Sigo] Call Control app ${appId} webhook → ${webhookUrl}`)
    } else {
      const body = await res.json().catch(() => ({}))
      console.error(`[Sigo] Failed to PATCH Call Control webhook:`, body)
    }
  } catch (e) {
    console.error("[Sigo] PATCH Call Control webhook failed:", e)
  }
}
