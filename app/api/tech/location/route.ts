// ============================================
// POST /api/tech/location
// ============================================
// Background ping from the technician console while a tech is en route / on site. Stores their
// live coordinates + status so the owner can see them on the live map.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, updateTechLocation } from "@/lib/db"

export const dynamic = "force-dynamic"

const ALLOWED_STATUS = new Set(["idle", "en_route", "on_site"])

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    latitude?: number
    longitude?: number
    status?: string
  }

  const lat = Number(body.latitude)
  const lng = Number(body.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const status = ALLOWED_STATUS.has(String(body.status)) ? String(body.status) : "idle"

  try {
    await updateTechLocation(userId, hasCoords ? lat : null, hasCoords ? lng : null, status)
    return NextResponse.json({ data: { ok: true } })
  } catch (e) {
    console.error("[POST /api/tech/location] failed:", e)
    return NextResponse.json({ error: "Could not update location" }, { status: 500 })
  }
}
