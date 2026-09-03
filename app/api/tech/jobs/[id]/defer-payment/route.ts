// PATCH /api/tech/jobs/[id]/defer-payment — tech taps "Office will collect" on a card job.
// He never runs a card himself: this just flags the job so office knows to call/text a pay
// link, and the tech's console shows a waiting banner until payment clears.

import { NextRequest, NextResponse } from "next/server"
import { resolveActor } from "@/lib/actor"
import { deferPaymentToOfficeForTech, getOwnerIdForLead } from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  const actor = await resolveActor(req.headers.get("cookie"), { allowFieldTech: true })
  if (!actor || actor.actorRole !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Acts as the tech, not the business — scoped to their own assigned job.
  const userId = actor.actingUserId

  const { id: leadId } = await context.params
  if (!leadId?.trim()) return NextResponse.json({ error: "Missing job id" }, { status: 400 })

  try {
    const ok = await deferPaymentToOfficeForTech(userId, leadId.trim())
    if (!ok) {
      return NextResponse.json(
        { error: "Job not found, not assigned to you, or not yet marked work complete" },
        { status: 404 }
      )
    }

    const ownerId = await getOwnerIdForLead(leadId.trim())
    if (ownerId) {
      await publishOwnerEvent(ownerId, "job-status-updated", {
        leadId: leadId.trim(),
        status: "work_complete",
        paymentPendingRemote: true,
      }).catch(() => {})
    }

    return NextResponse.json({ data: { id: leadId.trim(), payment_pending_remote: true } })
  } catch (e) {
    console.error("[PATCH /api/tech/jobs/[id]/defer-payment]", e)
    return NextResponse.json({ error: "Could not defer payment" }, { status: 500 })
  }
}
