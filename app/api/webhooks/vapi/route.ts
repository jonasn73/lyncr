// ============================================
// POST /api/webhooks/vapi (deprecated)
// ============================================
// Legacy webhook removed — HeySigo voice AI uses the platform flow; lead capture is handled in-app.

import { NextResponse } from "next/server"
import { SITE_NAME } from "@/lib/brand"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    {
      error: "gone",
      message:
        `This webhook is no longer used. ${SITE_NAME} handles voice AI and leads through the app. Contact support if you need API integrations.`,
    },
    { status: 410 }
  )
}
