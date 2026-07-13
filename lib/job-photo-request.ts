// Job photo request tokens — SMS /upload?t=… → customer photos → Pusher into intake.

import { randomBytes } from "crypto"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAppUrl } from "@/lib/telnyx"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

export type JobPhotoTokenRow = {
  id: string
  owner_user_id: string
  call_log_id: string | null
  customer_phone: string | null
  status: string
  /** Pending Info / Awaiting Photos wait state for delayed upload alerts. */
  ticket_status: string
  /** ISO timestamp when the operator SMS/toast alert already fired (anti-spam). */
  operator_alert_sent_at: string | null
  expires_at: string
}

export type JobPhotoMeta = {
  id: string
  token_id: string
  call_log_id: string | null
  mime_type: string
  file_name: string | null
  byte_size: number
  created_at: string
  /** Dashboard thumbnail URL (authenticated via cookie on same origin). */
  url: string
}

function sql() {
  return neon(resolveNeonDatabaseUrl())
}

export function createJobPhotoTokenId(): string {
  return randomBytes(12).toString("base64url")
}

export function buildJobPhotoUploadUrl(tokenId: string): string {
  const base = getAppUrl().replace(/\/+$/, "")
  return `${base}/upload?t=${encodeURIComponent(tokenId)}`
}

export function jobPhotoFileUrl(photoId: string): string {
  const base = getAppUrl().replace(/\/+$/, "")
  return `${base}/api/intake/photos/${encodeURIComponent(photoId)}`
}

export async function createJobPhotoToken(params: {
  ownerUserId: string
  callLogId?: string | null
  customerPhone?: string | null
}): Promise<{ id: string; url: string } | null> {
  const id = createJobPhotoTokenId()
  try {
    await sql()`
      INSERT INTO job_photo_tokens (
        id, owner_user_id, call_log_id, customer_phone, ticket_status
      )
      VALUES (
        ${id},
        ${params.ownerUserId},
        ${params.callLogId ?? null},
        ${params.customerPhone ?? null},
        ${"awaiting_photos"}
      )
    `
    return { id, url: buildJobPhotoUploadUrl(id) }
  } catch (e) {
    console.warn("[job-photos] create token failed:", e)
    return null
  }
}

export async function getJobPhotoToken(id: string): Promise<JobPhotoTokenRow | null> {
  try {
    const rows = await sql()`
      SELECT
        id,
        owner_user_id,
        call_log_id,
        customer_phone,
        status,
        coalesce(ticket_status, 'awaiting_photos') AS ticket_status,
        operator_alert_sent_at::text AS operator_alert_sent_at,
        expires_at::text AS expires_at
      FROM job_photo_tokens
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
      ticket_status: String(row.ticket_status || "awaiting_photos"),
      operator_alert_sent_at:
        row.operator_alert_sent_at != null ? String(row.operator_alert_sent_at) : null,
      expires_at: String(row.expires_at),
    }
  } catch (e) {
    console.warn("[job-photos] get token failed:", e)
    return null
  }
}

export async function listJobPhotosForToken(tokenId: string): Promise<JobPhotoMeta[]> {
  try {
    const rows = await sql()`
      SELECT id, token_id, call_log_id, mime_type, file_name, byte_size, created_at::text AS created_at
      FROM job_photos
      WHERE token_id = ${tokenId}
      ORDER BY created_at ASC
      LIMIT 40
    `
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      token_id: String(row.token_id),
      call_log_id: row.call_log_id != null ? String(row.call_log_id) : null,
      mime_type: String(row.mime_type || "image/jpeg"),
      file_name: row.file_name != null ? String(row.file_name) : null,
      byte_size: Number(row.byte_size) || 0,
      created_at: String(row.created_at),
      url: jobPhotoFileUrl(String(row.id)),
    }))
  } catch (e) {
    console.warn("[job-photos] list by token failed:", e)
    return []
  }
}

export async function listJobPhotosForCall(params: {
  ownerUserId: string
  callLogId: string
}): Promise<JobPhotoMeta[]> {
  if (!params.callLogId.trim()) return []
  try {
    const rows = await sql()`
      SELECT id, token_id, call_log_id, mime_type, file_name, byte_size, created_at::text AS created_at
      FROM job_photos
      WHERE owner_user_id = ${params.ownerUserId}
        AND call_log_id = ${params.callLogId}
      ORDER BY created_at ASC
      LIMIT 40
    `
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      token_id: String(row.token_id),
      call_log_id: row.call_log_id != null ? String(row.call_log_id) : null,
      mime_type: String(row.mime_type || "image/jpeg"),
      file_name: row.file_name != null ? String(row.file_name) : null,
      byte_size: Number(row.byte_size) || 0,
      created_at: String(row.created_at),
      url: jobPhotoFileUrl(String(row.id)),
    }))
  } catch (e) {
    console.warn("[job-photos] list failed:", e)
    return []
  }
}

export async function getJobPhotoBinary(photoId: string): Promise<{
  mimeType: string
  dataBase64: string
  ownerUserId: string
} | null> {
  try {
    const rows = await sql()`
      SELECT mime_type, data_base64, owner_user_id
      FROM job_photos
      WHERE id = ${photoId}::uuid
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row?.data_base64) return null
    return {
      mimeType: String(row.mime_type || "image/jpeg"),
      dataBase64: String(row.data_base64),
      ownerUserId: String(row.owner_user_id),
    }
  } catch (e) {
    console.warn("[job-photos] get binary failed:", e)
    return null
  }
}

