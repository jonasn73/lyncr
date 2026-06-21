// ============================================
// GET /api/numbers/mine
// ============================================
// Returns the authenticated user's business phone numbers from the database.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  getPhoneNumbers,
  getRoutingConfigForNumber,
  getUser,
  getOnboardingProfile,
  ensureOnboardingLineFromProfile,
  retryProvisionOnboardingBuyLine,
  effectiveAdminRoutingOverrideForPhoneLine,
  repairMisassignedDefaultOrgPhoneLines,
} from "@/lib/db"
import { syncMissingTelnyxNumbersForUser } from "@/lib/telnyx-number-sync"
import type { FallbackType, PhoneNumberRoutingSummary } from "@/lib/types"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    await ensureOnboardingLineFromProfile(userId).catch((e) => {
      console.error("[numbers/mine] onboarding line backfill:", e)
    })
    await syncMissingTelnyxNumbersForUser(userId).catch((e) => {
      console.error("[numbers/mine] Telnyx→Neon number sync:", e)
    })
    await repairMisassignedDefaultOrgPhoneLines(userId).catch((e) => {
      console.error("[numbers/mine] phone line workspace repair:", e)
    })
    await retryProvisionOnboardingBuyLine(userId)
    const orgParam = req.nextUrl.searchParams.get("organization_id")?.trim() || null
    const [numbers, account, profile] = await Promise.all([
      getPhoneNumbers(userId, orgParam),
      getUser(userId),
      getOnboardingProfile(userId),
    ])
    const assistantLinked = Boolean(account?.telnyx_ai_assistant_id?.trim())

    const numbersWithRouting = await Promise.all(
      numbers.map(async (row) => {
        const cfg = await getRoutingConfigForNumber(userId, row.number)
        const fb = (cfg?.fallback_type ?? "owner") as FallbackType
        const aiSelected = fb === "ai"
        const routing_summary: PhoneNumberRoutingSummary = {
          fallback_type: fb,
          ai_fallback_selected: aiSelected,
          telnyx_assistant_linked: assistantLinked,
          ai_fallback_live: aiSelected && assistantLinked,
          ring_first_receptionist_id: cfg?.selected_receptionist_id ?? null,
        }
        return {
          ...row,
          admin_routing_override_phone: effectiveAdminRoutingOverrideForPhoneLine(row),
          routing_summary,
        }
      })
    )

    // Primary line for this workspace only — global reserved_number may belong to another business.
    const globalReserved = profile?.reserved_number?.trim() || null
    const visible = numbersWithRouting.filter((n) =>
      n.status === "active" || n.status === "pending" || n.status === "porting"
    )
    const reservedInWorkspace =
      globalReserved && visible.some((n) => n.number === globalReserved)
        ? globalReserved
        : visible[0]?.number ?? null

    return NextResponse.json({
      numbers: numbersWithRouting,
      reserved_number: reservedInWorkspace,
      organization_id: orgParam,
    })
  } catch (error) {
    console.error("[Sigo] Error fetching user numbers:", error)
    return NextResponse.json({ error: "Failed to load numbers" }, { status: 500 })
  }
}
