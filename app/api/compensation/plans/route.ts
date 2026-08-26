// ============================================
// GET  /api/compensation/plans — live pay plans for this owner's roster
// POST /api/compensation/plans — set a worker's pay (supersedes their current plan)
// ============================================
// Owner-session API. Receptionists and field techs cannot read or set pay — theirs
// or anyone else's — so the role check comes before the worker lookup.
//
// A POST never edits a plan in place: it closes the live version and opens a new one
// effective now, leaving everything already earned pointing at the version that
// produced it.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getFieldTechnicianByIdForOwner, getReceptionist, getUser } from "@/lib/db"
import {
  CompensationPlanError,
  listLivePlansForOwner,
  savePlan,
} from "@/lib/compensation/plans"
import {
  describePayPlan,
  parsePayComponents,
  validatePayComponents,
  type EmploymentType,
  type WorkerRef,
} from "@/lib/compensation/plan-schema"

export const dynamic = "force-dynamic"

const EMPLOYMENT_TYPES = new Set<string>(["W2_EMPLOYEE", "CONTRACTOR_1099", "UNSPECIFIED"])

/** The session user, when they are an owner who may manage pay. */
async function requireOwner(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }
  const sessionUser = await getUser(userId)
  if (!sessionUser) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 401 }) }
  }
  if (sessionUser.account_role === "receptionist" || sessionUser.account_role === "field_tech") {
    return {
      error: NextResponse.json({ error: "Only business owners can manage pay" }, { status: 403 }),
    }
  }
  return { userId }
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req)
  if (auth.error) return auth.error

  try {
    const organizationId = req.nextUrl.searchParams.get("organization_id")?.trim() || null
    const plans = await listLivePlansForOwner(auth.userId, organizationId)
    return NextResponse.json({
      data: plans.map((plan) => ({ ...plan, summary: describePayPlan(plan.components) })),
    })
  } catch (e) {
    console.error("[GET /api/compensation/plans]", e)
    return NextResponse.json({ error: "Failed to load pay plans" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req)
  if (auth.error) return auth.error

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

  // Anything the parser drops was not a component we can pay on. Saying so beats
  // silently storing a shorter plan than the owner just built.
  const rawComponents = Array.isArray(body.components) ? body.components : []
  const components = parsePayComponents(rawComponents)
  if (components.length !== rawComponents.length) {
    return NextResponse.json(
      { error: "One of the pay rules is incomplete. Check every rate and amount." },
      { status: 400 }
    )
  }

  const validation = validatePayComponents(components, {
    employmentType: employmentType as EmploymentType,
  })
  if (validation.errors.length > 0) {
    return NextResponse.json(
      { error: validation.errors[0], details: validation.errors },
      { status: 400 }
    )
  }

  try {
    let ref: WorkerRef
    let workerUserId: string | null
    let organizationId: string | null = null

    if (receptionistId) {
      const receptionist = await getReceptionist(receptionistId)
      if (!receptionist || receptionist.user_id !== auth.userId) {
        return NextResponse.json({ error: "Receptionist not found" }, { status: 404 })
      }
      ref = { role: "receptionist", receptionist_id: receptionist.id }
      workerUserId = receptionist.portal_user_id ?? null
    } else {
      const technician = await getFieldTechnicianByIdForOwner(auth.userId, technicianId)
      if (!technician) {
        return NextResponse.json({ error: "Technician not found" }, { status: 404 })
      }
      ref = { role: "field_tech", field_technician_id: technician.id }
      workerUserId = technician.portal_user_id ?? null
      organizationId = technician.organization_id ?? null
    }

    const plan = await savePlan({
      ownerUserId: auth.userId,
      organizationId,
      ref,
      workerUserId,
      employmentType: employmentType as EmploymentType,
      components,
      createdBy: auth.userId,
    })

    return NextResponse.json({
      data: {
        ...plan,
        summary: describePayPlan(plan.components),
        // Surfaced, not blocking — a W-2 plan with no wage floor is the owner's call.
        warnings: validation.warnings,
      },
    })
  } catch (e) {
    if (e instanceof CompensationPlanError) {
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status })
    }
    console.error("[POST /api/compensation/plans]", e)
    return NextResponse.json({ error: "Failed to save pay plan" }, { status: 500 })
  }
}
