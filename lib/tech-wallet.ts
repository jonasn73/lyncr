// Technician wallet ledger — users.balance + wallet_transactions (scripts/111).
// Server-only (Neon). Powers /api/tech/wallet and invoice collect → earnings.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type WalletTransactionStatus = "PENDING" | "COMPLETED" | "FAILED"
export type WalletPaymentMethod = "TAP_TO_PAY" | "MANUAL_CARD" | "CASH" | "PAYOUT"
/** Why money moved back out (migration 154). DISPUTE_WON re-credits after winning. */
export type WalletReversalReason = "REFUND" | "DISPUTE" | "DISPUTE_WON"
/** CHARGE = customer payment. REVERSAL = refund/dispute. PAYOUT = sent to bank (migration 155). */
export type WalletEntryType = "CHARGE" | "REVERSAL" | "PAYOUT"

export type WalletTransaction = {
  id: string
  userId: string
  jobId: string | null
  amount: number
  status: WalletTransactionStatus
  paymentMethod: WalletPaymentMethod
  stripePaymentIntentId: string | null
  /** Walk-up / adhoc E.164 phone when job_id is null (migration 124). */
  customerPhone: string | null
  customerName: string | null
  /** The business this money belongs to — direct SUM(amount) ownership (migration 155). */
  ownerUserId: string | null
  entryType: WalletEntryType
  createdAt: string
}

export type TechWalletSummary = {
  /** Available balance from users.balance (settled COMPLETED earnings). */
  availableBalance: number
  /** Sum of PENDING transactions not yet settled. */
  pendingClearance: number
  recentTransactions: WalletTransaction[]
}

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function pgErrorCode(e: unknown): string {
  if (!e || typeof e !== "object") return ""
  return String((e as { code?: string }).code ?? "")
}

function pgErrorMessage(e: unknown): string {
  if (!e || typeof e !== "object") return String(e)
  return String((e as { message?: string }).message ?? e)
}

/** True for a unique-constraint violation (e.g. two concurrent inserts racing on the same PaymentIntent). */
export function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === "23505"
}

/** True when migration 111 has not been applied yet. */
export function isMissingWalletSchemaError(e: unknown): boolean {
  const msg = pgErrorMessage(e).toLowerCase()
  if (pgErrorCode(e) === "42P01" && msg.includes("wallet_transactions")) return true
  if (pgErrorCode(e) === "42703" && (msg.includes("balance") || msg.includes("wallet_transactions"))) {
    return true
  }
  return msg.includes("wallet_transactions") && (msg.includes("does not exist") || msg.includes("undefined"))
}

function mapTransaction(row: Record<string, unknown>): WalletTransaction {
  const statusRaw = String(row.status ?? "PENDING").toUpperCase()
  const status: WalletTransactionStatus =
    statusRaw === "COMPLETED" || statusRaw === "FAILED" ? statusRaw : "PENDING"
  const methodRaw = String(row.payment_method ?? "CASH").toUpperCase()
  const paymentMethod: WalletPaymentMethod =
    methodRaw === "TAP_TO_PAY" || methodRaw === "MANUAL_CARD" || methodRaw === "PAYOUT"
      ? methodRaw
      : "CASH"
  const entryTypeRaw = String(row.entry_type ?? "CHARGE").toUpperCase()
  const entryType: WalletEntryType =
    entryTypeRaw === "REVERSAL" || entryTypeRaw === "PAYOUT" ? entryTypeRaw : "CHARGE"
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? new Date().toISOString())
  return {
    id: String(row.id),
    userId: String(row.user_id),
    jobId: row.job_id != null ? String(row.job_id) : null,
    amount: Number(row.amount ?? 0) || 0,
    status,
    paymentMethod,
    stripePaymentIntentId:
      row.stripe_payment_intent_id != null ? String(row.stripe_payment_intent_id).trim() || null : null,
    customerPhone:
      row.customer_phone != null && String(row.customer_phone).trim()
        ? String(row.customer_phone).trim()
        : null,
    customerName:
      row.customer_name != null && String(row.customer_name).trim()
        ? String(row.customer_name).trim()
        : null,
    ownerUserId: row.owner_user_id != null ? String(row.owner_user_id) : null,
    entryType,
    createdAt: created,
  }
}

