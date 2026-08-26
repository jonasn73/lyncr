// POST /api/compensation/plans/preview — what a proposed plan would have cost.
//
// Read-only. Replays the plan against the worker's real calls and jobs so an owner can
// price it before anyone signs to it. Never writes a plan, an agreement, or a ledger row.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getFieldTechnicianByIdForOwner, getReceptionist, getUser } from "@/lib/db"
import { previewPlanCost } from "@/lib/compensation/preview"
import {
  parsePayComponents,
  type EmploymentType,
  type WorkerRef,
} from "@/lib/compensation/plan-schema"

export const dynamic = "force-dynamic"

const EMPLOYMENT_TYPES = new Set<string>(["W2_EMPLOYEE", "CONTRACTOR_1099", "UNSPECIFIED"])

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const sessionUser = await getUser(userId)
  if (!sessionUser) return NextResponse.json({ error: "User not found" }, { status: 401 })
  if (sessionUser.account_role === "receptionist" || sessionUser.account_role === "field_tech") {
    return NextResponse.json({ error: "Only business owners can price pay plans" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const receptionistId = String(body.receptionist_id ?? "").trim()
  const technicianId = String(body.field_technician_id ?? "").trim()
  if (Boolean(receptionistId) === Boolean(technicianId)) {
    return NextResponse.json(
      { error: "Pass exactly one of receptionist_id or field_technician_id." },
      { status: 400 }
    )
  }

  const employmentType = String(body.employment_type ?? "UNSPECIFIED").trim().toUpperCase()
  if (!EMPLOYMENT_TYPES.has(employmentType)) {
    return NextResponse.json({ error: "Unrecognized employment type." }, { status: 400 })
  }

  const components = parsePayComponents(Array.isArray(body.components) ? body.components : [])
  if (components.length === 0) {
    return NextResponse.json({ error: "Add a pay rule to price it." }, { status: 400 })
  }

  try {
    let ref: WorkerRef
    if (receptionistId) {
      const receptionist = await getReceptionist(receptionistId)
      if (!receptionist || receptionist.user_id !== userId) {
        return NextResponse.json({ error: "Receptionist not found" }, { status: 404 })
      }
      ref = { role: "receptionist", receptionist_id: receptionist.id }
    } else {
      const technician = await getFieldTechnicianByIdForOwner(userId, technicianId)
      if (!technician) {
        return NextResponse.json({ error: "Technician not found" }, { status: 404 })
      }
      ref = { role: "field_tech", field_technician_id: technician.id }
    }

    const preview = await previewPlanCost({
      ref,
      components,
      employmentType: employmentType as EmploymentType,
      windowDays: Number(body.window_days) || 30,
      assumedWeeklyHours: Number(body.assumed_weekly_hours) || 0,
    })

    return NextResponse.json({ data: preview })
  } catch (e) {
    console.error("[POST /api/compensation/plans/preview]", e)
    return NextResponse.json({ error: "Could not price this plan" }, { status: 500 })
  }
}
