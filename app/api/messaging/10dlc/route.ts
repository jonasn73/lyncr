// GET /api/messaging/10dlc — current 10DLC registration + form options.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getMessaging10DlcView } from "@/lib/messaging-10dlc"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  try {
    const view = await getMessaging10DlcView(userId)
    return NextResponse.json({ data: view })
  } catch (e) {
    console.error("[10dlc] GET view:", e)
    return NextResponse.json({ error: "Could not load 10DLC registration" }, { status: 500 })
  }
}