/** Full row read, degrading to the pre-155 column set when owner_user_id/entry_type are missing. */
async function fetchWalletTransactionById(
  sql: ReturnType<typeof getSql>,
  id: string
): Promise<WalletTransaction | null> {
  try {
    const rows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
        customer_phone, customer_name, owner_user_id, entry_type, created_at
      FROM wallet_transactions
      WHERE id = ${id}
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
    const rows = await sql`
      SELECT id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE id = ${id}
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  }
}

/** Same degrade-gracefully read, keyed by Stripe PaymentIntent (latest row wins). */
async function fetchWalletTransactionByPI(
  sql: ReturnType<typeof getSql>,
  pi: string
): Promise<WalletTransaction | null> {
  try {
    const rows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
        customer_phone, customer_name, owner_user_id, entry_type, created_at
      FROM wallet_transactions
      WHERE stripe_payment_intent_id = ${pi}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (pgErrorCode(e) !== "42703") throw e
    const rows = await sql`
      SELECT id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE stripe_payment_intent_id = ${pi}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  }
}

/** Map invoice payment fields → wallet payment method + status. */
export function walletStatusFromInvoice(params: {
  paymentStatus: string
  paymentMethod: string | null | undefined
}): { status: WalletTransactionStatus; paymentMethod: WalletPaymentMethod } {
  const methodRaw = String(params.paymentMethod ?? "").toLowerCase()
  const paymentMethod: WalletPaymentMethod =
    methodRaw === "cash" ? "CASH" : methodRaw === "card" ? "MANUAL_CARD" : "MANUAL_CARD"

  const ps = String(params.paymentStatus ?? "").toLowerCase()
  if (ps === "paid") return { status: "COMPLETED", paymentMethod }
  if (ps === "pending" || ps === "recorded") return { status: "PENDING", paymentMethod }
  if (ps === "failed") return { status: "FAILED", paymentMethod }
  return { status: "PENDING", paymentMethod }
}

/** Read tech wallet balance + pending + recent ledger rows. */
export async function getTechWalletSummary(
  techUserId: string,
  recentLimit = 20
): Promise<TechWalletSummary> {
  const sql = getSql()
  try {
    const balanceRows = await sql`
      SELECT COALESCE(balance, 0)::float8 AS balance
      FROM users
      WHERE id = ${techUserId}
      LIMIT 1
    `
    const availableBalance = Number(balanceRows[0]?.balance ?? 0) || 0

    const pendingRows = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS pending
      FROM wallet_transactions
      WHERE user_id = ${techUserId}
        AND status = 'PENDING'
    `
    const pendingClearance = Number(pendingRows[0]?.pending ?? 0) || 0

    const limit = Math.min(Math.max(1, recentLimit), 50)
    const txRows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE user_id = ${techUserId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `

    return {
      availableBalance,
      pendingClearance,
      recentTransactions: (txRows as Record<string, unknown>[]).map(mapTransaction),
    }
  } catch (e) {
    if (isMissingWalletSchemaError(e)) {
      return { availableBalance: 0, pendingClearance: 0, recentTransactions: [] }
    }
    throw e
  }
}

/**
 * Insert a wallet transaction. When status is COMPLETED, also increments users.balance.
 * Returns null when migration 111 is missing (caller can ignore).
 */
