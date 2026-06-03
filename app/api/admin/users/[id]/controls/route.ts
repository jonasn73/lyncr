// ============================================
// GET / PATCH / DELETE /api/admin/users/[id]/controls
// ============================================
// Tenant drawer overrides (admin@lyncr.app only):
//   GET    → current feature flags + provisioned phone lines
//   PATCH  → toggle one feature flag ({ flag, enabled })
//   DELETE → release one provisioned line back to the pool ({ lineId })

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  ADMIN_FEATURE_FLAGS,
  getPhoneNumbers,
  getProfileFeatureFlags,
  markPhoneNumberReleasedForUser,
  setProfileFeatureFlag,
} from "@/lib/db"
import type { AdminTenantControls } from "@/lib/types"

export const dynamic = "force-dynamic"

async function loadControls(userId: string): Promise<AdminTenantControls> {
  const [feature_flags, lines] = await Promise.all([getProfileFeatureFlags(userId), getPhoneNumbers(userId)])
  const phone_lines = lines
    .filter((l) => l.status !== "released")
    .map((l) => ({
      id: l.id,
      number: l.number,
      label: l.label || "Line",
      status: l.status,
      type: l.type,
    }))
  return { feature_flags, phone_lines }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  try {
    return NextResponse.json({ data: await loadControls(id) })
  } catch (e) {
    console.error("[admin/controls] GET:", e)
    return NextResponse.json({ error: "Could not load tenant controls" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { flag?: string; enabled?: boolean }
  const flag = String(body.flag || "").trim()
  if (!(ADMIN_FEATURE_FLAGS as readonly string[]).includes(flag)) {
    return NextResponse.json({ error: "Unknown feature flag" }, { status: 400 })
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  try {
    const feature_flags = await setProfileFeatureFlag(id, flag, body.enabled)
    return NextResponse.json({ data: { feature_flags } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not update feature flag"
    console.error("[admin/controls] PATCH:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireLyncrAdmin(req)
  if (guard instanceof NextResponse) return guard
  const { id } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { lineId?: string }
  const lineId = String(body.lineId || "").trim()
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 })

  try {
    const released = await markPhoneNumberReleasedForUser(lineId, id)
    if (!released) {
      return NextResponse.json({ error: "Line not found or not active" }, { status: 404 })
    }
    return NextResponse.json({ data: await loadControls(id) })
  } catch (e) {
    console.error("[admin/controls] DELETE:", e)
    return NextResponse.json({ error: "Could not release line" }, { status: 500 })
  }
}
