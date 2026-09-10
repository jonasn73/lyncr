// ============================================
// GET  /api/compensation/payouts — amount owed now + payout history for one worker
// POST /api/compensation/payouts — record that the owner paid a worker outside the app
// ============================================
// Owner-session API, same shape as /api/compensation/plans — receptionists and field
// techs cannot read or record a payout for themselves or anyone else.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getFieldTechnicianByIdForOwner, getReceptionist, getUser } from "@/lib/db"
import {
  getEarningsTotal,
  listWorkerPayouts,
  recordWorkerPayout,
  type WorkerPayoutMethod,
} from "@/lib/compensation/ledger"
import type { WorkerRef } from "@/lib/compensation/plan-schema"
import { sendWorkerPayoutSms } from "@/lib/worker-payout-sms"
import { recordAuditEvent } from "@/lib/audit-log"

export const dynamic = "force-dynamic"

const EPOCH_ISO = new Date(0).toISOString()
const METHODS = new Set<string>(["CASH", "VENMO", "ZELLE", "CHECK", "PAYROLL", "OTHER"])

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
      error: NextResponse.json({ error: "Only business owners can manage payouts" }, { status: 403 }),
    }
  }
  return { userId }
}

/** Resolves + ownership-checks the worker ref from either id query param / body field. */
async function resolveWorkerRef(
  ownerUserId: string,
  receptionistId: string,
  technicianId: string
): Promise<{ ref: WorkerRef; workerUserId: string | null; organizationId: string | null } | null> {
  if (receptionistId) {
    const receptionist = await getReceptionist(receptionistId)
    if (!receptionist || receptionist.user_id !== ownerUserId) return null
    return {
      ref: { role: "receptionist", receptionist_id: receptionist.id },
      workerUserId: receptionist.portal_user_id ?? null,
      organizationId: null,
    }
  }
  const technician = await getFieldTechnicianByIdForOwner(ownerUserId, technicianId)
  if (!technician) return null
  return {
    ref: { role: "field_tech", field_technician_id: technician.id },
    workerUserId: technician.portal_user_id ?? null,
    organizationId: technician.organization_id ?? null,
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req)
  if (auth.error) return auth.error

  const receptionistId = req.nextUrl.searchParams.get("receptionist_id")?.trim() || ""
  const technicianId = req.nextUrl.searchParams.get("field_technician_id")?.trim() || ""
  if (Boolean(receptionistId) === Boolean(technicianId)) {
    return NextResponse.json(
      { error: "Pass exactly one of receptionist_id or field_technician_id." },
      { status: 400 }
    )
  }

  try {
    const resolved = await resolveWorkerRef(auth.userId, receptionistId, technicianId)
    if (!resolved) return NextResponse.json({ error: "Worker not found" }, { status: 404 })

    const [total, payouts] = await Promise.all([
      getEarningsTotal(resolved.ref, EPOCH_ISO, new Date().toISOString()),
      listWorkerPayouts(resolved.ref),
    ])

    return NextResponse.json({
      data: {
        owedCents: total.cents,
        payouts: payouts.map((row) => ({
          id: row.id,
          amountCents: Math.abs(row.amount_cents),
          method: (row.rate_snapshot as { method?: string })?.method ?? "OTHER",
          note: (row.rate_snapshot as { note?: string | null })?.note ?? null,
          paidAt: row.earned_at,
        })),
      },
    })
  } catch (e) {
    console.error("[GET /api/compensation/payouts]", e)
    return NextResponse.json({ error: "Failed to load payouts" }, { status: 500 })
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

  const amountCents = Math.round(Number(body.amountCents))
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than $0." }, { status: 400 })
  }

  const methodRaw = String(body.method ?? "").trim().toUpperCase()
  if (!METHODS.has(methodRaw)) {
    return NextResponse.json({ error: "Unrecognized payout method." }, { status: 400 })
  }
  const method = methodRaw as WorkerPayoutMethod
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 280) || null : null

  try {
    const resolved = await resolveWorkerRef(auth.userId, receptionistId, technicianId)
    if (!resolved) return NextResponse.json({ error: "Worker not found" }, { status: 404 })

    const paidAt = new Date().toISOString()
    const row = await recordWorkerPayout({
      ownerUserId: auth.userId,
      organizationId: resolved.organizationId,
      ref: resolved.ref,
      workerUserId: resolved.workerUserId,
      amountCents,
      method,
      note,
      paidByUserId: auth.userId,
      paidAt,
    })

    void recordAuditEvent({
      ownerUserId: auth.userId,
      actorUserId: auth.userId,
      actorRole: "owner",
      eventType: "payout.recorded",
      entityType: "worker_payout",
      entityId: row.id,
      detail: {
        worker_role: resolved.ref.role,
        worker_id:
          resolved.ref.role === "receptionist"
            ? resolved.ref.receptionist_id
            : resolved.ref.field_technician_id,
        amount_cents: amountCents,
        method,
      },
    })

    // Best-effort — a missing/invalid phone should not fail the payout record itself.
    const sms = await sendWorkerPayoutSms({
      ownerUserId: auth.userId,
      ref: resolved.ref,
      amountCents,
      method,
      note,
    })

    // A fresh timestamp, not `paidAt` — getEarningsTotal's end bound is exclusive, so reusing
    // the payout row's own earned_at would exclude the row we just wrote.
    const total = await getEarningsTotal(resolved.ref, EPOCH_ISO, new Date().toISOString())

    return NextResponse.json({
      data: {
        owedCents: total.cents,
        smsSent: sms.ok,
      },
    })
  } catch (e) {
    console.error("[POST /api/compensation/payouts]", e)
    return NextResponse.json({ error: "Failed to record payout" }, { status: 500 })
  }
}
