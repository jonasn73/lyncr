// GET /api/admin/finance/invoices?ownerUserId=... — admin@lyncr.app only.
// Real Stripe invoices for one business's subscription — what "Plan cash" is actually made of.
// Per-business only (not platform-wide): listing every business's invoices in one call would
// mean a live Stripe request per Stripe customer, which doesn't scale the way a DB query does.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

export const dynamic = "force-dynamic"

type InvoiceRow = {
  id: string
  amountLabel: string
  amountCents: number
  status: string
  createdLabel: string
  paidLabel: string | null
  hostedInvoiceUrl: string | null
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round(cents) / 100
  )
}

function fmtDate(unixSeconds: number | null): string | null {
  if (!unixSeconds) return null
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured (STRIPE_SECRET_KEY)" }, { status: 503 })
  }

  const ownerUserId = (req.nextUrl.searchParams.get("ownerUserId") || "").trim()
  if (!ownerUserId) {
    return NextResponse.json({ error: "ownerUserId is required" }, { status: 400 })
  }

  const sql = neon(resolveNeonDatabaseUrl())
  const rows = (await sql`
    SELECT nullif(trim(op.stripe_customer_id), '') AS stripe_customer_id,
           coalesce(nullif(trim(u.business_name), ''), 'Unnamed business') AS business_name
    FROM users u
    LEFT JOIN onboarding_profiles op ON op.user_id = u.id
    WHERE u.id = ${ownerUserId}::uuid
    LIMIT 1
  `) as { stripe_customer_id: string | null; business_name: string }[]

  const customerId = rows[0]?.stripe_customer_id ?? null
  const businessName = rows[0]?.business_name ?? "Unnamed business"

  if (!customerId) {
    return NextResponse.json({ data: { businessName, customerId: null, invoices: [] } })
  }

  try {
    const stripe = getStripeClient()
    const invoices: InvoiceRow[] = []
    let startingAfter: string | undefined
    for (let page = 0; page < 10; page++) {
      const batch = await stripe.invoices.list({
        customer: customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const inv of batch.data) {
        invoices.push({
          id: inv.id ?? "",
          amountLabel: fmtUsd(inv.amount_paid || inv.amount_due || 0),
          amountCents: inv.amount_paid || inv.amount_due || 0,
          status: inv.status ?? "unknown",
          createdLabel: fmtDate(inv.created) ?? "—",
          paidLabel: fmtDate(inv.status_transitions?.paid_at ?? null),
          hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        })
      }
      if (!batch.has_more || batch.data.length === 0) break
      startingAfter = batch.data[batch.data.length - 1]?.id
      if (!startingAfter) break
    }
    return NextResponse.json({ data: { businessName, customerId, invoices } })
  } catch (e) {
    console.error("[admin/finance/invoices]", e)
    const message = e instanceof Error ? e.message : "Could not load invoices"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
