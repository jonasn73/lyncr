// ============================================
// GET /api/settings/shop-address
// ============================================
// Shop / home-base origin the dispatch map measures intake travel distance from when
// there is no live GPS fix. Returns null data when unset — the map then falls back to
// the metro centroid and labels the estimate as such.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUserShopOrigin } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const origin = await getUserShopOrigin(userId)
    return NextResponse.json({ data: origin })
  } catch (error) {
    console.error("[lyncr] Shop address lookup error:", error)
    return NextResponse.json({ error: "Failed to load shop address" }, { status: 500 })
  }
}
