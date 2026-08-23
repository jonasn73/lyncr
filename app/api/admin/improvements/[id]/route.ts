// ============================================
// PATCH  /api/admin/improvements/[id] — edit fields, move status, mark done
// DELETE /api/admin/improvements/[id] — take it off the board
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  deleteAppImprovement,
  isValidAppImprovementPriority,
  isValidAppImprovementStatus,
  updateAppImprovement,
  updateAppImprovementStatus,
} from "@/lib/app-improvements"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({}))

    // Status-only move (board quick-action) — smaller payload, no other fields required.
    const statusOnly =
      typeof body?.status === "string" &&
      body?.title === undefined &&
      body?.description === undefined &&
      body?.category === undefined &&
      body?.priority === undefined
    if (statusOnly) {
      if (!isValidAppImprovementStatus(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      const item = await updateAppImprovementStatus(id, body.status)
      if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ data: item })
    }

    // Full edit — client sends the complete edited item.
    const title = String(body?.title ?? "").trim()
    if (title.length < 3) {
      return NextResponse.json({ error: "Title must be at least 3 characters" }, { status: 400 })
    }
    const status = String(body?.status ?? "backlog").trim()
    const priority = String(body?.priority ?? "medium").trim()
    if (!isValidAppImprovementStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    if (!isValidAppImprovementPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 })
    }
    const item = await updateAppImprovement(id, {
      title,
      description: body?.description != null ? String(body.description) : null,
      category: String(body?.category ?? "general").trim() || "general",
      status,
      priority,
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ data: item })
  } catch (e) {
    console.error("[admin/improvements/:id] PATCH:", e)
    return NextResponse.json({ error: "Could not update the improvement" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  try {
    const ok = await deleteAppImprovement(id)
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ data: { deleted: true } })
  } catch (e) {
    console.error("[admin/improvements/:id] DELETE:", e)
    return NextResponse.json({ error: "Could not remove the improvement" }, { status: 500 })
  }
}
