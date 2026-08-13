// GET /api/numbers — list the signed-in owner's Telnyx lines.
// POST /api/numbers — search available Telnyx numbers (same as GET /api/numbers/telnyx).

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getPhoneNumbers } from "@/lib/db"
import { GET as telnyxSearchGet } from "@/app/api/numbers/telnyx/route"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const numbers = await getPhoneNumbers(userId)
    return NextResponse.json({ numbers })
  } catch (error) {
    console.error("[lyncr] Error fetching numbers:", error)
    return NextResponse.json({ error: "Failed to fetch phone numbers" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      area_code?: string
      type?: string
    }
    const url = new URL(req.url)
    url.pathname = "/api/numbers/telnyx"
    if (body.area_code) url.searchParams.set("area_code", String(body.area_code))
    if (body.type) url.searchParams.set("type", String(body.type))
    return telnyxSearchGet(new NextRequest(url, { headers: req.headers }))
  } catch (error) {
    console.error("[lyncr] Error searching numbers:", error)
    return NextResponse.json({ error: "Failed to search numbers" }, { status: 500 })
  }
}
