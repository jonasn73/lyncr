// GET/POST /api/locate/[token] — public locate page API (no auth).

import { NextRequest, NextResponse } from "next/server"
import {
  completeLiveGpsLocate,
  getLiveGpsLocateToken,
} from "@/lib/live-gps-locate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  const row = await getLiveGpsLocateToken(token)
  if (!row) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }
  if (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This locate link has expired" }, { status: 410 })
  }
  if (row.status === "shared") {
    return NextResponse.json({ data: { status: "shared" } })
  }
  return NextResponse.json({ data: { status: "pending" } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  let body: { latitude?: number; longitude?: number; formatted_address?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "latitude and longitude required" }, { status: 400 })
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  const result = await completeLiveGpsLocate({
    tokenId: token,
    latitude: lat,
    longitude: lng,
    formattedAddress: body.formatted_address ?? null,
  })
  if (!result.ok) {
    const status = result.reason === "not-found" ? 404 : result.reason === "expired" ? 410 : 500
    return NextResponse.json({ error: result.reason }, { status })
  }
  return NextResponse.json({ data: { ok: true } })
}
