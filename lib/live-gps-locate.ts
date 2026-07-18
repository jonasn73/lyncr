// Live GPS locate tokens — SMS link lyncr.app/locate?c=[id] → customer shares coords → Pusher into intake.

import { randomBytes } from "crypto"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAppUrl } from "@/lib/telnyx"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

export type LiveGpsTokenRow = {
  id: string
  owner_user_id: string
  call_log_id: string | null
  customer_phone: string | null
  status: string
  expires_at: string
}

function sql() {
  return neon(resolveNeonDatabaseUrl())
}

/** Opaque short id for SMS links. */
export function createLiveGpsTokenId(): string {
  return randomBytes(12).toString("base64url")
}

export function buildLocateUrl(tokenId: string): string {
  const base = getAppUrl().replace(/\/+$/, "")
  return `${base}/locate?c=${encodeURIComponent(tokenId)}`
}

/**
 * Customer-facing SMS link. Uses /track-location?jobId=…&c=… (token `c` is required for security).
 * `jobId` is optional display/context (call log or lead id).
 */
export function buildTrackLocationUrl(tokenId: string, jobId?: string | null): string {
  const base = getAppUrl().replace(/\/+$/, "")
  const params = new URLSearchParams()
  const job = jobId?.trim()
  if (job) params.set("jobId", job)
  params.set("c", tokenId)
  return `${base}/track-location?${params.toString()}`
}

/** SMS body for Request Live GPS. */
export function buildLiveGpsRequestSmsText(trackUrl: string): string {
  return `Lyncr: Your locksmith is requesting your live location to find your vehicle. Please tap the secure link to share your GPS coordinates: ${trackUrl}`
}

export async function createLiveGpsLocateToken(params: {
  ownerUserId: string
  callLogId?: string | null
  customerPhone?: string | null
}): Promise<{ id: string; url: string } | null> {
  const id = createLiveGpsTokenId()
  try {
    await sql()`
      INSERT INTO live_gps_locate_tokens (id, owner_user_id, call_log_id, customer_phone)
      VALUES (
        ${id},
        ${params.ownerUserId},
        ${params.callLogId ?? null},
        ${params.customerPhone ?? null}
      )
    `
    return { id, url: buildLocateUrl(id) }
  } catch (e) {
    console.warn("[live-gps] create token failed:", e)
    return null
  }
}

export async function getLiveGpsLocateToken(id: string): Promise<LiveGpsTokenRow | null> {
  try {
    const rows = await sql()`
      SELECT id, owner_user_id, call_log_id, customer_phone, status, expires_at::text AS expires_at
      FROM live_gps_locate_tokens
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      call_log_id: row.call_log_id != null ? String(row.call_log_id) : null,
      customer_phone: row.customer_phone != null ? String(row.customer_phone) : null,
      status: String(row.status),
      expires_at: String(row.expires_at),
    }
  } catch (e) {
    console.warn("[live-gps] get token failed:", e)
    return null
  }
}

/** Persist shared coords and push into the owner's live intake channel. */
export async function completeLiveGpsLocate(params: {
  tokenId: string
  latitude: number
  longitude: number
  formattedAddress?: string | null
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = await getLiveGpsLocateToken(params.tokenId)
  if (!token) return { ok: false, reason: "not-found" }
  if (token.status === "expired") return { ok: false, reason: "expired" }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    try {
      await sql()`
        UPDATE live_gps_locate_tokens SET status = 'expired' WHERE id = ${params.tokenId}
      `
    } catch {
      /* ignore */
    }
    return { ok: false, reason: "expired" }
  }

  const formatted =
    params.formattedAddress?.trim() ||
    `${params.latitude.toFixed(6)}, ${params.longitude.toFixed(6)}`

  try {
    await sql()`
      UPDATE live_gps_locate_tokens
      SET
        latitude = ${params.latitude},
        longitude = ${params.longitude},
        formatted_address = ${formatted},
        status = 'shared',
        shared_at = now()
      WHERE id = ${params.tokenId}
    `
  } catch (e) {
    console.warn("[live-gps] complete update failed:", e)
    return { ok: false, reason: "db-error" }
  }

  await publishOwnerEvent(token.owner_user_id, "live-gps", {
    token_id: params.tokenId,
    call_log_id: token.call_log_id,
    latitude: params.latitude,
    longitude: params.longitude,
    formatted_address: formatted,
  })

  return { ok: true }
}
