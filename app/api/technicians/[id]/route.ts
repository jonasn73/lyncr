// ============================================
// PATCH  /api/technicians/[id] — toggle active or move tech to another workspace
// DELETE /api/technicians/[id] — remove tech from the owner roster
// ============================================

import { DEFAULT_FIELD_TECH_CAPABILITIES } from "@/lib/field-technician-capabilities"
import { setFieldTechnicianCapabilities } from "@/lib/db"
import type { FieldTechnicianCapabilities } from "@/lib/types"
import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  deleteFieldTechnicianForOwner,
  patchFieldTechnicianForOwner,
  updateFieldTechnicianProfile,
} from "@/lib/db"

export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as {
    is_active?: boolean
    organization_id?: string | null
    capabilities?: Partial<FieldTechnicianCapabilities>
    name?: string
    phone?: string
    address?: string | null
  }

  // Only keys the registry knows, and only booleans — same shape the receptionist route
  // uses, so adding a capability stays "add a default + a label".
  const capabilityPatch: Partial<FieldTechnicianCapabilities> = {}
  if (body.capabilities && typeof body.capabilities === "object") {
    for (const key of Object.keys(DEFAULT_FIELD_TECH_CAPABILITIES) as (keyof FieldTechnicianCapabilities)[]) {
      const value = (body.capabilities as Record<string, unknown>)[key]
      if (typeof value === "boolean") capabilityPatch[key] = value
    }
  }
  const hasCapabilityPatch = Object.keys(capabilityPatch).length > 0

  const profilePatch: { name?: string; phone?: string; address?: string | null } = {}
  if (typeof body.name === "string" && body.name.trim().length >= 2) profilePatch.name = body.name.trim()
  if (typeof body.phone === "string" && body.phone.trim()) profilePatch.phone = body.phone.trim()
  if (body.address !== undefined) profilePatch.address = typeof body.address === "string" ? body.address.trim() || null : null
  const hasProfilePatch = Object.keys(profilePatch).length > 0

  if (
    typeof body.is_active !== "boolean" &&
    body.organization_id === undefined &&
    !hasCapabilityPatch &&
    !hasProfilePatch
  ) {
    return NextResponse.json(
      { error: "Provide is_active (boolean), organization_id, name, phone, address, and/or capabilities" },
      { status: 400 }
    )
  }

  if (hasProfilePatch) {
    const ok = await updateFieldTechnicianProfile(userId, id, profilePatch)
    if (!ok) return NextResponse.json({ error: "Technician not found" }, { status: 404 })
    if (typeof body.is_active !== "boolean" && body.organization_id === undefined && !hasCapabilityPatch) {
      return NextResponse.json({ data: { ok: true } })
    }
  }

  if (hasCapabilityPatch) {
    const saved = await setFieldTechnicianCapabilities(userId, id, capabilityPatch)
    if (!saved) return NextResponse.json({ error: "Technician not found" }, { status: 404 })
    if (typeof body.is_active !== "boolean" && body.organization_id === undefined) {
      return NextResponse.json({ data: { ok: true } })
    }
  }

  try {
    const ok = await patchFieldTechnicianForOwner(userId, id, {
      ...(typeof body.is_active === "boolean" ? { is_active: body.is_active } : {}),
      ...(body.organization_id !== undefined ? { organization_id: body.organization_id } : {}),
    })
    if (!ok) {
      return NextResponse.json({ error: "Technician not found or workspace invalid" }, { status: 404 })
    }
    return NextResponse.json({
      data: {
        id,
        ...(typeof body.is_active === "boolean" ? { is_active: body.is_active } : {}),
        ...(body.organization_id !== undefined ? { organization_id: body.organization_id } : {}),
      },
    })
  } catch (e) {
    console.error("[PATCH /api/technicians/[id]] failed:", e)
    return NextResponse.json({ error: "Could not update technician" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(_req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await ctx.params
  try {
    const ok = await deleteFieldTechnicianForOwner(userId, id)
    if (!ok) {
      return NextResponse.json({ error: "Technician not found" }, { status: 404 })
    }
    return NextResponse.json({ data: { deleted: true, id } })
  } catch (e) {
    console.error("[DELETE /api/technicians/[id]] failed:", e)
    return NextResponse.json({ error: "Could not remove technician" }, { status: 500 })
  }
}
