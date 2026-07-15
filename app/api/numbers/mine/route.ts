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
  archiveOwnerCellMirroredBusinessLines,
  listCompletedPortPhoneNumbersForOwner,
} from "@/lib/db"
import { syncMissingTelnyxNumbersForUser } from "@/lib/telnyx-number-sync"
import { filterInboundBusinessLines } from "@/lib/owner-cell-line-filter"
import { reconcileCompletedPortLinesForOwner } from "@/lib/port-number-finalize"
import { pickPreferredCustomerLine } from "@/lib/preferred-business-line"
import { orderPhoneLinesForOrganization } from "@/lib/workspace-phone-lines"
import type { FallbackType, PhoneNumberRoutingSummary } from "@/lib/types"

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const orgParam = req.nextUrl.searchParams.get("organization_id")?.trim() || null

    // Background maintenance — never block the JSON response on Telnyx/cloud APIs.
    void Promise.all([
      ensureOnboardingLineFromProfile(userId).catch((e) => {
        console.error("[numbers/mine] onboarding line backfill:", e)
      }),
      syncMissingTelnyxNumbersForUser(userId).catch((e) => {
        console.error("[numbers/mine] Telnyx→Neon number sync:", e)
      }),
      repairMisassignedDefaultOrgPhoneLines(userId).catch((e) => {
        console.error("[numbers/mine] phone line workspace repair:", e)
      }),
      retryProvisionOnboardingBuyLine(userId).catch((e) => {
        console.error("[numbers/mine] onboarding buy retry:", e)
      }),
      reconcileCompletedPortLinesForOwner({
        ownerUserId: userId,
        organizationId: orgParam,
      }).catch((e) => {
        console.error("[numbers/mine] completed port reconcile:", e)
      }),
    ])

    const [numbers, account, profile, completedPortTargets] = await Promise.all([
      getPhoneNumbers(userId, orgParam),
      getUser(userId),
      getOnboardingProfile(userId),
      listCompletedPortPhoneNumbersForOwner(userId, orgParam),
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

    // Primary line for this workspace — ported main DID beats temp placeholder.
    const globalReserved = profile?.reserved_number?.trim() || null
    const ownerPhone = account?.phone?.trim() || null
    const visible = filterInboundBusinessLines(
      numbersWithRouting.filter((n) =>
        n.status === "active" || n.status === "pending" || n.status === "porting"
      ),
      ownerPhone
    )
    const orderedVisible = orderPhoneLinesForOrganization(
      visible.map((row) => ({
        number: row.number,
        status: row.status,
        label: row.label ?? undefined,
        organization_id: row.organization_id ?? null,
        provider_number_sid: row.provider_number_sid,
        twilio_sid: row.twilio_sid,
      })),
      orgParam,
      { reservedNumber: globalReserved, completedPortTargets }
    )
    const reservedInWorkspace = pickPreferredCustomerLine({
      lines: orderedVisible,
      reservedNumber: globalReserved,
      completedPortTargets,
    })

    const numbersForClient = orderedVisible.map((row) => {
      const full = visible.find((n) => n.number === row.number)!
      return {
        ...full,
        carrier_live:
          Boolean(full.provider_number_sid?.trim()) && full.status === "active",
      }
    })

    return NextResponse.json({
      numbers: numbersForClient,
      reserved_number: reservedInWorkspace,
      organization_id: orgParam,
    })
  } catch (error) {
    console.error("[lyncr] Error fetching user numbers:", error)
    return NextResponse.json({ error: "Failed to load numbers" }, { status: 500 })
  }
}
