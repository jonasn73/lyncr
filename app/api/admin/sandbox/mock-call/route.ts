// POST /api/admin/sandbox/mock-call — simulate inbound call for sandbox line.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { triggerMockCall } from "@/lib/sandbox-engine"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  try {
    const body = (await req.json().catch(() => ({}))) as { businessLineId?: string }
    const businessLineId = String(body.businessLineId ?? "").trim()
    if (!businessLineId) {
      return NextResponse.json({ error: "businessLineId is required" }, { status: 400 })
    }

    const result = await triggerMockCall(businessLineId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ data: result })
  } catch (e) {
    console.error("[lyncr-admin] sandbox mock-call:", e)
    return NextResponse.json({ error: "Mock call failed" }, { status: 500 })
  }
}
