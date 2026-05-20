// POST /api/admin/toggle-subscription — set has_active_subscription + tier (admin only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminToggleUserSubscription, getOnboardingProfile } from "@/lib/db"

function parseUserId(body: Record<string, unknown>): string {
  return String(body.userId ?? body.user_id ?? "").trim()
}

function parseActiveStatus(body: Record<string, unknown>): boolean | null {
  if (typeof body.activeStatus === "boolean") return body.activeStatus
  if (typeof body.has_active_subscription === "boolean") return body.has_active_subscription
  return null
}

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = parseUserId(body)
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    const explicit = parseActiveStatus(body)
    const profile = await getOnboardingProfile(userId)
    const current = profile?.has_active_subscription ?? false
    const activeStatus = explicit ?? !current
    const result = await adminToggleUserSubscription(userId, activeStatus)
    return NextResponse.json({ data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Subscription toggle failed"
    console.error("[lyncr-admin] toggle-subscription:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
