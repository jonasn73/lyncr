// GET /api/payments/record-invoices
// List paid-outside (Venmo/cash) invoices for the logged-in owner.
// Query: customerId?, jobId?, q? (name/phone/invoice #), limit?

import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceActor } from "@/lib/workspace-actor"
import {
  jobRecordInvoiceToApi,
  listJobRecordInvoicesForOwner,
} from "@/lib/job-record-invoice"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const actor = await resolveWorkspaceActor(req.headers.get("cookie"), {
    capability: "invoicing",
  })
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const userId = actor.ownerUserId

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get("customerId")
  const jobId = searchParams.get("jobId")
  const q = searchParams.get("q")
  const limitRaw = searchParams.get("limit")
  const limit = limitRaw ? Number(limitRaw) : 50

  try {
    const rows = await listJobRecordInvoicesForOwner({
      ownerUserId: userId,
      customerId,
      jobId,
      q,
      limit,
    })
    return NextResponse.json({
      data: { invoices: rows.map(jobRecordInvoiceToApi) },
    })
  } catch (e) {
    console.error("[payments/record-invoices GET]", e)
    const message = e instanceof Error ? e.message : "Could not load invoices"
    const migration = /migration 13[23]/i.test(message)
      ? /133/.test(message)
        ? "scripts/133-job-record-invoice-history.sql"
        : "scripts/132-job-record-invoices.sql"
      : undefined
    return NextResponse.json(
      { error: message, migration },
      { status: migration ? 503 : 500 }
    )
  }
}
