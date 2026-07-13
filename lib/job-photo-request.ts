// Job photo / intake-rescue tokens — SMS /intake-rescue?t=… → customer profile → Pusher into intake.

import { randomBytes } from "crypto"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAppUrl } from "@/lib/telnyx"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { decodeVin, normalizeVin } from "@/lib/nhtsa-vpic"

export type JobPhotoCategory = "damage" | "id_verification" | "other"

export type JobPhotoTokenRow = {
  id: string
  owner_user_id: string
  call_log_id: string | null
  customer_phone: string | null
  status: string
  /** awaiting_photos | pending_info | info_received | resolved */
  ticket_status: string
  operator_alert_sent_at: string | null
  expires_at: string
  customer_name: string | null
  vehicle_vin: string | null
  special_notes: string | null
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_trim: string | null
  rescue_submitted_at: string | null
  /** Customer chose to show physical ID on site instead of uploading. */
  verify_on_arrival: boolean
  /** Customer cannot access VIN (locked vehicle) — used Year/Make/Model fields. */
  vin_unavailable: boolean
}

export type JobPhotoMeta = {
  id: string
  token_id: string
  call_log_id: string | null
  mime_type: string
  file_name: string | null
  byte_size: number
  category: JobPhotoCategory
  created_at: string
  url: string
}

export type IntakeRescuePackage = {
  token: JobPhotoTokenRow
  photos: JobPhotoMeta[]
  damage_photos: JobPhotoMeta[]
  id_photos: JobPhotoMeta[]
}

function sql() {
  return neon(resolveNeonDatabaseUrl())
}

function mapPhotoRow(row: Record<string, unknown>): JobPhotoMeta {
  const categoryRaw = String(row.category || "damage")
  const category: JobPhotoCategory =
    categoryRaw === "id_verification" || categoryRaw === "other" ? categoryRaw : "damage"
  return {
    id: String(row.id),
    token_id: String(row.token_id),
    call_log_id: row.call_log_id != null ? String(row.call_log_id) : null,
    mime_type: String(row.mime_type || "image/jpeg"),
    file_name: row.file_name != null ? String(row.file_name) : null,
    byte_size: Number(row.byte_size) || 0,
    category,
    created_at: String(row.created_at),
    url: jobPhotoFileUrl(String(row.id)),
  }
}

function mapTokenRow(row: Record<string, unknown>): JobPhotoTokenRow {
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
    customer_name: row.customer_name != null ? String(row.customer_name) : null,
    vehicle_vin: row.vehicle_vin != null ? String(row.vehicle_vin) : null,
    special_notes: row.special_notes != null ? String(row.special_notes) : null,
    vehicle_year: row.vehicle_year != null ? String(row.vehicle_year) : null,
    vehicle_make: row.vehicle_make != null ? String(row.vehicle_make) : null,
    vehicle_model: row.vehicle_model != null ? String(row.vehicle_model) : null,
    vehicle_trim: row.vehicle_trim != null ? String(row.vehicle_trim) : null,
    rescue_submitted_at:
      row.rescue_submitted_at != null ? String(row.rescue_submitted_at) : null,
    verify_on_arrival: Boolean(row.verify_on_arrival),
    vin_unavailable: Boolean(row.vin_unavailable),
  }
}

export function createJobPhotoTokenId(): string {
  return randomBytes(12).toString("base64url")
}

export function buildJobPhotoUploadUrl(tokenId: string): string {
  const base = getAppUrl().replace(/\/+$/, "")
  // Public Pending Info Intake landing page.
  return `${base}/intake-rescue?t=${encodeURIComponent(tokenId)}`
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
        expires_at::text AS expires_at,
        customer_name,
        vehicle_vin,
        special_notes,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        vehicle_trim,
        rescue_submitted_at::text AS rescue_submitted_at,
        coalesce(verify_on_arrival, false) AS verify_on_arrival,
        coalesce(vin_unavailable, false) AS vin_unavailable
      FROM job_photo_tokens
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return mapTokenRow(row)
  } catch (e) {
    console.warn("[job-photos] get token failed:", e)
    return null
  }
}

