// ============================================
// GET /api/receptionists
// POST /api/receptionists
// ============================================
// List or create receptionists. Protected: requires session.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getReceptionists, getReceptionistsForOrganization, insertReceptionist } from "@/lib/db"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const orgId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
    const receptionists =
      orgId && !orgId.startsWith("legacy-")
        ? await getReceptionistsForOrganization(userId, orgId)
        : await getReceptionists(userId)
    return NextResponse.json({ data: receptionists })
  } catch (error) {
    console.error("[Sigo] List receptionists error:", error)
    return NextResponse.json(
      { error: "Failed to list receptionists" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const body = await req.json()
    const name = String(body?.name ?? "").trim()
    const phone = String(body?.phone ?? "").trim()
    if (!name || !phone) {
      return NextResponse.json(
        { error: "Name and phone are required" },
        { status: 400 }
      )
    }
    const receptionist = await insertReceptionist({
      user_id: userId,
      name,
      phone,
    })
    return NextResponse.json({ data: receptionist })
  } catch (error) {
    console.error("[Sigo] Create receptionist error:", error)
    return NextResponse.json(
      { error: "Failed to add receptionist" },
      { status: 500 }
    )
  }
}
