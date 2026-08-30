// Job PaymentIntents — verify booked price, create Stripe PI + wallet ledger row (COMPLETED as
// soon as Stripe reports succeeded), settle the rest on confirm.

import { neon } from "@neondatabase/serverless"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import {
  createWalletTransaction,
  failWalletTransactionByPaymentIntent,
  findLatestWalletTransactionByJobId,
  findWalletTransactionByPaymentIntent,
  settleWalletTransactionByPaymentIntent,
  type WalletPaymentMethod,
  type WalletTransaction,
  type WalletTransactionStatus,
} from "@/lib/tech-wallet"
import type Stripe from "stripe"

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

/**
 * Tech commission as a fraction of the customer charge (0–1). Default 1 = full amount to tech.
 *
 * The fallback for a tech with no compensation plan. It is one global number shared by
 * every business on the platform, which is why plans exist — but changing it out from
 * under an unplanned tech would silently change their pay, so it stays as the default.
 */
export function techJobCommissionRate(): number {
  const raw = Number(process.env.TECH_JOB_COMMISSION_RATE ?? "1")
  if (!Number.isFinite(raw)) return 1
  return Math.min(1, Math.max(0, raw))
}

export function commissionCentsFromCharge(chargeCents: number): number {
  const rate = techJobCommissionRate()
  return Math.max(0, Math.round(chargeCents * rate))
}

/**
 * What lands in the tech's wallet for this charge.
 *
 * Reads the tech's plan when they have one; otherwise falls back to the global env
 * rate so nothing changes for a tech nobody has set pay for yet.
 *
 * The wallet credit and the earnings ledger measure different things and both are
 * correct: the wallet tracks money the tech is holding or is owed out of this
 * charge, while the ledger records what the plan says they earned. For a tech on the
 * default 100% rate those coincide; for a tech on 30% commission they do not, and
 * the ledger is the one payroll reads.
 */
