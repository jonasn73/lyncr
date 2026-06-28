// GET/PATCH/DELETE /api/admin/receptionists/[id] — operator detail, disable, delete.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  deleteOperatorAdmin,
  disableOperatorAdmin,
  enableOperatorAdmin,
  getOperatorAdminRow,
} from "@/lib/operator-onboarding"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: RouteContext) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { id } = await context.params
  try {
    const operator = await getOperatorAdminRow(id)
    if (!operator) {
      return NextResponse.json({ error: "Operator not found." }, { status: 404 })
    }
    return NextResponse.json({ data: { operator } })
  } catch (e) {
    console.error("[admin/receptionists GET id]", e)
    return NextResponse.json({ error: "Could not load operator." }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { id } = await context.params
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(body.action ?? "").trim().toLowerCase()

    if (action === "disable") {
      const ok = await disableOperatorAdmin(id)
      if (!ok) return NextResponse.json({ error: "Operator not found." }, { status: 404 })
      const operator = await getOperatorAdminRow(id)
      return NextResponse.json({ data: { operator, message: "Operator disabled." } })
    }

    if (action === "enable") {
      const ok = await enableOperatorAdmin(id)
      if (!ok) return NextResponse.json({ error: "Operator not found." }, { status: 404 })
      const operator = await getOperatorAdminRow(id)
      return NextResponse.json({ data: { operator, message: "Operator re-enabled." } })
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  } catch (e) {
    console.error("[admin/receptionists PATCH]", e)
    return NextResponse.json({ error: "Could not update operator." }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const { id } = await context.params
  try {
    const ok = await deleteOperatorAdmin(id)
    if (!ok) return NextResponse.json({ error: "Operator not found." }, { status: 404 })
    return NextResponse.json({ data: { deleted: true } })
  } catch (e) {
    console.error("[admin/receptionists DELETE]", e)
    return NextResponse.json({ error: "Could not delete operator." }, { status: 500 })
  }
}
