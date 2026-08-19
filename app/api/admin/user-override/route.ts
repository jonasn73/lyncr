// POST /api/admin/user-override — atomic onboarding_profiles + phone updates (admin@lyncr.app only).

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { adminApplyUserOverride } from "@/lib/db"
import { parseAccountStatus } from "@/lib/account-status"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json()) as Record<string, unknown>
    const userId = String(body.userId ?? body.user_id ?? "").trim()
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    if (body.targetStatus !== undefined && !parseAccountStatus(String(body.targetStatus))) {
      return NextResponse.json(
        { error: "targetStatus must be pending, active, flagged, suspended, or denied" },
        { status: 400 }
      )
    }

    const phoneLineRoutingOverrides = Array.isArray(body.phoneLineRoutingOverrides)
      ? body.phoneLineRoutingOverrides.map((row) => {
          const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
          return {
            phoneLineId: String(o.phoneLineId ?? o.phone_line_id ?? "").trim(),
            adminRoutingOverridePhone:
              o.adminRoutingOverridePhone === null || o.adminRoutingOverridePhone === undefined
                ? null
                : String(o.adminRoutingOverridePhone),
          }
        })
      : undefined

    const hasAnyField =
      body.targetStatus !== undefined ||
      body.adminNotes !== undefined ||
      body.manualPhoneOverride !== undefined ||
      body.adminRoutingOverridePhone !== undefined ||
      (phoneLineRoutingOverrides && phoneLineRoutingOverrides.length > 0) ||
      body.resetActiveLines === true

    if (!hasAnyField) {
      return NextResponse.json({ error: "No override fields provided" }, { status: 400 })
    }

    const result = await adminApplyUserOverride({
      userId,
      targetStatus: body.targetStatus !== undefined ? String(body.targetStatus) : undefined,
      adminNotes:
        body.adminNotes !== undefined
          ? body.adminNotes === null
            ? null
            : String(body.adminNotes)
          : undefined,
      manualPhoneOverride:
        body.manualPhoneOverride !== undefined
          ? body.manualPhoneOverride === null
            ? null
            : String(body.manualPhoneOverride)
          : undefined,
      adminRoutingOverridePhone:
        body.adminRoutingOverridePhone !== undefined
          ? body.adminRoutingOverridePhone === null
            ? null
            : String(body.adminRoutingOverridePhone)
          : undefined,
      phoneLineId:
        body.phoneLineId != null || body.phone_line_id != null
          ? String(body.phoneLineId ?? body.phone_line_id ?? "").trim() || null
          : undefined,
      organizationId:
        body.organizationId != null || body.organization_id != null
          ? String(body.organizationId ?? body.organization_id ?? "").trim() || null
          : undefined,
      phoneLineRoutingOverrides,
      resetActiveLines: body.resetActiveLines === true,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "User override failed"
    console.error("[lyncr-admin] user-override:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
