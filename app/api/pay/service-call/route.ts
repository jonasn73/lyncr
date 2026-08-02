// GET/POST /api/pay/service-call
// Public: load prefills from pay token, save dispatch form, return checkout URL.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getCollectPayLinkByToken, getUser } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { SERVICE_CALL_FEE_CENTS, SERVICE_CALL_FEE_DOLLARS } from "@/lib/service-call-fee"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

type LeadRow = {
  id: string
  user_id: string
  caller_e164: string | null
  collected: Record<string, unknown> | null
}

async function loadLead(jobId: string): Promise<LeadRow | null> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT id, user_id, caller_e164, collected
      FROM ai_leads
      WHERE id = ${jobId}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    const collected =
      row.collected && typeof row.collected === "object"
        ? (row.collected as Record<string, unknown>)
        : {}
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      caller_e164: row.caller_e164 != null ? String(row.caller_e164) : null,
      collected,
    }
  } catch (e) {
    console.warn("[pay/service-call] lead load failed:", e)
    return null
  }
}

/** Resolve opaque pay token → business label + optional lead prefills. */
export async function GET(req: NextRequest) {
  const token = String(req.nextUrl.searchParams.get("p") || "").trim()
  if (!token || token.length < 6) {
    return NextResponse.json({ error: "Invalid link." }, { status: 400 })
  }

  const link = await getCollectPayLinkByToken(token)
  if (!link) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask the shop for a new one." },
      { status: 404 }
    )
  }

  let businessLabel = link.business_label?.trim() || ""
  if (link.owner_user_id) {
    const owner = await getUser(link.owner_user_id)
    businessLabel =
      owner?.business_name?.trim() || owner?.name?.trim() || businessLabel || "Your locksmith"
  }

  let prefill: Record<string, string> = {
    customer_name: link.customer_name || "",
    phone: "",
    address: "",
    vehicle_year: "",
    vehicle_make: "",
    vehicle_model: "",
    job_kind: "",
    notes: "",
  }

  if (link.job_id) {
    const lead = await loadLead(link.job_id)
    if (lead) {
      const c = lead.collected || {}
      prefill = {
        customer_name: String(c.customer_name || link.customer_name || "").trim(),
        phone: String(lead.caller_e164 || c.phone || "").trim(),
        address: String(
          c.job_address_formatted ||
            c.address ||
            [c.address_line1, c.city, c.region, c.postal_code].filter(Boolean).join(", ") ||
            ""
        ).trim(),
        vehicle_year: String(c.vehicle_year || c.year || "").trim(),
        vehicle_make: String(c.vehicle_make || c.make || "").trim(),
        vehicle_model: String(c.vehicle_model || c.model || "").trim(),
        job_kind: String(c.service_call_job_kind || c.key_replacement_mode || "").trim(),
        notes: String(c.service_call_notes || c.notes || "").trim(),
      }
    }
  }

  return NextResponse.json({
    data: {
      business_label: businessLabel || "Your locksmith",
      charge_cents: link.charge_cents || SERVICE_CALL_FEE_CENTS,
      amount_dollars: SERVICE_CALL_FEE_DOLLARS,
      pay_token: token,
      pay_url: `${getAppUrl().replace(/\/$/, "")}/pay/${token}`,
      prefill,
    },
  })
}

type PostBody = {
  p?: string
  customer_name?: string
  phone?: string
  address?: string
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  /** "copy" | "akl" | "lockout" | "other" */
  job_kind?: string
  notes?: string
}

/** Save form fields onto the linked lead (when present), then return /pay/{token}. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PostBody
  const token = String(body.p ?? "").trim()
  if (!token || token.length < 6) {
    return NextResponse.json({ error: "Invalid link." }, { status: 400 })
  }

  const link = await getCollectPayLinkByToken(token)
  if (!link) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask the shop for a new one." },
      { status: 404 }
    )
  }

  const customerName = String(body.customer_name ?? "").trim().slice(0, 120)
  const phone = String(body.phone ?? "").trim().slice(0, 40)
  const address = String(body.address ?? "").trim().slice(0, 240)
  const year = String(body.vehicle_year ?? "").trim().slice(0, 8)
  const make = String(body.vehicle_make ?? "").trim().slice(0, 60)
  const model = String(body.vehicle_model ?? "").trim().slice(0, 60)
  const jobKind = String(body.job_kind ?? "").trim().toLowerCase().slice(0, 40)
  const notes = String(body.notes ?? "").trim().slice(0, 800)

  if (!customerName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (!phone) {
    return NextResponse.json({ error: "Phone is required" }, { status: 400 })
  }
  if (!address) {
    return NextResponse.json({ error: "Address is required so a tech can be on the way" }, { status: 400 })
  }

  // Best-effort: merge form into ai_leads.collected when this pay link is tied to a job
  if (link.job_id) {
    const lead = await loadLead(link.job_id)
    if (lead) {
      const prev = lead.collected || {}
      const next = {
        ...prev,
        customer_name: customerName,
        phone,
        job_address_formatted: address,
        address,
        vehicle_year: year || prev.vehicle_year,
        vehicle_make: make || prev.vehicle_make,
        vehicle_model: model || prev.vehicle_model,
        service_call_job_kind: jobKind || prev.service_call_job_kind,
        service_call_notes: notes,
        service_call_fee_cents: SERVICE_CALL_FEE_CENTS,
        service_call_form_submitted_at: new Date().toISOString(),
      }
      const sql = sqlClient()
      try {
        await sql`
          UPDATE ai_leads
          SET collected = ${JSON.stringify(next)}::jsonb
          WHERE id = ${lead.id}
        `
      } catch (e) {
        console.warn("[pay/service-call] lead update failed:", e)
      }
    }
  }

  const payUrl = `${getAppUrl().replace(/\/$/, "")}/pay/${token}`
  return NextResponse.json({
    data: {
      pay_url: payUrl,
      amount_dollars: SERVICE_CALL_FEE_DOLLARS,
    },
  })
}
