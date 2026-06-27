// GET /api/admin/receptionists — operator onboarding roster for platform admin.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { listOperatorOnboardingRows } from "@/lib/operator-onboarding"

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const rows = await listOperatorOnboardingRows()
    return NextResponse.json({ data: { operators: rows } })
  } catch (e) {
    console.error("[admin/receptionists GET]", e)
    return NextResponse.json({ error: "Could not load operators." }, { status: 500 })
  }
}
