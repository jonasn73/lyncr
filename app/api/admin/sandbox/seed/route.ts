// POST /api/admin/sandbox/seed — idempotent Test Locksmith Co. workspace setup.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { seedSandboxData } from "@/lib/sandbox-engine"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const result = await seedSandboxData()
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[lyncr-admin] sandbox seed:", e)
    return NextResponse.json({ error: "Sandbox seed failed" }, { status: 500 })
  }
}
