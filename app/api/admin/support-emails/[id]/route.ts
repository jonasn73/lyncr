// GET / PATCH /api/admin/support-emails/[id] — detail + mark read (admin only).

import { NextRequest, NextResponse } from "next/server"
import { getAdminSupportEmailById, markAdminSupportEmailRead } from "@/lib/db"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const item = await getAdminSupportEmailById(id)
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ data: item })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { read?: boolean }
    const read = body.read !== false
    const updated = await markAdminSupportEmailRead(id, read)
    if (!updated) {
      return NextResponse.json(
        { error: "Not found or run scripts/127-admin-support-emails.sql in Neon" },
        { status: 404 }
      )
    }
    return NextResponse.json({ data: updated })
  } catch (e) {
    console.error("[lyncr] admin support-emails PATCH:", e)
    return NextResponse.json({ error: "Failed to update" }, { status: 500 })
  }
}
