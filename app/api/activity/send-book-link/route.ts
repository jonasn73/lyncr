// POST /api/activity/send-book-link
// Activity: text a customer intake form (+ optional pay) for a call's phone.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getUser, normalizePhoneNumberE164 } from "@/lib/db"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { isStripeConfigured } from "@/lib/stripe-config"
import {
  createCollectPayLinkCheckout,
} from "@/lib/job-pay-link"
import { sendAndLogWorkspaceCustomerSms } from "@/lib/workspace-customer-sms"
import {
  SERVICE_CALL_FEE_DOLLARS,
  SERVICE_CALL_FEE_LABEL,
} from "@/lib/service-call-fee"
import {
  buildIntakeBookLinkSms,
  createIntakeBookLink,
  resolveIntakeBookQuoteCents,
  type IntakeBookFeeMode,
} from "@/lib/intake-book-link"
import { collectCheckoutWalletSummary } from "@/lib/stripe-collect-payment-methods"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Body = {
  phone?: string
  business_line?: string
  call_log_id?: string
  /** none | service_call | full_quote */
  fee_mode?: string
  /** Dollars for full_quote (ignored for none / service_call). */
  quote_dollars?: number | string
  note?: string
  customer_name?: string
}

function parseFeeMode(raw: unknown): IntakeBookFeeMode {
  const v = String(raw ?? "none").trim().toLowerCase()
  if (v === "service_call") return "service_call"
  if (v === "full_quote") return "full_quote"
  return "none"
}

/** Look up an open lead's quoted dollars for this phone (prefill Full quote). */
async function suggestedQuoteDollarsForPhone(
  ownerUserId: string,
  phoneE164: string
): Promise<number | null> {
  const digits = phoneE164.replace(/\D/g, "").slice(-10)
  if (digits.length < 10) return null
  try {
    const sql = neon(resolveNeonDatabaseUrl())
    const rows = await sql`
      SELECT
        coalesce(
          nullif(trim(collected->>'quoted_price_cents'), '')::int,
          nullif(trim(collected->>'last_quoted_price_cents'), '')::int,
          nullif(trim(collected->>'final_booked_total_cents'), '')::int,
          nullif(trim(collected->>'baseline_quoted_price_cents'), '')::int,
          0
        ) AS quote_cents
      FROM ai_leads
      WHERE user_id = ${ownerUserId}
        AND right(
          regexp_replace(
            coalesce(
              nullif(trim(caller_e164), ''),
              nullif(trim(collected->>'customer_phone'), ''),
              ''
            ),
            '\\D', '', 'g'
          ),
          10
        ) = ${digits}
      ORDER BY coalesce(scheduled_at, created_at) DESC
      LIMIT 1
    `
    const cents = Number((rows[0] as { quote_cents?: number } | undefined)?.quote_cents ?? 0)
    if (!Number.isFinite(cents) || cents < 50) return null
    return Math.round(cents) / 100
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  // Prefill helpers for the Activity sheet (suggested quote for this phone).
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const phoneRaw = String(req.nextUrl.searchParams.get("phone") || "").trim()
  const phone = normalizePhoneNumberE164(phoneRaw)
  if (!phone) {
    return NextResponse.json({ error: "Valid phone required" }, { status: 400 })
  }

  const suggested = await suggestedQuoteDollarsForPhone(userId, phone)
  return NextResponse.json({
    data: {
      suggested_quote_dollars: suggested,
      service_call_dollars: SERVICE_CALL_FEE_DOLLARS,
    },
  })
}

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const user = await getUser(userId)
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const phone = normalizePhoneNumberE164(String(body.phone ?? "").trim())
  if (!phone) {
    return NextResponse.json({ error: "Customer phone is required" }, { status: 400 })
  }

  const feeMode = parseFeeMode(body.fee_mode)
  const quoteDollarsRaw =
    typeof body.quote_dollars === "string"
      ? Number(body.quote_dollars.replace(/[$,\s]/g, ""))
      : Number(body.quote_dollars)

  let quoteCents = 0
  try {
    quoteCents = resolveIntakeBookQuoteCents(
      feeMode,
      feeMode === "full_quote" ? quoteDollarsRaw : null
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid quote amount" },
      { status: 400 }
    )
  }

  // Paid modes need Stripe Connect (same path as Collect / service-call).
  if (feeMode !== "none" && !isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel / .env.local." },
      { status: 503 }
    )
  }

  const note = String(body.note ?? "").trim().slice(0, 280)
  const customerName = String(body.customer_name ?? "").trim().slice(0, 120) || undefined
  const businessLine = String(body.business_line ?? "").trim() || null
  const callLogId = String(body.call_log_id ?? "").trim() || null
  const businessLabel = user.business_name?.trim() || user.name?.trim() || "Lyncr"

  let payToken: string | null = null
  let venmoIncluded = false

  try {
    if (feeMode !== "none") {
      const lineSummary =
        feeMode === "service_call"
          ? SERVICE_CALL_FEE_LABEL
          : `Quoted service ($${(quoteCents / 100).toFixed(quoteCents % 100 === 0 ? 0 : 2)})`
      const checkout = await createCollectPayLinkCheckout({
        actingUserId: userId,
        jobId: null,
        chargeCents: quoteCents,
        subtotalCents: quoteCents,
        taxCents: 0,
        note: note || lineSummary,
        customerName,
        lineSummary,
      })
      payToken = checkout.payToken
      venmoIncluded = Boolean(checkout.venmoIncluded)
    }

    const created = await createIntakeBookLink({
      ownerUserId: userId,
      callerPhone: phone,
      businessLine,
      callLogId,
      feeMode,
      quoteCents,
      operatorNote: note,
      payToken,
    })

    if (!created) {
      return NextResponse.json(
        {
          error:
            "Could not create book link. Run scripts/125-intake-book-links.sql in Neon SQL Editor.",
        },
        { status: 503 }
      )
    }

    const smsBody = buildIntakeBookLinkSms({
      businessLabel,
      url: created.url,
      feeMode,
      quoteCents,
      operatorNote: note || null,
    })

    const sent = await sendAndLogWorkspaceCustomerSms({
      ownerUserId: userId,
      toE164: phone,
      text: smsBody,
      // Prefer the business DID from the Activity row when present
      fromE164: businessLine,
    })

    const wallets = collectCheckoutWalletSummary({
      venmoAttempted: feeMode !== "none",
      venmoIncluded: feeMode !== "none" ? venmoIncluded : undefined,
    })

    if (!sent.ok) {
      return NextResponse.json(
        {
          error: sent.error || "Could not send SMS",
          data: {
            invite_id: created.link.id,
            form_url: created.url,
            fee_mode: feeMode,
            quote_cents: quoteCents,
            pay_token: payToken,
            wallets,
          },
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      data: {
        invite_id: created.link.id,
        form_url: created.url,
        fee_mode: feeMode,
        quote_cents: quoteCents,
        pay_token: payToken,
        wallets,
      },
    })
  } catch (e) {
    console.error("[send-book-link]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not send book link" },
      { status: 500 }
    )
  }
}
