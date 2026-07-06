// POST /api/ai-leads/[id]/convert — move CRM lead into the scheduler hopper.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { convertAiLeadToUnassignedPool } from "@/lib/db"
import { notifyWorkspaceDataChanged } from "@/lib/workspace-organizations"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteParams) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { id } = await context.params
  const leadId = id?.trim()
  if (!leadId) return NextResponse.json({ error: "Lead id is required" }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { organization_id?: string | null }
  const orgRaw = body.organization_id?.trim() || null
  const organizationId = orgRaw && !orgRaw.startsWith("legacy-") ? orgRaw : null

  try {
    const ok = await convertAiLeadToUnassignedPool({
      ownerUserId: userId,
      leadId,
      organizationId,
    })
    if (!ok) return NextResponse.json({ error: "Lead not found" }, { status: 404 })
    notifyWorkspaceDataChanged({ reason: "crm-lead-converted", organizationId })
    return NextResponse.json({ data: { id: leadId, dispatch_status: "unassigned_pool" } })
  } catch (e) {
    console.error("[POST /api/ai-leads/[id]/convert]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not convert lead." },
      { status: 500 }
    )
  }
}
