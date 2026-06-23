// GET /api/dispatch/route?from=lat,lng&to=lat,lng — driving path geometry for map overlay

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { fetchDrivingRoute } from "@/lib/driving-route"

export const dynamic = "force-dynamic"

function parseCoord(raw: string | null): { lat: number; lng: number } | null {
  if (!raw?.trim()) return null
  const parts = raw.split(",").map((s) => Number(s.trim()))
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null
  const [lat, lng] = parts
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const from = parseCoord(req.nextUrl.searchParams.get("from"))
  const to = parseCoord(req.nextUrl.searchParams.get("to"))
  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params required as lat,lng" }, { status: 400 })
  }

  const geometry = await fetchDrivingRoute(from, to)
  if (!geometry?.length) {
    return NextResponse.json({ error: "Could not compute route" }, { status: 502 })
  }

  return NextResponse.json({ data: { geometry } })
}
