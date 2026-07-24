// Job PaymentIntents — verify booked price, create Stripe PI + PENDING wallet tx, settle on confirm.

import { neon } from "@neondatabase/serverless"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  createWalletTransaction,
  failWalletTransactionByPaymentIntent,
  findWalletTransactionByPaymentIntent,
  settleWalletTransactionByPaymentIntent,
  type WalletPaymentMethod,
  type WalletTransaction,
} from "@/lib/tech-wallet"

export type JobPaymentContext = {
  jobId: string
  ownerUserId: string
  assignedTechId: string | null
  jobStatus: string | null
  /** Authoritative charge in USD cents from the job record (null if unset). */
  expectedChargeCents: number | null
}

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

/** Tech commission as a fraction of the customer charge (0–1). Default 1 = full amount to tech. */
export function techJobCommissionRate(): number {
  const raw = Number(process.env.TECH_JOB_COMMISSION_RATE ?? "1")
  if (!Number.isFinite(raw)) return 1
  return Math.min(1, Math.max(0, raw))
}

export function commissionCentsFromCharge(chargeCents: number): number {
  const rate = techJobCommissionRate()
  return Math.max(0, Math.round(chargeCents * rate))
}

function pickPositiveCents(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = typeof c === "number" ? c : Number(c)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }
  return null
}

/** Load job pricing + assignment for PaymentIntent creation. */
export async function getJobPaymentContext(jobId: string): Promise<JobPaymentContext | null> {
  const sql = getSql()
  const id = jobId.trim()
  if (!id) return null

  try {
    const rows = await sql`
      SELECT
        id,
        user_id,
        assigned_tech_id,
        job_status,
        collected,
        final_booked_total_cents,
        calculated_total_cents
      FROM ai_leads
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null

    const collected =
      row.collected && typeof row.collected === "object"
        ? (row.collected as Record<string, unknown>)
        : {}

    const expectedChargeCents = pickPositiveCents(
      row.final_booked_total_cents,
      row.calculated_total_cents,
      collected.final_booked_total_cents,
      collected.quoted_price_cents,
      collected.last_quoted_price_cents,
      collected.baseline_quoted_price_cents
    )

    return {
      jobId: String(row.id),
      ownerUserId: String(row.user_id),
      assignedTechId: row.assigned_tech_id != null ? String(row.assigned_tech_id) : null,
      jobStatus: row.job_status != null ? String(row.job_status) : null,
      expectedChargeCents,
    }
  } catch (e) {
    // Older DBs without flat-price columns — retry without them.
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("final_booked") && !msg.includes("calculated_total")) throw e

    const rows = await sql`
      SELECT id, user_id, assigned_tech_id, job_status, collected
      FROM ai_leads
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    const collected =
      row.collected && typeof row.collected === "object"
        ? (row.collected as Record<string, unknown>)
        : {}
    return {
      jobId: String(row.id),
      ownerUserId: String(row.user_id),
      assignedTechId: row.assigned_tech_id != null ? String(row.assigned_tech_id) : null,
      jobStatus: row.job_status != null ? String(row.job_status) : null,
      expectedChargeCents: pickPositiveCents(
        collected.final_booked_total_cents,
        collected.quoted_price_cents,
        collected.last_quoted_price_cents,
        collected.baseline_quoted_price_cents
      ),
    }
  }
}

/** Map API paymentMethodType → wallet method (Stripe uses automatic_payment_methods). */
export function normalizeJobPaymentMethod(raw: string): WalletPaymentMethod | null {
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_")
  if (key === "CASH") return null // Cash is offline — no PaymentIntent.
  if (key === "TAP_TO_PAY" || key === "CARD_PRESENT") return "TAP_TO_PAY"
  if (key === "MANUAL_CARD" || key === "CARD") return "MANUAL_CARD"
  return null
}

/**
 * Verify client amount against the job's booked price.
 * When the job has no stored price, the client amount is accepted (invoice-style collect).
 * Pass `allowInvoiceOverride` when the tech built a line-item invoice on-site.
 */
export function resolveVerifiedChargeCents(
  job: JobPaymentContext,
  clientAmount: number,
  options?: { allowInvoiceOverride?: boolean }
): { ok: true; chargeCents: number } | { ok: false; error: string } {
  // Client may send dollars (149.99) or cents (14999). Prefer dollars when < 1000 and fractional.
  let chargeCents: number
  if (!Number.isFinite(clientAmount) || clientAmount <= 0) {
    return { ok: false, error: "amount must be a positive number (USD)" }
  }
  // Treat values >= 1000 without decimals as cents if they match job cents; else dollars.
  if (Number.isInteger(clientAmount) && clientAmount >= 1000 && job.expectedChargeCents === clientAmount) {
    chargeCents = clientAmount
  } else if (Number.isInteger(clientAmount) && clientAmount >= 1000 && !job.expectedChargeCents) {
    // Ambiguous large integer with no job price — treat as cents.
    chargeCents = clientAmount
  } else {
    chargeCents = Math.round(clientAmount * 100)
  }

  if (chargeCents < 50) {
    return { ok: false, error: "amount must be at least $0.50" }
  }

  if (
    !options?.allowInvoiceOverride &&
    job.expectedChargeCents != null &&
    Math.abs(job.expectedChargeCents - chargeCents) > 1
  ) {
    return {
      ok: false,
      error: `amount does not match job price (expected $${(job.expectedChargeCents / 100).toFixed(2)})`,
    }
  }

  return { ok: true, chargeCents }
}

