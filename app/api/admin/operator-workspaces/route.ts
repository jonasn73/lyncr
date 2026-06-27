// GET /api/admin/operator-workspaces — tenant workspaces for operator invite picker.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listAdminOperatorWorkspaceOptions } from "@/lib/db"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const workspaces = await listAdminOperatorWorkspaceOptions()
    return NextResponse.json({ data: { workspaces } })
  } catch (e) {
    console.error("[admin/operator-workspaces GET]", e)
    return NextResponse.json({ error: "Could not load workspaces." }, { status: 500 })
  }
}
