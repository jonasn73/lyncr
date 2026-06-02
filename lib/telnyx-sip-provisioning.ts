// ============================================
// Telnyx SIP provisioning (per-receptionist WebRTC credentials)
// ============================================
// Fully automated, in-app SIP provisioning so users never leave lyncr.app:
//   1. Each agent gets their OWN Telnyx Telephony Credential, created programmatically with the
//      master TELNYX_API_KEY under a shared Credential Connection (TELNYX_CREDENTIAL_CONNECTION_ID).
//      Telnyx randomly generates a unique sip_username (starts "gencred…") + sip_password for it.
//   2. We store the returned credential **id** + **sip_username** on the receptionist row.
//   3. The browser mints a short-lived (24h) WebRTC login JWT from that credential id on demand.
//
// One-time setup (no code): in the Telnyx portal create a SIP Connection of type "Credentials",
// copy its Connection ID, and set TELNYX_CREDENTIAL_CONNECTION_ID. Without it, provisioning is
// skipped and WEB routing safely falls back to CELL (PSTN) — calls are never dropped.

const TELNYX_API_BASE = "https://api.telnyx.com/v2"

/** Master Telnyx REST key (numbers, credentials, tokens). */
export function readTelnyxApiKey(): string | null {
  return process.env.TELNYX_API_KEY?.trim() || null
}

/** The Credential Connection every per-agent telephony credential is created under. */
export function readTelnyxCredentialConnectionId(): string | null {
  return process.env.TELNYX_CREDENTIAL_CONNECTION_ID?.trim() || null
}

/** Legacy single shared credential id (interim setup) used as a fallback when no per-agent id exists. */
export function readTelnyxSharedCredentialId(): string | null {
  return process.env.TELNYX_WEBRTC_CREDENTIAL_ID?.trim() || null
}

export type SipProvisionResult =
  | { status: "provisioned"; credentialId: string; sipUsername: string }
  | { status: "skipped"; reason: string }

/**
 * Create a brand-new Telnyx Telephony Credential for one agent.
 * Telnyx auto-generates a unique sip_username + sip_password; we only persist the id + username
 * (the password is never needed for the JWT/WebRTC flow, so we don't store the secret).
 */
export async function provisionTelnyxSipCredential(params: { label: string }): Promise<SipProvisionResult> {
  const apiKey = readTelnyxApiKey()
  const connectionId = readTelnyxCredentialConnectionId()
  if (!apiKey) return { status: "skipped", reason: "TELNYX_API_KEY not set" }
  if (!connectionId) return { status: "skipped", reason: "TELNYX_CREDENTIAL_CONNECTION_ID not set" }

  try {
    const res = await fetch(`${TELNYX_API_BASE}/telephony_credentials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        connection_id: connectionId,
        name: params.label.slice(0, 100),
        tag: "lyncr-receptionist",
      }),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200)
      return { status: "skipped", reason: `telnyx create ${res.status}${detail ? `: ${detail}` : ""}` }
    }
    const json = (await res.json()) as { data?: { id?: string; sip_username?: string } }
    const credentialId = json.data?.id?.trim()
    const sipUsername = json.data?.sip_username?.trim()
    if (!credentialId || !sipUsername) {
      return { status: "skipped", reason: "telnyx response missing id/sip_username" }
    }
    return { status: "provisioned", credentialId, sipUsername }
  } catch (e) {
    return { status: "skipped", reason: e instanceof Error ? e.message : "provision error" }
  }
}

/** Mint a short-lived WebRTC login JWT from a credential id. Returns the raw token (or null). */
export async function mintTelnyxSipToken(credentialId: string): Promise<string | null> {
  const apiKey = readTelnyxApiKey()
  if (!apiKey || !credentialId) return null
  try {
    const res = await fetch(`${TELNYX_API_BASE}/telephony_credentials/${encodeURIComponent(credentialId)}/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    const token = (await res.text()).trim()
    return token || null
  } catch {
    return null
  }
}

/** Best-effort delete of a Telnyx telephony credential (e.g. when an agent is removed). */
export async function deleteTelnyxSipCredential(credentialId: string): Promise<void> {
  const apiKey = readTelnyxApiKey()
  if (!apiKey || !credentialId) return
  try {
    await fetch(`${TELNYX_API_BASE}/telephony_credentials/${encodeURIComponent(credentialId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    })
  } catch {
    /* best-effort cleanup — a dangling credential is harmless */
  }
}
