import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { completeOnboardingCheckout } from "@/lib/db"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const opening_line =
      typeof body?.opening_line === "string" ? body.opening_line : undefined
    const fallback_type =
      body?.fallback_type === "ai" || body?.fallback_type === "voicemail"
        ? body.fallback_type
        : undefined
    const profile = await completeOnboardingCheckout(userId, { opening_line, fallback_type })
    return NextResponse.json({ data: profile })
  } catch (e) {
    console.error("[onboarding/profile/complete POST]", e)
    const msg = e instanceof Error ? e.message : "Failed to complete checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