export async function createWalletTransaction(params: {
  userId: string
  jobId: string | null
  amountUsd: number
  status: WalletTransactionStatus
  paymentMethod: WalletPaymentMethod
  stripePaymentIntentId?: string | null
  /** Walk-up contact (migration 124). Ignored when columns are missing. */
  customerPhone?: string | null
  customerName?: string | null
  /** The business this money belongs to (migration 155). Ignored when the column is missing. */
  ownerUserId?: string | null
  entryType?: WalletEntryType
}): Promise<WalletTransaction | null> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const amount = Math.round(Number(params.amountUsd) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null

  const customerPhone = (params.customerPhone ?? "").trim() || null
  const customerName = (params.customerName ?? "").trim().slice(0, 80) || null
  const ownerUserId = (params.ownerUserId ?? "").trim() || null
  const entryType = params.entryType ?? "CHARGE"

  try {
    try {
      await sql`
        INSERT INTO wallet_transactions
          (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
           customer_phone, customer_name, owner_user_id, entry_type, created_at)
        VALUES
          (
            ${id},
            ${params.userId},
            ${params.jobId},
            ${amount},
            ${params.status},
            ${params.paymentMethod},
            ${params.stripePaymentIntentId?.trim() || null},
            ${customerPhone},
            ${customerName},
            ${ownerUserId},
            ${entryType},
            now()
          )
      `
    } catch (inner) {
      if (pgErrorCode(inner) !== "42703") throw inner
      // Pre-migration 155: owner_user_id / entry_type columns missing.
      try {
        await sql`
          INSERT INTO wallet_transactions
            (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
             customer_phone, customer_name, created_at)
          VALUES
            (
              ${id},
              ${params.userId},
              ${params.jobId},
              ${amount},
              ${params.status},
              ${params.paymentMethod},
              ${params.stripePaymentIntentId?.trim() || null},
              ${customerPhone},
              ${customerName},
              now()
            )
        `
      } catch (inner2) {
        // Pre-migration 124: customer_phone / customer_name columns missing too.
        if (pgErrorCode(inner2) !== "42703") throw inner2
        await sql`
          INSERT INTO wallet_transactions
            (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id, created_at)
          VALUES
            (
              ${id},
              ${params.userId},
              ${params.jobId},
              ${amount},
              ${params.status},
              ${params.paymentMethod},
              ${params.stripePaymentIntentId?.trim() || null},
              now()
            )
        `
      }
    }

    if (params.status === "COMPLETED") {
      await sql`
        UPDATE users
        SET balance = COALESCE(balance, 0) + ${amount}
        WHERE id = ${params.userId}
      `
    }

    return await fetchWalletTransactionById(sql, id)
  } catch (e) {
    if (isMissingWalletSchemaError(e)) {
      console.warn("[tech-wallet] migration 111 not applied — skipped transaction")
      return null
    }
    throw e
  }
}

/**
 * Attach / refresh walk-up customer phone + name on a wallet row (by Stripe PI).
 * Also used when a receipt SMS captures the number after charge.
 */
export async function updateWalletTransactionCustomerContact(params: {
  stripePaymentIntentId: string
  customerPhone?: string | null
  customerName?: string | null
}): Promise<boolean> {
  const pi = params.stripePaymentIntentId.trim()
  if (!pi) return false
  const phone = (params.customerPhone ?? "").trim() || null
  const name = (params.customerName ?? "").trim().slice(0, 80) || null
  if (!phone && !name) return false

  const sql = getSql()
  try {
    await sql`
      UPDATE wallet_transactions
      SET
        customer_phone = COALESCE(${phone}, customer_phone),
        customer_name = COALESCE(${name}, customer_name)
      WHERE stripe_payment_intent_id = ${pi}
    `
    return true
  } catch (e) {
    if (isMissingWalletSchemaError(e) || pgErrorCode(e) === "42703") return false
    console.warn("[tech-wallet] update customer contact failed", e)
    return false
  }
}

/**
 * Mark a PENDING transaction COMPLETED and credit the tech balance.
 * No-op when already settled or missing.
 */