export type CreateJobPaymentIntentResult = {
  clientSecret: string
  paymentIntentId: string
  chargeCents: number
  commissionCents: number
  transaction: WalletTransaction | null
  /** Connected account for Stripe.js / Terminal (direct charges). */
  stripeConnectAccountId: string
}

/** Create Stripe PaymentIntent + PENDING wallet transaction for the assigned tech. */
export async function createJobPaymentIntent(params: {
  job: JobPaymentContext
  chargeCents: number
  walletMethod: WalletPaymentMethod
  actingUserId: string
}): Promise<CreateJobPaymentIntentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (!params.job.assignedTechId) {
    throw new Error("Job has no assigned technician")
  }

  const commissionCents = commissionCentsFromCharge(params.chargeCents)
  if (commissionCents <= 0) {
    throw new Error("Commission amount is zero — check TECH_JOB_COMMISSION_RATE")
  }

  const { requireConnectReady, computeLyncrApplicationFeeCents, connectDirectChargeOptions } =
    await import("@/lib/stripe-connect")
  const connect = await requireConnectReady(params.job.ownerUserId)
  const applicationFeeAmount = computeLyncrApplicationFeeCents(params.chargeCents)

  const stripe = getStripeClient()
  const isTap = params.walletMethod === "TAP_TO_PAY"
  const intent = await stripe.paymentIntents.create(
    {
      amount: params.chargeCents,
      currency: "usd",
      application_fee_amount: applicationFeeAmount,
      // Terminal / Tap to Pay needs card_present; Payment Element uses automatic methods.
      ...(isTap
        ? { payment_method_types: ["card_present"], capture_method: "automatic" as const }
        : { automatic_payment_methods: { enabled: true } }),
      metadata: {
        lyncr_kind: "job_payment",
        job_id: params.job.jobId,
        tech_user_id: params.job.assignedTechId,
        owner_user_id: params.job.ownerUserId,
        acting_user_id: params.actingUserId,
        commission_cents: String(commissionCents),
        payment_method: params.walletMethod,
        stripe_connect_account_id: connect.accountId,
        lyncr_application_fee_cents: String(applicationFeeAmount),
      },
      description: `Lyncr job ${params.job.jobId.slice(0, 8)}`,
    },
    connectDirectChargeOptions(connect.accountId)
  )

  if (!intent.client_secret) {
    throw new Error("Stripe did not return a client_secret")
  }

  const transaction = await createWalletTransaction({
    userId: params.job.assignedTechId,
    jobId: params.job.jobId,
    amountUsd: commissionCents / 100,
    status: "PENDING",
    paymentMethod: params.walletMethod,
    stripePaymentIntentId: intent.id,
  })

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    chargeCents: params.chargeCents,
    commissionCents,
    transaction,
    stripeConnectAccountId: connect.accountId,
  }
}

/**
 * Quick charge with no booked job — owner on-the-go / walk-up customers.
 * Credits the acting owner's wallet ledger (job_id null).
 */
