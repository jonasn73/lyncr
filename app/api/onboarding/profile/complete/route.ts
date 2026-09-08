import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { rejectIfShopNotUsable } from "@/lib/admin-api-guard"
import { completeOnboardingCheckout } from "@/lib/db"
import { parsePatchBody } from "@/app/api/onboarding/profile/route"
import { isOnboardingTelnyxSimulationMode } from "@/lib/onboarding-telnyx-provision-mode"
import { recordAuditEvent } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const locked = await rejectIfShopNotUsable(userId)
  if (locked) return locked

  try {
    const body = await req.json().catch(() => ({}))
    const patch = parsePatchBody(body)
    const profile = await completeOnboardingCheckout(userId, patch)
    void recordAuditEvent({
      ownerUserId: userId,
      actorUserId: userId,
      actorRole: "owner",
      eventType: "onboarding.completed",
      entityType: "user",
      entityId: userId,
    })
    return NextResponse.json({
      data: profile,
      simulation_mode: isOnboardingTelnyxSimulationMode(),
    })
  } catch (e) {
    console.error("[onboarding/profile/complete POST]", e)
    const msg = e instanceof Error ? e.message : "Failed to complete checkout"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