export async function settleWalletTransaction(
  transactionId: string,
  techUserId: string
): Promise<WalletTransaction | null> {
  const sql = getSql()
  try {
    const existing = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE id = ${transactionId}
        AND user_id = ${techUserId}
      LIMIT 1
    `
    const row = existing[0] as Record<string, unknown> | undefined
    if (!row) return null
    const current = mapTransaction(row)
    if (current.status === "COMPLETED") return current
    if (current.status === "FAILED") return current

    // Guarded UPDATE only matches (and returns a row) for whichever concurrent caller wins the
    // PENDING -> COMPLETED transition — a second racing caller sees 0 rows back and must not
    // credit the balance again (it would otherwise double-credit on every concurrent settle).
    const settled = await sql`
      UPDATE wallet_transactions
      SET status = 'COMPLETED'
      WHERE id = ${transactionId}
        AND user_id = ${techUserId}
        AND status = 'PENDING'
      RETURNING id
    `
    if (settled.length === 0) return { ...current, status: "COMPLETED" }

    await sql`
      UPDATE users
      SET balance = COALESCE(balance, 0) + ${current.amount}
      WHERE id = ${techUserId}
    `

    return { ...current, status: "COMPLETED" }
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return null
    throw e
  }
}

/** Look up a wallet row by Stripe PaymentIntent id (idempotent settle / confirm). */
export async function findWalletTransactionByPaymentIntent(
  stripePaymentIntentId: string
): Promise<WalletTransaction | null> {
  const sql = getSql()
  const pi = stripePaymentIntentId.trim()
  if (!pi) return null
  try {
    return await fetchWalletTransactionByPI(sql, pi)
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return null
    throw e
  }
}

/** Settle by PaymentIntent id — credits users.balance once when PENDING → COMPLETED. */
export async function settleWalletTransactionByPaymentIntent(
  stripePaymentIntentId: string
): Promise<WalletTransaction | null> {
  const existing = await findWalletTransactionByPaymentIntent(stripePaymentIntentId)
  if (!existing) return null
  return settleWalletTransaction(existing.id, existing.userId)
}

/** Most recent wallet row for a job, any status — used to guard against charging a job twice. */
export async function findLatestWalletTransactionByJobId(
  jobId: string
): Promise<WalletTransaction | null> {
  const sql = getSql()
  const id = jobId.trim()
  if (!id) return null
  try {
    const rows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE job_id = ${id}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return null
    throw e
  }
}

/** Mark a PaymentIntent-linked row FAILED (card declined / canceled). */
export async function failWalletTransactionByPaymentIntent(
  stripePaymentIntentId: string
): Promise<WalletTransaction | null> {
  const sql = getSql()
  const pi = stripePaymentIntentId.trim()
  if (!pi) return null
  try {
    const rows = await sql`
      UPDATE wallet_transactions
      SET status = 'FAILED'
      WHERE stripe_payment_intent_id = ${pi}
        AND status = 'PENDING'
      RETURNING
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return null
    throw e
  }
}


/**
 * Total already reversed against one charge, as a positive dollar figure.
 * Reversal rows are negative, so this flips the sign for callers that reason in amounts owed.
 */
export async function sumReversedForPaymentIntent(
  stripePaymentIntentId: string,
  /** Count only this kind of reversal — refund totals must not net off a dispute hold. */
  reason?: WalletReversalReason
): Promise<number> {
  const sql = getSql()
  const pi = stripePaymentIntentId.trim()
  if (!pi) return 0
  try {
    const rows = await sql`
      SELECT COALESCE(SUM(rev.amount), 0)::float8 AS reversed
      FROM wallet_transactions rev
      JOIN wallet_transactions orig ON orig.id = rev.reverses_transaction_id
      WHERE orig.stripe_payment_intent_id = ${pi}
        AND (${reason ?? null}::text IS NULL OR rev.reversal_reason = ${reason ?? null})
    `
    // Negative rows sum to a negative; report the magnitude taken back so far.
    return Math.abs(Number(rows[0]?.reversed ?? 0) || 0)
  } catch (e) {
    // Pre-154 there are no reversal rows at all, so nothing has been taken back.
    if (pgErrorCode(e) === "42703" || isMissingWalletSchemaError(e)) return 0
    throw e
  }
}

