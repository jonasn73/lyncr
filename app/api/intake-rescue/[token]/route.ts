// GET/POST /api/intake-rescue/[token] — public Pending Info Intake form API.

import { NextRequest, NextResponse } from "next/server"
import {
  getJobPhotoToken,
  listJobPhotosForToken,
  submitIntakeRescueForm,
  type IntakeRescuePhotoInput,
  type JobPhotoCategory,
} from "@/lib/job-photo-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  const row = await getJobPhotoToken(token)
  if (!row) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }
  if (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This intake link has expired" }, { status: 410 })
  }
  const photos = await listJobPhotosForToken(token)
  return NextResponse.json({
    data: {
      status: row.status,
      ticket_status: row.ticket_status,
      photo_count: photos.length,
      already_submitted: Boolean(row.rescue_submitted_at) || row.ticket_status === "info_received",
      customer_name: row.customer_name,
    },
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  let body: {
    full_name?: string
    vehicle_vin?: string
    special_notes?: string
    verify_on_arrival?: boolean
    vin_unavailable?: boolean
    vehicle_year?: string
    vehicle_make?: string
    vehicle_model?: string
    photos?: Array<{
      mime_type?: string
      file_name?: string
      data_base64?: string
      category?: string
    }>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const photos: IntakeRescuePhotoInput[] = []
  for (const p of body.photos || []) {
    const raw = String(p.data_base64 || "").trim()
    if (!raw) continue
    const catRaw = String(p.category || "damage")
    const category: JobPhotoCategory =
      catRaw === "id_verification" || catRaw === "other" ? catRaw : "damage"
    photos.push({
      mime_type: p.mime_type || "image/jpeg",
      file_name: p.file_name ?? null,
      data_base64: raw,
      category,
    })
  }

  const result = await submitIntakeRescueForm({
    tokenId: token,
    fullName: String(body.full_name || ""),
    vehicleVin: body.vehicle_vin ?? null,
    specialNotes: body.special_notes ?? null,
    verifyOnArrival: Boolean(body.verify_on_arrival),
    vinUnavailable: Boolean(body.vin_unavailable),
    vehicleYear: body.vehicle_year ?? null,
    vehicleMake: body.vehicle_make ?? null,
    vehicleModel: body.vehicle_model ?? null,
    photos,
  })

  if (!result.ok) {
    const map: Record<string, number> = {
      "not-found": 404,
      expired: 410,
      "name-required": 400,
      "damage-photo-required": 400,
      "id-photo-required": 400,
      "too-large": 413,
      "upload-failed": 500,
      "db-error": 500,
    }
    const status = map[result.reason] || 500
    const messages: Record<string, string> = {
      "name-required": "Please enter your full name.",
      "damage-photo-required": "Please add at least one lock/ignition damage photo.",
      "id-photo-required": "Please add a photo of your ID or registration, or choose verify on arrival.",
      expired: "This link has expired. Ask us to text a new one.",
      "not-found": "This link is no longer valid.",
    }
    return NextResponse.json(
      { error: messages[result.reason] || result.reason },
      { status }
    )
  }

  return NextResponse.json({
    data: {
      ok: true,
      ticket_status: result.package.token.ticket_status,
      verify_on_arrival: result.package.token.verify_on_arrival,
      vehicle: {
        vin: result.package.token.vehicle_vin,
        year: result.package.token.vehicle_year,
        make: result.package.token.vehicle_make,
        model: result.package.token.vehicle_model,
        trim: result.package.token.vehicle_trim,
      },
    },
  })
}