export async function listJobPhotosForToken(tokenId: string): Promise<JobPhotoMeta[]> {
  try {
    const rows = await sql()`
      SELECT
        id, token_id, call_log_id, mime_type, file_name, byte_size,
        coalesce(category, 'damage') AS category,
        created_at::text AS created_at
      FROM job_photos
      WHERE token_id = ${tokenId}
      ORDER BY created_at ASC
      LIMIT 40
    `
    return (rows as Array<Record<string, unknown>>).map(mapPhotoRow)
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
      SELECT
        id, token_id, call_log_id, mime_type, file_name, byte_size,
        coalesce(category, 'damage') AS category,
        created_at::text AS created_at
      FROM job_photos
      WHERE owner_user_id = ${params.ownerUserId}
        AND call_log_id = ${params.callLogId}
      ORDER BY created_at ASC
      LIMIT 40
    `
    return (rows as Array<Record<string, unknown>>).map(mapPhotoRow)
  } catch (e) {
    console.warn("[job-photos] list failed:", e)
    return []
  }
}

/** Latest rescue package for a live call ticket (metadata + categorized photos). */
export async function getIntakeRescueForCall(params: {
  ownerUserId: string
  callLogId: string
}): Promise<IntakeRescuePackage | null> {
  if (!params.callLogId.trim()) return null
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
        expires_at::text AS expires_at,
        customer_name,
        vehicle_vin,
        special_notes,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        vehicle_trim,
        rescue_submitted_at::text AS rescue_submitted_at,
        coalesce(verify_on_arrival, false) AS verify_on_arrival,
        coalesce(vin_unavailable, false) AS vin_unavailable
      FROM job_photo_tokens
      WHERE owner_user_id = ${params.ownerUserId}
        AND call_log_id = ${params.callLogId}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    const token = mapTokenRow(row)
    const photos = await listJobPhotosForToken(token.id)
    return {
      token,
      photos,
      damage_photos: photos.filter((p) => p.category === "damage"),
      id_photos: photos.filter((p) => p.category === "id_verification"),
    }
  } catch (e) {
    console.warn("[job-photos] get rescue for call failed:", e)
    return null
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

async function insertJobPhoto(params: {
  token: JobPhotoTokenRow
  mimeType: string
  fileName?: string | null
  dataBase64: string
  category: JobPhotoCategory
}): Promise<JobPhotoMeta | null> {
  const mime = params.mimeType.startsWith("image/") ? params.mimeType : "image/jpeg"
  const raw = params.dataBase64.replace(/^data:image\/\w+;base64,/, "").trim()
  if (!raw || raw.length < 32) return null
  if (raw.length > 3_500_000) return null
  const byteSize = Math.floor((raw.length * 3) / 4)
  try {
    const rows = await sql()`
      INSERT INTO job_photos (
        token_id, owner_user_id, call_log_id, mime_type, file_name, data_base64, byte_size, category
      )
      VALUES (
        ${params.token.id},
        ${params.token.owner_user_id},
        ${params.token.call_log_id},
        ${mime},
        ${params.fileName ?? null},
        ${raw},
        ${byteSize},
        ${params.category}
      )
      RETURNING
        id, token_id, call_log_id, mime_type, file_name, byte_size,
        coalesce(category, 'damage') AS category,
        created_at::text AS created_at
    `
    return mapPhotoRow(rows[0] as Record<string, unknown>)
  } catch (e) {
    console.warn("[job-photos] insert failed:", e)
    return null
  }
}

/** Persist one photo (legacy /upload single-shot) and broadcast. */
export async function saveJobPhotoFromUpload(params: {
  tokenId: string
  mimeType: string
  fileName?: string | null
  dataBase64: string
  category?: JobPhotoCategory
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

  const photo = await insertJobPhoto({
    token,
    mimeType: params.mimeType,
    fileName: params.fileName,
    dataBase64: params.dataBase64,
    category: params.category || "damage",
  })
  if (!photo) return { ok: false, reason: "too-large" }

  try {
    await sql()`UPDATE job_photo_tokens SET status = 'uploaded' WHERE id = ${params.tokenId}`
  } catch {
    /* ignore */
  }

  const photos = await listJobPhotosForToken(params.tokenId)
  await publishOwnerEvent(token.owner_user_id, "ticket.photos_updated", {
    token_id: params.tokenId,
    call_log_id: token.call_log_id,
    photo,
    photos,
  })

  try {
    const { notifyDelayedJobPhotoUpload } = await import("@/lib/job-photo-delayed-alert")
    await notifyDelayedJobPhotoUpload({ token, photoCount: photos.length })
  } catch (alertErr) {
    console.warn("[job-photos] delayed alert failed:", alertErr)
  }

  return { ok: true, photo }
}

export type IntakeRescuePhotoInput = {
  mime_type?: string
  file_name?: string | null
  data_base64: string
  category: JobPhotoCategory
}

/** Full Pending Info Intake submit — profile + photos + VIN decode + operator alert. */
export async function submitIntakeRescueForm(params: {
  tokenId: string
  fullName: string
  vehicleVin?: string | null
  specialNotes?: string | null
  verifyOnArrival?: boolean
  vinUnavailable?: boolean
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  photos: IntakeRescuePhotoInput[]
}): Promise<
  | { ok: true; package: IntakeRescuePackage }
  | { ok: false; reason: string }
> {
  const token = await getJobPhotoToken(params.tokenId)
  if (!token) return { ok: false, reason: "not-found" }
  if (token.status === "expired" || new Date(token.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" }
  }

  const fullName = params.fullName.trim()
  if (!fullName) return { ok: false, reason: "name-required" }

  const verifyOnArrival = Boolean(params.verifyOnArrival)
  const vinUnavailable = Boolean(params.vinUnavailable)

  const damageInputs = params.photos.filter((p) => p.category === "damage")
  if (damageInputs.length < 1) return { ok: false, reason: "damage-photo-required" }
  // ID upload is always optional — verify_on_arrival just records how the tech will check ID.

  // VIN decode when provided; otherwise accept manual Year / Make / Model.
  let vehicleYear: string | null = null
  let vehicleMake: string | null = null
  let vehicleModel: string | null = null
  let vehicleTrim: string | null = null
  let vehicleVin: string | null = null
  const vinRaw = !vinUnavailable ? params.vehicleVin?.trim() || "" : ""
  if (vinRaw) {
    const decoded = await decodeVin(vinRaw)
    vehicleVin = normalizeVin(vinRaw) || decoded.vin
    vehicleYear = decoded.vehicle_year
    vehicleMake = decoded.vehicle_make
    vehicleModel = decoded.vehicle_model
    vehicleTrim = decoded.vehicle_trim
  } else {
    vehicleYear = params.vehicleYear?.trim() || null
    vehicleMake = params.vehicleMake?.trim() || null
    vehicleModel = params.vehicleModel?.trim() || null
  }

  const saved: JobPhotoMeta[] = []
  for (const p of params.photos.slice(0, 12)) {
    const photo = await insertJobPhoto({
      token,
      mimeType: p.mime_type || "image/jpeg",
      fileName: p.file_name,
      dataBase64: p.data_base64,
      category: p.category,
    })
    if (photo) saved.push(photo)
  }
  if (saved.length < 1) return { ok: false, reason: "upload-failed" }

  // Append a clear on-site ID note for the tech when verify_on_arrival is set.
  let notes = params.specialNotes?.trim() || ""
  if (verifyOnArrival) {
    const tag = "VERIFY ID ON SITE BEFORE UNLOCKING"
    if (!notes.toUpperCase().includes(tag)) {
      notes = notes ? `${notes}\n\n${tag}` : tag
    }
  }

  try {
    await sql()`
      UPDATE job_photo_tokens
      SET
        status = 'uploaded',
        ticket_status = 'info_received',
        customer_name = ${fullName},
        vehicle_vin = ${vehicleVin},
        special_notes = ${notes || null},
        vehicle_year = ${vehicleYear},
        vehicle_make = ${vehicleMake},
        vehicle_model = ${vehicleModel},
        vehicle_trim = ${vehicleTrim},
        verify_on_arrival = ${verifyOnArrival},
        vin_unavailable = ${vinUnavailable},
        rescue_submitted_at = now(),
        operator_alert_sent_at = NULL
      WHERE id = ${params.tokenId}
    `
  } catch (e) {
    console.warn("[job-photos] rescue update failed:", e)
    return { ok: false, reason: "db-error" }
  }

  const refreshed = await getJobPhotoToken(params.tokenId)
  if (!refreshed) return { ok: false, reason: "db-error" }
  const photos = await listJobPhotosForToken(params.tokenId)
  const pkg: IntakeRescuePackage = {
    token: refreshed,
    photos,
    damage_photos: photos.filter((p) => p.category === "damage"),
    id_photos: photos.filter((p) => p.category === "id_verification"),
  }

  await publishOwnerEvent(token.owner_user_id, "ticket.photos_updated", {
    token_id: params.tokenId,
    call_log_id: token.call_log_id,
    photos,
    rescue: pkg,
    ticket_status: "info_received",
    verify_on_arrival: verifyOnArrival,
  })

  try {
    const { notifyDelayedJobPhotoUpload } = await import("@/lib/job-photo-delayed-alert")
    await notifyDelayedJobPhotoUpload({
      token: refreshed,
      photoCount: photos.length,
      force: true,
      kind: "intake_rescue",
    })
  } catch (alertErr) {
    console.warn("[job-photos] rescue alert failed:", alertErr)
  }

  return { ok: true, package: pkg }
}

export async function markJobPhotoOperatorAlertSent(tokenId: string): Promise<void> {
  try {
    await sql()`
      UPDATE job_photo_tokens
      SET operator_alert_sent_at = now()
      WHERE id = ${tokenId}
    `
  } catch (e) {
    console.warn("[job-photos] mark alert sent failed:", e)
  }
}

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