/**
 * Take money back out of the wallet after a refund or a dispute.
 *
 * Written as a NEW negative row rather than an edit of the original charge: partial refunds
 * cannot be expressed by a status flag, the collected history stays readable, and every total
 * in the app is already SUM(amount) so a negative row lowers it with no query changes.
 *
 * `reversalEventId` is the Stripe refund / dispute id and is stored in stripe_payment_intent_id,
 * which carries a unique index (migration 116). A webhook delivered twice therefore loses the
 * insert and changes nothing — the idempotency is the database's, not a check we can race.
 *
 * A charge still PENDING never credited the balance, so it is marked FAILED instead and no
 * negative row is written; subtracting there would invent money that was never added.
 */
export async function recordWalletReversal(params: {
  /** PaymentIntent of the ORIGINAL charge being taken back. */
  stripePaymentIntentId: string
  /** Stripe refund / dispute id — the idempotency key. */
  reversalEventId: string
  /** Positive dollars. Direction comes from `reason`, not the sign passed in. */
  amountUsd: number
  reason: WalletReversalReason
}): Promise<WalletTransaction | null> {
  const sql = getSql()
  const pi = params.stripePaymentIntentId.trim()
  const eventId = params.reversalEventId.trim()
  const magnitude = Math.round(Math.abs(Number(params.amountUsd)) * 100) / 100
  if (!pi || !eventId || !Number.isFinite(magnitude) || magnitude <= 0) return null

  const original = await findWalletTransactionByPaymentIntent(pi)
  if (!original) return null

  if (original.status === "PENDING") {
    // Never credited, so there is nothing to debit — just close it out.
    await failWalletTransactionByPaymentIntent(pi)
    return null
  }
  if (original.status === "FAILED") return null

  // Winning a dispute returns the money that DISPUTE took; everything else removes money.
  const signed = params.reason === "DISPUTE_WON" ? magnitude : -magnitude
  const id = crypto.randomUUID()

  try {
    try {
      await sql`
        INSERT INTO wallet_transactions
          (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
           reverses_transaction_id, reversal_reason, owner_user_id, entry_type, created_at)
        VALUES
          (
            ${id},
            ${original.userId},
            ${original.jobId},
            ${signed},
            'COMPLETED',
            ${original.paymentMethod},
            ${eventId},
            ${original.id},
            ${params.reason},
            ${original.ownerUserId},
            'REVERSAL',
            now()
          )
      `
    } catch (inner) {
      // Pre-migration 155: owner_user_id / entry_type columns missing.
      if (pgErrorCode(inner) !== "42703") throw inner
      await sql`
        INSERT INTO wallet_transactions
          (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
           reverses_transaction_id, reversal_reason, created_at)
        VALUES
          (
            ${id},
            ${original.userId},
            ${original.jobId},
            ${signed},
            'COMPLETED',
            ${original.paymentMethod},
            ${eventId},
            ${original.id},
            ${params.reason},
            now()
          )
      `
    }
  } catch (e) {
    // Same event delivered twice — the unique index already recorded it.
    if (isUniqueViolation(e)) return null
    if (isMissingWalletSchemaError(e) || pgErrorCode(e) === "42703") {
      console.error(
        "[tech-wallet] reversal could not be recorded — run scripts/154-wallet-reversals.sql",
        { paymentIntentId: pi, reversalEventId: eventId }
      )
      return null
    }
    throw e
  }

  await sql`
    UPDATE users
    SET balance = COALESCE(balance, 0) + ${signed}
    WHERE id = ${original.userId}
  `

  return await fetchWalletTransactionById(sql, id)
}

/**
 * Record money leaving the wallet for a bank transfer, the instant Stripe confirms the payout
 * was created — the ledger has to know the moment it happens, not days later on arrival.
 * Must never throw past a genuine payout success: the bank transfer already happened on
 * Stripe's side, so a ledger write failure here is a drift to reconcile, not a reason to make
 * the payout itself look like it failed.
 */
