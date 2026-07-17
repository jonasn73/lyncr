// Technician wallet ledger — users.balance + wallet_transactions (scripts/111).
// Server-only (Neon). Powers /api/tech/wallet and invoice collect → earnings.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

export type WalletTransactionStatus = "PENDING" | "COMPLETED" | "FAILED"
export type WalletPaymentMethod = "TAP_TO_PAY" | "MANUAL_CARD" | "CASH"

export type WalletTransaction = {
  id: string
  userId: string
  jobId: string | null
  amount: number
  status: WalletTransactionStatus
  paymentMethod: WalletPaymentMethod
  stripePaymentIntentId: string | null
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
    methodRaw === "TAP_TO_PAY" || methodRaw === "MANUAL_CARD" ? methodRaw : "CASH"
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
    createdAt: created,
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
}): Promise<WalletTransaction | null> {
  const sql = getSql()
  const id = crypto.randomUUID()
  const amount = Math.round(Number(params.amountUsd) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null

  try {
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

    if (params.status === "COMPLETED") {
      await sql`
        UPDATE users
        SET balance = COALESCE(balance, 0) + ${amount}
        WHERE id = ${params.userId}
      `
    }

    const rows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE id = ${id}
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
  } catch (e) {
    if (isMissingWalletSchemaError(e)) {
      console.warn("[tech-wallet] migration 111 not applied — skipped transaction")
      return null
    }
    throw e
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

    await sql`
      UPDATE wallet_transactions
      SET status = 'COMPLETED'
      WHERE id = ${transactionId}
        AND user_id = ${techUserId}
        AND status = 'PENDING'
    `
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
    const rows = await sql`
      SELECT
        id, user_id, job_id, amount, status, payment_method,
        stripe_payment_intent_id, created_at
      FROM wallet_transactions
      WHERE stripe_payment_intent_id = ${pi}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] ? mapTransaction(rows[0] as Record<string, unknown>) : null
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