export async function walletCommissionCentsForJob(params: {
  jobId: string | null
  chargeCents: number
  /** Excluded from a plan-driven commission — a tip is not revenue to take a cut of. */
  tipCents?: number
}): Promise<number> {
  const charge = Math.max(0, Math.round(params.chargeCents))
  if (!params.jobId) return charge

  try {
    const { resolveTechCommissionRateBps } = await import("@/lib/compensation/tech-commission")
    const bps = await resolveTechCommissionRateBps(params.jobId)
    if (bps !== null) {
      const tip = Math.max(0, Math.round(params.tipCents ?? 0))
      const commissionable = Math.max(0, charge - tip)
      // The tip passes through whole on top of the commissioned share.
      return Math.max(0, Math.round((commissionable * bps) / 10_000) + tip)
    }
  } catch (e) {
    // A plan lookup failure must not block a customer's payment.
    console.warn("[job-payments] tech commission plan lookup failed:", e)
  }

  return commissionCentsFromCharge(charge)
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
  // Every caller (tech-payment-modal.tsx, owner-collect-payment-sheet.tsx) sends USD dollars
  // (e.g. totalCents / 100) — never cents. A prior "large integer = cents" heuristic here
  // undercharged whole-dollar amounts >= $1000 by 100x; always treat clientAmount as dollars.
  if (!Number.isFinite(clientAmount) || clientAmount <= 0) {
    return { ok: false, error: "amount must be a positive number (USD)" }
  }
  const chargeCents = Math.round(clientAmount * 100)

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

/**
 * Block a second real charge on a job — covers both the "customer paid via pay link while the
 * tech also force-started an in-person charge" collision and the "client timed out waiting for
 * the response but the server-side confirm:true charge already went through" retry case.
 * A stale/abandoned attempt (canceled, or never confirmed) self-heals to FAILED and does not block.
 */
async function guardAgainstDuplicateJobCharge(params: {
  jobId: string
  stripe: Stripe
  connectAccountId: string
}): Promise<void> {
  const existing = await findLatestWalletTransactionByJobId(params.jobId)
  if (!existing) return

  if (existing.status === "COMPLETED") {
    throw new Error("This job has already been paid — refresh to see the receipt.")
  }
  if (existing.status !== "PENDING" || !existing.stripePaymentIntentId) return

  const priorIntent = await params.stripe.paymentIntents.retrieve(existing.stripePaymentIntentId, {
    stripeAccount: params.connectAccountId,
  })
  const abandoned = priorIntent.status === "canceled" || priorIntent.status === "requires_payment_method"
  if (abandoned) {
    await failWalletTransactionByPaymentIntent(existing.stripePaymentIntentId)
    return
  }
  throw new Error(
    "A charge for this job is already in progress or has completed — refresh before trying again."
  )
}

/**
 * Write the PENDING ledger row after creating the Stripe PaymentIntent. When the card was
 * already charged (confirm:true, or the PI came back succeeded/processing/requires_capture), a
 * DB failure here must never surface as a generic error that invites a retry — retrying would
 * create a second real charge against the same job. When nothing has actually been charged yet
 * (e.g. a Tap to Pay intent still awaiting the terminal tap), the original error is safe to
 * surface as-is since a retry there charges nothing twice.
 */
/**
 * Money in hand the moment Stripe says so. `succeeded` means the charge cleared, so the ledger
 * row is written COMPLETED in this same request and the balance moves immediately — it does not
 * wait on the browser's follow-up confirm call or on a Stripe webhook, either of which can be
 * missed (a closed sheet, a dropped connection, an unconfigured Connect endpoint). A missed
 * settle used to strand the row at PENDING forever, which hid it from the owner list after 20
 * minutes and left it out of the collected total entirely — real money, invisible.
 *
 * `processing` and `requires_capture` stay PENDING on purpose: neither is money in hand yet,
 * and both still settle through the existing confirm/webhook path.
 */
export function ledgerStatusForIntent(intentStatus: string): WalletTransactionStatus {
  return intentStatus === "succeeded" ? "COMPLETED" : "PENDING"
}

async function recordLedgerRowAfterCharge(
  params: Parameters<typeof createWalletTransaction>[0],
  paymentIntentId: string,
  alreadyCharged: boolean
): Promise<WalletTransaction | null> {
  try {
    return await createWalletTransaction(params)
  } catch (e) {
    if (!alreadyCharged) throw e
    console.error(
      "[job-payments] charge already succeeded on Stripe but the ledger write failed — do not retry this charge",
      { paymentIntentId, error: e }
    )
    throw new Error(
      `Card was already charged (${paymentIntentId}) but we could not record it — do not retry. Refresh in a moment or contact support with this payment id.`
    )
  }
}

export type CreateJobPaymentIntentResult = {
  clientSecret: string
  paymentIntentId: string
  chargeCents: number
  commissionCents: number
  transaction: WalletTransaction | null
  /** Connected account for Stripe.js / Terminal (direct charges). */
  stripeConnectAccountId: string
  /** Stripe PaymentIntent status after create (may already be succeeded when PM was confirmed). */
  status: string
}

/** Create Stripe PaymentIntent + PENDING wallet transaction for the assigned tech. */
export async function createJobPaymentIntent(params: {
  job: JobPaymentContext
  chargeCents: number
  walletMethod: WalletPaymentMethod
  actingUserId: string
  /** Tip included in chargeCents (one PaymentIntent). */
  tipCents?: number | null
  /**
   * Card already keyed via deferred Payment Element (createPaymentMethod).
   * When set, create+confirm the PI now (one charge = job + tip).
   */
  paymentMethodId?: string | null
}): Promise<CreateJobPaymentIntentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (!params.job.assignedTechId) {
    throw new Error("Job has no assigned technician")
  }

  const tipCents = Math.max(0, Math.round(params.tipCents ?? 0))
  const commissionCents = await walletCommissionCentsForJob({
    jobId: params.job.jobId,
    chargeCents: params.chargeCents,
    tipCents,
  })
  if (commissionCents <= 0) {
    throw new Error(
      "The tech's share of this charge is zero — check their pay plan, or TECH_JOB_COMMISSION_RATE if they have none."
    )
  }

  const { requireConnectReady, computeLyncrApplicationFeeCents, connectDirectChargeOptions } =
    await import("@/lib/stripe-connect")
  const connect = await requireConnectReady(params.job.ownerUserId)
  const applicationFeeAmount = computeLyncrApplicationFeeCents(params.chargeCents)

  const stripe = getStripeClient()
  await guardAgainstDuplicateJobCharge({
    jobId: params.job.jobId,
    stripe,
    connectAccountId: connect.accountId,
  })
  const isTap = params.walletMethod === "TAP_TO_PAY"
  const paymentMethodId = (params.paymentMethodId || "").trim() || null
  // Keyed card was collected earlier — confirm now with final amount (job + tip).
  const confirmWithSavedCard = Boolean(paymentMethodId) && !isTap
  const intent = await stripe.paymentIntents.create(
    {
      amount: params.chargeCents,
      currency: "usd",
      application_fee_amount: applicationFeeAmount,
      // Tap: Terminal card_present. Manual: card only (avoids Link/wallet hang on Payment Element).
      ...(isTap
        ? { payment_method_types: ["card_present"], capture_method: "automatic" as const }
        : { payment_method_types: ["card"] }),
      ...(confirmWithSavedCard
        ? {
            payment_method: paymentMethodId!,
            confirm: true,
            // Stay on-page for most cards; 3DS uses handleNextAction on the client.
          }
        : {}),
      metadata: {
        lyncr_kind: "job_payment",
        job_id: params.job.jobId,
        tech_user_id: params.job.assignedTechId,
        owner_user_id: params.job.ownerUserId,
        acting_user_id: params.actingUserId,
        commission_cents: String(commissionCents),
        payment_method: params.walletMethod,
        tip_cents: String(tipCents),
        tip_included_in_amount: tipCents > 0 ? "1" : "0",
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

  const alreadyCharged =
    confirmWithSavedCard ||
    intent.status === "succeeded" ||
    intent.status === "processing" ||
    intent.status === "requires_capture"
  const transaction = await recordLedgerRowAfterCharge(
    {
      userId: params.job.assignedTechId,
      jobId: params.job.jobId,
      amountUsd: commissionCents / 100,
      status: ledgerStatusForIntent(intent.status),
      paymentMethod: params.walletMethod,
      stripePaymentIntentId: intent.id,
      ownerUserId: params.job.ownerUserId,
    },
    intent.id,
    alreadyCharged
  )

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    chargeCents: params.chargeCents,
    commissionCents,
    transaction,
    stripeConnectAccountId: connect.accountId,
    status: intent.status,
  }
}

/**
 * Quick charge with no booked job — owner on-the-go / walk-up customers.
 * Credits the acting owner's wallet ledger (job_id null).
 */
export async function createAdhocPaymentIntent(params: {
  ownerUserId: string
  /** Final charge including tax + tip (what Stripe collects). */
  chargeCents: number
  walletMethod: WalletPaymentMethod
  note?: string | null
  customerName?: string | null
  customerPhone?: string | null
  /** Pre-tax amount in cents (defaults to chargeCents when tax off). */
  subtotalCents?: number | null
  taxCents?: number | null
  /** Tip included in chargeCents (one PaymentIntent). */
  tipCents?: number | null
  /**
   * Card already keyed (deferred Payment Element → createPaymentMethod).
   * Confirms one PI for service + tax + tip — nothing charged at key-in.
   */
  paymentMethodId?: string | null
}): Promise<CreateJobPaymentIntentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }
  if (params.chargeCents < 50) {
    throw new Error("amount must be at least $0.50")
  }

  const note = (params.note ?? "").trim().slice(0, 120) || "Service"
  const customerName = (params.customerName ?? "").trim().slice(0, 80)
  const customerPhone = (params.customerPhone ?? "").trim().slice(0, 32)
  const tipCents = Math.max(0, Math.round(params.tipCents ?? 0))
  const taxCents = Math.max(0, Math.round(params.taxCents ?? 0))
  const subtotalCents = Math.max(
    0,
    Math.round(
      params.subtotalCents ??
        params.chargeCents - taxCents - tipCents
    )
  )
  const { requireConnectReady, computeLyncrApplicationFeeCents, connectDirectChargeOptions } =
    await import("@/lib/stripe-connect")
  const connect = await requireConnectReady(params.ownerUserId)
  const applicationFeeAmount = computeLyncrApplicationFeeCents(params.chargeCents)

  const stripe = getStripeClient()
  const isTap = params.walletMethod === "TAP_TO_PAY"
  const paymentMethodId = (params.paymentMethodId || "").trim() || null
  const confirmWithSavedCard = Boolean(paymentMethodId) && !isTap
  const intent = await stripe.paymentIntents.create(
    {
      amount: params.chargeCents,
      currency: "usd",
      application_fee_amount: applicationFeeAmount,
      // Same as job: card_present for tap; card-only for keyed Payment Element (faster/safer mount).
      ...(isTap
        ? { payment_method_types: ["card_present"], capture_method: "automatic" as const }
        : { payment_method_types: ["card"] }),
      ...(confirmWithSavedCard
        ? {
            payment_method: paymentMethodId!,
            confirm: true,
          }
        : {}),
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
        tip_cents: String(tipCents),
        // Tip is inside amount — invoice must not add tip again on top.
        tip_included_in_amount: tipCents > 0 ? "1" : "0",
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

  const alreadyCharged =
    confirmWithSavedCard ||
    intent.status === "succeeded" ||
    intent.status === "processing" ||
    intent.status === "requires_capture"
  const transaction = await recordLedgerRowAfterCharge(
    {
      userId: params.ownerUserId,
      jobId: null,
      amountUsd: params.chargeCents / 100,
      status: ledgerStatusForIntent(intent.status),
      paymentMethod: params.walletMethod,
      stripePaymentIntentId: intent.id,
      customerPhone: customerPhone || null,
      customerName: customerName || null,
      ownerUserId: params.ownerUserId,
    },
    intent.id,
    alreadyCharged
  )

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    chargeCents: params.chargeCents,
    commissionCents: params.chargeCents,
    transaction,
    stripeConnectAccountId: connect.accountId,
    status: intent.status,
  }
}

/** Mark job completed (owner or assigned tech path). */
export async function markJobCompletedForPayment(job: JobPaymentContext): Promise<void> {
  const sql = getSql()
  // Also clear lead/pool dispatch so CRM + scheduler treat the job as finished.
  await sql`
    UPDATE ai_leads
    SET job_status = 'completed',
        dispatch_status = 'completed',
        collected =
          coalesce(collected, '{}'::jsonb)
          || jsonb_build_object(
            'completed_at', now()::timestamptz::text,
            'job_status', 'completed',
            'dispatch_status', 'completed',
            'pending_callback', false
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
  opts?: {
    stripeConnectAccountId?: string | null
    /** Skip a second Stripe retrieve when the caller already loaded the PI. */
    intent?: import("stripe").Stripe.PaymentIntent | null
  }
): Promise<ConfirmJobPaymentResult> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)")
  }

  const stripe = getStripeClient()
  const pi = paymentIntentId.trim()
  let connectAcct = (opts?.stripeConnectAccountId || "").trim() || null

  // Plain PaymentIntent, not the SDK Response wrapper: opts.intent is already a plain one,
  // and nothing here reads lastResponse.
  let intent: import("stripe").Stripe.PaymentIntent
  if (opts?.intent && opts.intent.id === pi) {
    intent = opts.intent
    const metaAcct = (intent.metadata?.stripe_connect_account_id || "").trim()
    if (!connectAcct && metaAcct) connectAcct = metaAcct
  } else if (connectAcct) {
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
      // Completed and paid in the same breath — the moment a job-shaped pay component
      // becomes owed. Backgrounded so a ledger write cannot fail a confirmed payment;
      // the row is deduped, so a webhook retry settles it once.
      const { settleJobEarningsInBackground } = await import("@/lib/compensation/settle-job")
      settleJobEarningsInBackground(jobId)
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