export async function recordWalletPayout(params: {
  ownerUserId: string
  amountUsd: number
  stripePayoutId: string
}): Promise<WalletTransaction | null> {
  const sql = getSql()
  const ownerUserId = params.ownerUserId.trim()
  const payoutId = params.stripePayoutId.trim()
  const magnitude = Math.round(Math.abs(Number(params.amountUsd)) * 100) / 100
  if (!ownerUserId || !payoutId || !Number.isFinite(magnitude) || magnitude <= 0) return null

  const id = crypto.randomUUID()
  const signed = -magnitude

  try {
    await sql`
      INSERT INTO wallet_transactions
        (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
         owner_user_id, entry_type, created_at)
      VALUES
        (${id}, ${ownerUserId}, NULL, ${signed}, 'COMPLETED', 'PAYOUT', ${payoutId},
         ${ownerUserId}, 'PAYOUT', now())
    `
  } catch (e) {
    // Same payout id recorded twice — idempotent, not an error.
    if (isUniqueViolation(e)) return null
    if (isMissingWalletSchemaError(e) || pgErrorCode(e) === "42703") {
      console.error(
        "[tech-wallet] payout could not be recorded on the ledger — run scripts/155-wallet-owner-and-payouts.sql",
        { stripePayoutId: payoutId }
      )
      return null
    }
    console.error("[tech-wallet] payout ledger write failed after a real Stripe payout", {
      stripePayoutId: payoutId,
      ownerUserId,
      error: e,
    })
    return null
  }

  return await fetchWalletTransactionById(sql, id)
}

/**
 * Record Stripe/Lyncr's own cut of a charge as its own ledger row, the moment the charge
 * settles — without this, the wallet balance overstates by the processing fee forever, since
 * wallet_transactions.amount on the CHARGE row is the full customer amount, not net of fees.
 * Never throws: the charge itself already succeeded and was already recorded by the time this
 * runs, so a fee-row failure is a (small, self-correcting) drift, not a reason to fail the charge.
 */
export async function recordWalletFee(params: {
  ownerUserId: string
  userId: string
  jobId: string | null
  amountUsd: number
  paymentMethod: WalletPaymentMethod
  /** PaymentIntent of the charge this fee was taken from — the idempotency key is derived from it. */
  stripePaymentIntentId: string
}): Promise<WalletTransaction | null> {
  const sql = getSql()
  const ownerUserId = params.ownerUserId.trim()
  const userId = params.userId.trim()
  const pi = params.stripePaymentIntentId.trim()
  const magnitude = Math.round(Math.abs(Number(params.amountUsd)) * 100) / 100
  if (!ownerUserId || !userId || !pi || !Number.isFinite(magnitude) || magnitude <= 0) return null

  const id = crypto.randomUUID()
  const signed = -magnitude
  const feeRef = `${pi}:fee`

  try {
    await sql`
      INSERT INTO wallet_transactions
        (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
         owner_user_id, entry_type, created_at)
      VALUES
        (${id}, ${userId}, ${params.jobId}, ${signed}, 'COMPLETED', ${params.paymentMethod}, ${feeRef},
         ${ownerUserId}, 'FEE', now())
    `
  } catch (e) {
    // Same charge's fee recorded twice — idempotent, not an error.
    if (isUniqueViolation(e)) return null
    if (isMissingWalletSchemaError(e) || pgErrorCode(e) === "42703") {
      console.error(
        "[tech-wallet] fee could not be recorded on the ledger — run scripts/156-wallet-fees-and-backfill.sql",
        { paymentIntentId: pi }
      )
      return null
    }
    console.error("[tech-wallet] fee ledger write failed after a real charge", {
      paymentIntentId: pi,
      ownerUserId,
      error: e,
    })
    return null
  }

  return await fetchWalletTransactionById(sql, id)
}
