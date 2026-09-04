// POST /api/admin/set-subscription-tier — admin@lyncr.app only; real per-tier override (087).
// Replaces the old toggle-subscription's binary "activate → business" behavior for setting a
// specific tier; toggle-subscription remains for the quick emergency deactivate.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminSetUserSubscriptionTier } from "@/lib/db"
import { normalizeSubscriptionTier } from "@/lib/subscription-tier"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = String(body.userId ?? body.user_id ?? "").trim()
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }
    const tier = normalizeSubscriptionTier(String(body.tier ?? ""))

    const result = await adminSetUserSubscriptionTier(userId, tier)
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to set subscription tier"
    console.error("[lyncr-admin] set-subscription-tier:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
