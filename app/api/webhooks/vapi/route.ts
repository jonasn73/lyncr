// ============================================
// POST /api/webhooks/vapi (deprecated)
// ============================================
// Legacy webhook removed — Sigo voice AI uses the platform flow; lead capture is handled in-app.

import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "This webhook is no longer used. Sigo handles voice AI and leads through the app. Contact support if you need API integrations.",
    },
    { status: 410 }
  )
}