/** Persist one photo and broadcast ticket.photos_updated to the owner's workspace. */
export async function saveJobPhotoFromUpload(params: {
  tokenId: string
  mimeType: string
  fileName?: string | null
  dataBase64: string
}): Promise<{ ok: true; photo: JobPhotoMeta } | { ok: false; reason: string }> {
  const token = await getJobPhotoToken(params.tokenId)
  if (!token) return { ok: false, reason: "not-found" }
  if (token.status === "expired" || new Date(token.expires_at).getTime() < Date.now()) {
    try {
      await sql()`UPDATE job_photo_tokens SET status = 'expired' WHERE id = ${params.tokenId}`
    } catch {
      /* ignore */
    }
    return { ok: false, reason: "expired" }
  }

  const mime = params.mimeType.startsWith("image/") ? params.mimeType : "image/jpeg"
  const raw = params.dataBase64.replace(/^data:image\/\w+;base64,/, "").trim()
  if (!raw || raw.length < 32) return { ok: false, reason: "empty" }
  // Cap ~2.5MB base64 (~1.8MB binary) to protect Neon + SMS flow.
  if (raw.length > 3_500_000) return { ok: false, reason: "too-large" }

  const byteSize = Math.floor((raw.length * 3) / 4)
  try {
    const rows = await sql()`
      INSERT INTO job_photos (
        token_id, owner_user_id, call_log_id, mime_type, file_name, data_base64, byte_size
      )
      VALUES (
        ${params.tokenId},
        ${token.owner_user_id},
        ${token.call_log_id},
        ${mime},
        ${params.fileName ?? null},
        ${raw},
        ${byteSize}
      )
      RETURNING id, token_id, call_log_id, mime_type, file_name, byte_size, created_at::text AS created_at
    `
    await sql()`
      UPDATE job_photo_tokens SET status = 'uploaded' WHERE id = ${params.tokenId}
    `
    const row = rows[0] as Record<string, unknown>
    const photo: JobPhotoMeta = {
      id: String(row.id),
      token_id: String(row.token_id),
      call_log_id: row.call_log_id != null ? String(row.call_log_id) : null,
      mime_type: String(row.mime_type || mime),
      file_name: row.file_name != null ? String(row.file_name) : null,
      byte_size: Number(row.byte_size) || byteSize,
      created_at: String(row.created_at),
      url: jobPhotoFileUrl(String(row.id)),
    }

    const photos = await listJobPhotosForToken(params.tokenId)

    await publishOwnerEvent(token.owner_user_id, "ticket.photos_updated", {
      token_id: params.tokenId,
      call_log_id: token.call_log_id,
      photo,
      photos,
    })

    // Delayed / parked tickets (Pending Info · Awaiting Photos) → toast + operator SMS.
    try {
      const { notifyDelayedJobPhotoUpload } = await import("@/lib/job-photo-delayed-alert")
      await notifyDelayedJobPhotoUpload({ token, photoCount: photos.length })
    } catch (alertErr) {
      console.warn("[job-photos] delayed alert failed:", alertErr)
    }

    return { ok: true, photo }
  } catch (e) {
    console.warn("[job-photos] save failed:", e)
    return { ok: false, reason: "db-error" }
  }
}

/** Stamp operator_alert_sent_at so we only SMS once per upload token. */
export async function markJobPhotoOperatorAlertSent(tokenId: string): Promise<void> {
  try {
    await sql()`
      UPDATE job_photo_tokens
      SET operator_alert_sent_at = now()
      WHERE id = ${tokenId}
        AND operator_alert_sent_at IS NULL
    `
  } catch (e) {
    console.warn("[job-photos] mark alert sent failed:", e)
  }
}

/** Promote open photo tokens for a finished call to Pending Info (delayed upload wait). */
export async function markJobPhotoTokensPendingInfo(params: {
  ownerUserId: string
  callLogId: string
}): Promise<void> {
  if (!params.callLogId.trim()) return
  try {
    await sql()`
      UPDATE job_photo_tokens
      SET ticket_status = 'pending_info'
      WHERE owner_user_id = ${params.ownerUserId}
        AND call_log_id = ${params.callLogId}
        AND ticket_status = 'awaiting_photos'
        AND status IN ('pending', 'uploaded')
    `
  } catch (e) {
    console.warn("[job-photos] mark pending_info failed:", e)
  }
}
