// ============================================
// GET  /api/admin/improvements — list the app improvement board
// POST /api/admin/improvements — log a new improvement
// ============================================

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  createAppImprovement,
  isValidAppImprovementPriority,
  isValidAppImprovementStatus,
  listAppImprovements,
} from "@/lib/app-improvements"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const items = await listAppImprovements()
    return NextResponse.json({ data: { items } })
  } catch (e) {
    console.error("[admin/improvements] GET:", e)
    return NextResponse.json({ error: "Could not load the improvement board" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json().catch(() => ({}))
    const title = String(body?.title ?? "").trim()
    if (title.length < 3) {
      return NextResponse.json({ error: "Title must be at least 3 characters" }, { status: 400 })
    }
    const statusRaw = String(body?.status ?? "backlog").trim()
    const priorityRaw = String(body?.priority ?? "medium").trim()
    if (statusRaw && !isValidAppImprovementStatus(statusRaw)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    if (priorityRaw && !isValidAppImprovementPriority(priorityRaw)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 })
    }
    const item = await createAppImprovement({
      title,
      description: body?.description != null ? String(body.description) : null,
      category: body?.category != null ? String(body.category) : null,
      status: isValidAppImprovementStatus(statusRaw) ? statusRaw : undefined,
      priority: isValidAppImprovementPriority(priorityRaw) ? priorityRaw : undefined,
      source: body?.source != null ? String(body.source) : null,
      createdByUserId: ctx.userId,
    })
    if (!item) {
      return NextResponse.json(
        { error: "Improvement board is not set up — run scripts/140-app-improvements-board.sql in Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ data: item })
  } catch (e) {
    console.error("[admin/improvements] POST:", e)
    return NextResponse.json({ error: "Could not save the improvement" }, { status: 500 })
  }
}