export async function createAdhocPaymentIntent(params: {
  ownerUserId: string
  /** Final charge including tax (what Stripe collects). */
  chargeCents: number
  walletMethod: WalletPaymentMethod
  note?: string | null
  customerName?: string | null
  customerPhone?: string | null
  /** Pre-tax amount in cents (defaults to chargeCents when tax off). */
  subtotalCents?: number | null
  taxCents?: number | null
}): Promise<CreateJobPaymentIntentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (params.chargeCents < 50) {
    throw new Error("amount must be at least $0.50")
  }

  const note = (params.note ?? "").trim().slice(0, 120) || "Walk-up payment"
  const customerName = (params.customerName ?? "").trim().slice(0, 80)
  const customerPhone = (params.customerPhone ?? "").trim().slice(0, 32)
  const subtotalCents = Math.max(
    0,
    Math.round(params.subtotalCents ?? params.chargeCents - (params.taxCents ?? 0))
  )
  const taxCents = Math.max(0, Math.round(params.taxCents ?? 0))
  const { requireConnectReady, computeLyncrApplicationFeeCents, connectDirectChargeOptions } =
    await import("@/lib/stripe-connect")
  const connect = await requireConnectReady(params.ownerUserId)
  const applicationFeeAmount = computeLyncrApplicationFeeCents(params.chargeCents)

  const stripe = getStripeClient()
  const isTap = params.walletMethod === "TAP_TO_PAY"
  const intent = await stripe.paymentIntents.create(
    {
      amount: params.chargeCents,
      currency: "usd",
      application_fee_amount: applicationFeeAmount,
      ...(isTap
        ? { payment_method_types: ["card_present"], capture_method: "automatic" as const }
        : { automatic_payment_methods: { enabled: true } }),
      metadata: {
        lyncr_kind: "adhoc_payment",
        owner_user_id: params.ownerUserId,
        acting_user_id: params.ownerUserId,
        commission_cents: String(params.chargeCents),
        payment_method: params.walletMethod,
        note,
        customer_name: customerName || "",
        customer_phone: customerPhone || "",
        subtotal_cents: String(subtotalCents),
        tax_cents: String(taxCents),
        stripe_connect_account_id: connect.accountId,
        lyncr_application_fee_cents: String(applicationFeeAmount),
      },
      description: customerName
        ? `Lyncr · ${customerName} · ${note}`
        : `Lyncr · ${note}`,
    },
    connectDirectChargeOptions(connect.accountId)
  )

  if (!intent.client_secret) {
    throw new Error("Stripe did not return a client_secret")
  }

  const transaction = await createWalletTransaction({
    userId: params.ownerUserId,
    jobId: null,
    amountUsd: params.chargeCents / 100,
    status: "PENDING",
    paymentMethod: params.walletMethod,
    stripePaymentIntentId: intent.id,
  })

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    chargeCents: params.chargeCents,
    commissionCents: params.chargeCents,
    transaction,
    stripeConnectAccountId: connect.accountId,
  }
}

/** Mark job completed (owner or assigned tech path). */
export async function markJobCompletedForPayment(job: JobPaymentContext): Promise<void> {
  const sql = getSql()
  await sql`
    UPDATE ai_leads
    SET job_status = 'completed',
        collected = jsonb_set(
          coalesce(collected, '{}'::jsonb),
          '{completed_at}',
          to_jsonb(now()::timestamptz::text),
          true
        )
    WHERE id = ${job.jobId}
  `
}

export type ConfirmJobPaymentResult = {
  paymentIntentId: string
  status: "succeeded" | "processing" | "requires_action" | "failed" | "already_completed"
  jobId: string | null
  transaction: WalletTransaction | null
}

/**
 * Confirm a job PaymentIntent (client after Elements, or webhook after success).
 * On succeeded: COMPLETED wallet tx + credit tech balance + job completed.
 */
export async function confirmJobPaymentIntent(
  paymentIntentId: string,
  opts?: { stripeConnectAccountId?: string | null }
): Promise<ConfirmJobPaymentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }

  const stripe = getStripeClient()
  const pi = paymentIntentId.trim()
  let connectAcct = (opts?.stripeConnectAccountId || "").trim() || null

  let intent: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>
  if (connectAcct) {
    intent = await stripe.paymentIntents.retrieve(pi, { stripeAccount: connectAcct })
  } else {
    try {
      intent = await stripe.paymentIntents.retrieve(pi)
      const metaAcct = (intent.metadata?.stripe_connect_account_id || "").trim()
      if (metaAcct) {
        connectAcct = metaAcct
        intent = await stripe.paymentIntents.retrieve(pi, { stripeAccount: metaAcct })
      }
    } catch (e) {
      throw e
    }
  }

  const jobId = intent.metadata?.job_id?.trim() || null
  const kind = intent.metadata?.lyncr_kind

  if (kind && kind !== "job_payment" && kind !== "adhoc_payment") {
    throw new Error("PaymentIntent is not a Lyncr collectible payment")
  }

  if (intent.status === "succeeded") {
    const existing = await findWalletTransactionByPaymentIntent(intent.id)
    if (existing?.status === "COMPLETED") {
      if (jobId && kind !== "adhoc_payment") {
        const job = await getJobPaymentContext(jobId)
        if (job && job.jobStatus !== "completed") await markJobCompletedForPayment(job)
      }
      return {
        paymentIntentId: intent.id,
        status: "already_completed",
        jobId,
        transaction: existing,
      }
    }

    const transaction = await settleWalletTransactionByPaymentIntent(intent.id)
    if (jobId && kind !== "adhoc_payment") {
      const job = await getJobPaymentContext(jobId)
      if (job) await markJobCompletedForPayment(job)
    }

    return {
      paymentIntentId: intent.id,
      status: "succeeded",
      jobId,
      transaction,
    }
  }

  if (intent.status === "processing" || intent.status === "requires_action" || intent.status === "requires_confirmation") {
    return {
      paymentIntentId: intent.id,
      status: intent.status === "processing" ? "processing" : "requires_action",
      jobId,
      transaction: await findWalletTransactionByPaymentIntent(intent.id),
    }
  }

  // canceled / requires_payment_method / etc.
  const failed = await failWalletTransactionByPaymentIntent(intent.id)
  return {
    paymentIntentId: intent.id,
    status: "failed",
    jobId,
    transaction: failed,
  }
}
