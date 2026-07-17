// ============================================
// POST /api/tech/invoice
// ============================================
// Field tech raises an itemized invoice on-site and optionally records a payment. Card processing
// runs through the OWNER's merchant configuration — until that's connected we record the charge
// (no full card number is ever sent to or stored on our server; only the last 4).

import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import {
  createJobInvoice,
  getFieldTechnicianByPortalUserId,
  getOwnerIdForLead,
  getOwnerMerchantConfigured,
  getUser,
  listJobsForTech,
  setJobStatusForTech,
} from "@/lib/db"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { onJobStateChange } from "@/lib/sms-pipeline"
import { createWalletTransaction, walletStatusFromInvoice } from "@/lib/tech-wallet"
import type { InvoiceLineItem, JobInvoice } from "@/lib/types"

export const dynamic = "force-dynamic"

type Body = {
  leadId?: string
  lineItems?: { label?: string; amountCents?: number }[]
  taxCents?: number
  paymentMethod?: "card" | "cash" | "none"
  cardLast4?: string
  collectNow?: boolean
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user || user.account_role !== "field_tech") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tech = await getFieldTechnicianByPortalUserId(userId)
  if (!tech) return NextResponse.json({ error: "Technician not linked" }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Body
  const leadId = String(body.leadId || "").trim()
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 })

  // Make sure this job is actually assigned to this tech before invoicing it.
  const jobs = await listJobsForTech(userId)
  const job = jobs.find((j) => j.id === leadId)
  if (!job) return NextResponse.json({ error: "Job not assigned to you" }, { status: 404 })

  // Sanitize line items.
  const lineItems: InvoiceLineItem[] = (body.lineItems || [])
    .map((li) => ({
      label: String(li.label || "").trim().slice(0, 120),
      amount_cents: Math.max(0, Math.round(Number(li.amountCents) || 0)),
    }))
    .filter((li) => li.label.length > 0)
  if (lineItems.length === 0) {
    return NextResponse.json({ error: "Add at least one line item" }, { status: 400 })
  }

  const subtotal = lineItems.reduce((sum, li) => sum + li.amount_cents, 0)
  const taxCents = Math.max(0, Math.round(Number(body.taxCents) || 0))
  const total = subtotal + taxCents

  const method: Body["paymentMethod"] = body.paymentMethod || "none"
  const collectNow = Boolean(body.collectNow)
  const merchantConfigured = await getOwnerMerchantConfigured(tech.owner_user_id)

  // Resolve a payment status without ever touching a full card number.
  let paymentStatus: JobInvoice["payment_status"] = "unpaid"
  if (collectNow && method === "cash") paymentStatus = "paid"
  else if (collectNow && method === "card") paymentStatus = merchantConfigured ? "pending" : "recorded"

  const last4 = (body.cardLast4 || "").replace(/\D/g, "").slice(-4) || null

  try {
    const invoice = await createJobInvoice({
      lead_id: leadId,
      owner_user_id: tech.owner_user_id,
      tech_user_id: userId,
      customer_name: job.customer_name,
      customer_phone: job.customer_phone,
      line_items: lineItems,
      subtotal_cents: subtotal,
      tax_cents: taxCents,
      total_cents: total,
      payment_status: paymentStatus,
      payment_method: method,
      card_last4: method === "card" ? last4 : null,
    })

    // Completing the invoice closes out the job.
    await setJobStatusForTech(userId, leadId, "completed").catch(() => {})

    // Credit the tech wallet when payment was collected on-site.
    if (collectNow && method !== "none" && total > 0) {
      const wallet = walletStatusFromInvoice({
        paymentStatus,
        paymentMethod: method,
      })
      await createWalletTransaction({
        userId,
        jobId: leadId,
        amountUsd: total / 100,
        status: wallet.status,
        paymentMethod: wallet.paymentMethod,
      }).catch((e) => console.warn("[invoice] wallet transaction failed:", e))
    }

    const ownerId = await getOwnerIdForLead(leadId)
    if (ownerId) {
      await publishOwnerEvent(ownerId, "job-status-updated", {
        leadId,
        status: "completed",
        invoiceTotalCents: total,
        paymentStatus,
      }).catch(() => {})
    }

    // Finishing the job schedules the post-job review request (drops ~15 min later if enabled).
    after(async () => {
      try {
        await onJobStateChange("COMPLETED", { leadId, expectedOwnerUserId: tech.owner_user_id })
      } catch (e) {
        console.warn("[invoice] COMPLETED review SMS pipeline failed:", e)
      }
    })

    return NextResponse.json({
      data: {
        invoice,
        card_capture_active: method === "card" && merchantConfigured,
      },
    })
  } catch (e) {
    console.error("[POST /api/tech/invoice] failed:", e)
    return NextResponse.json({ error: "Could not save invoice" }, { status: 500 })
  }
}
