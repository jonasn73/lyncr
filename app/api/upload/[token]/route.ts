// GET/POST /api/upload/[token] — public customer upload page API (no auth).

import { NextRequest, NextResponse } from "next/server"
import {
  getJobPhotoToken,
  listJobPhotosForToken,
  saveJobPhotoFromUpload,
} from "@/lib/job-photo-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  // Read the opaque token from the URL path.
  const { token } = await ctx.params
  // Look up the token row in Neon.
  const row = await getJobPhotoToken(token)
  // Unknown / typo links.
  if (!row) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }
  // Expired links should ask the shop to resend.
  if (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This upload link has expired" }, { status: 410 })
  }
  // Count existing photos so the mobile UI can show progress.
  const photos = await listJobPhotosForToken(token)
  // Pending and already-uploaded both stay open for more pictures.
  return NextResponse.json({
    data: {
      status: row.status,
      photo_count: photos.length,
    },
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  // Same token as the SMS link.
  const { token } = await ctx.params
  // Expect compressed base64 image JSON from the /upload page.
  let body: { mime_type?: string; file_name?: string; data_base64?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Require a non-empty image payload.
  const dataBase64 = String(body.data_base64 || "").trim()
  if (!dataBase64) {
    return NextResponse.json({ error: "Photo data required" }, { status: 400 })
  }

  // Persist + broadcast ticket.photos_updated over Pusher.
  const result = await saveJobPhotoFromUpload({
    tokenId: token,
    mimeType: String(body.mime_type || "image/jpeg"),
    fileName: body.file_name != null ? String(body.file_name) : null,
    dataBase64,
  })
  // Map library reasons to HTTP statuses.
  if (!result.ok) {
    const status =
      result.reason === "not-found" ? 404 : result.reason === "expired" ? 410 : result.reason === "too-large" ? 413 : 500
    return NextResponse.json({ error: result.reason }, { status })
  }
  // Confirm to the customer phone UI.
  return NextResponse.json({ data: { ok: true, photo: result.photo } })
}
