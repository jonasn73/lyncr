// GET /api/inventory/reorder-requests — owner's queue (pending first, then in-progress).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { listReorderRequestsForOwner } from "@/lib/key-reorder-requests"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const requests = await listReorderRequestsForOwner(userId)
    return NextResponse.json({ data: { requests } })
  } catch (e) {
    console.error("[inventory/reorder-requests GET]", e)
    return NextResponse.json({ error: "Failed to list reorder requests" }, { status: 500 })
  }
}
