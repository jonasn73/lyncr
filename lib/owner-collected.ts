// Owner "amount collected" — completed job payments (today / yesterday / week / month / all time).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { isMissingWalletSchemaError } from "@/lib/tech-wallet"
import { sanitizeIanaTimezone } from "@/lib/telemetry-timezone"

export type OwnerCollectedSummary = {
  /** Customer / wallet-settled dollars collected today (owner’s local calendar day). */
  todayCents: number
  /** Settled dollars for the previous local calendar day. */
  yesterdayCents: number
  /** Settled dollars since local Monday 00:00 (week-to-date). */
  weekCents: number
  /** Settled dollars collected since the start of the current month. */
  monthCents: number
  /** All settled dollars ever for this business. */
  allTimeCents: number
  /** Number of completed payment rows today. */
  todayCount: number
}

/**
 * Sum completed wallet ledger rows on jobs owned by this business.
 * When TECH_JOB_COMMISSION_RATE is 1 (default), wallet amount ≈ customer charge.
 * Day / week / month use the owner’s IANA timezone (not the UTC server clock).
 */
export async function getOwnerCollectedSummary(
  ownerUserId: string,
  timezone?: string | null
): Promise<OwnerCollectedSummary> {
  const empty: OwnerCollectedSummary = {
    todayCents: 0,
    yesterdayCents: 0,
    weekCents: 0,
    monthCents: 0,
    allTimeCents: 0,
    todayCount: 0,
  }
  const uid = ownerUserId.trim()
  if (!uid) return empty

  const sql = neon(resolveNeonDatabaseUrl())
  // Same sanitize path as Lines / routing telemetry so “today” matches the owner’s phone.
  const tz = sanitizeIanaTimezone(timezone)

  try {
    // Job payments (via ai_leads owner) + walk-up / ad-hoc charges on the owner's wallet.
    // Postgres timezone() + date_trunc so Louisville “yesterday” is not UTC “today”.
    const rows = await sql`
      SELECT
        COALESCE(SUM(wt.amount) FILTER (
          WHERE date_trunc('day', timezone(${tz}, wt.created_at))
            = date_trunc('day', timezone(${tz}, now()))
        ), 0)::float8 AS today_usd,
        COALESCE(SUM(wt.amount) FILTER (
          WHERE date_trunc('day', timezone(${tz}, wt.created_at))
            = date_trunc('day', timezone(${tz}, now()) - interval '1 day')
        ), 0)::float8 AS yesterday_usd,
        COALESCE(SUM(wt.amount) FILTER (
          WHERE date_trunc('week', timezone(${tz}, wt.created_at))
            = date_trunc('week', timezone(${tz}, now()))
        ), 0)::float8 AS week_usd,
        COALESCE(SUM(wt.amount) FILTER (
          WHERE date_trunc('month', timezone(${tz}, wt.created_at))
            = date_trunc('month', timezone(${tz}, now()))
        ), 0)::float8 AS month_usd,
        COALESCE(SUM(wt.amount), 0)::float8 AS all_time_usd,
        COALESCE(COUNT(*) FILTER (
          WHERE date_trunc('day', timezone(${tz}, wt.created_at))
            = date_trunc('day', timezone(${tz}, now()))
        ), 0)::int AS today_count
      FROM wallet_transactions wt
      LEFT JOIN ai_leads al ON al.id = wt.job_id
      WHERE wt.status = 'COMPLETED'
        AND wt.amount > 0
        AND (
          al.user_id = ${uid}
          OR (wt.job_id IS NULL AND wt.user_id = ${uid})
        )
    `
    const row = rows[0] as
      | {
          today_usd?: number
          yesterday_usd?: number
          week_usd?: number
          month_usd?: number
          all_time_usd?: number
          today_count?: number
        }
      | undefined
    const todayUsd = Number(row?.today_usd ?? 0) || 0
    const yesterdayUsd = Number(row?.yesterday_usd ?? 0) || 0
    const weekUsd = Number(row?.week_usd ?? 0) || 0
    const monthUsd = Number(row?.month_usd ?? 0) || 0
    const allTimeUsd = Number(row?.all_time_usd ?? 0) || 0
    return {
      todayCents: Math.round(todayUsd * 100),
      yesterdayCents: Math.round(yesterdayUsd * 100),
      weekCents: Math.round(weekUsd * 100),
      monthCents: Math.round(monthUsd * 100),
      allTimeCents: Math.round(allTimeUsd * 100),
      todayCount: Number(row?.today_count ?? 0) || 0,
    }
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return empty
    console.warn("[owner-collected] summary failed:", e)
    return empty
  }
}

/** Null/undefined = still loading — never paint "$0" as a fake loaded total. */
export function formatCollectedDollars(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—"
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

export type OwnerCollectedTransaction = {
  id: string
  /** USD dollars (wallet_transactions.amount). */
  amount: number
  status: "PENDING" | "COMPLETED" | "FAILED"
  paymentMethod: "TAP_TO_PAY" | "MANUAL_CARD" | "CASH"
  createdAt: string
  jobId: string | null
  customerName: string | null
  customerPhone: string | null
  jobLabel: string | null
  stripePaymentIntentId: string | null
  tipCents: number | null
  hasSignature: boolean
}

/**
 * Wallet-facing status for one charge (shown on transaction rows, not the header chip).
 * Card/Tap funds usually sit in Stripe Pending ~2 days before Available.
 */
export type CollectedChargeWalletStatus = "pending" | "clearing" | "paid" | "failed"

/** Stripe typically makes card funds transferable after ~2 days. */
const CARD_CLEARING_MS = 48 * 60 * 60 * 1000

export function collectedChargeWalletStatus(
  tx: Pick<OwnerCollectedTransaction, "status" | "createdAt" | "paymentMethod">,
  nowMs: number = Date.now()
): CollectedChargeWalletStatus {
  if (tx.status === "FAILED") return "failed"
  if (tx.status === "PENDING") return "pending"
  // Cash never goes through Stripe clearing.
  if (tx.paymentMethod === "CASH") return "paid"
  const created = new Date(tx.createdAt).getTime()
  if (!Number.isFinite(created)) return "paid"
  if (nowMs - created < CARD_CLEARING_MS) return "clearing"
  return "paid"
}

export function collectedChargeWalletLabel(status: CollectedChargeWalletStatus): string {
  if (status === "failed") return "Failed"
  if (status === "pending") return "Pending"
  if (status === "clearing") return "Clearing"
  return "Paid"
}

/** Abandoned Collect attempts stay PENDING forever — hide them after 20 minutes. */
const STALE_PENDING_MS = 20 * 60 * 1000

export function isStalePendingCollectedCharge(
  tx: Pick<OwnerCollectedTransaction, "status" | "createdAt">,
  nowMs: number = Date.now()
): boolean {
  if (tx.status !== "PENDING") return false
  const created = new Date(tx.createdAt).getTime()
  if (!Number.isFinite(created)) return true
  return nowMs - created > STALE_PENDING_MS
}

/**
 * A stale PENDING row usually means a genuinely abandoned Collect attempt, but it can also mean
 * a missed webhook delivery on a charge that actually succeeded (or actually failed) on Stripe
 * — in which case just hiding it (see isStalePendingCollectedCharge) makes real money invisible
 * with no trail. Best-effort reconcile a bounded number of stale rows against Stripe before the
 * caller filters: a resolved charge flips to COMPLETED/FAILED and stays visible either way; an
 * unresolvable one (Stripe error, Connect not ready) is left PENDING and still gets hidden as
 * before rather than blocking the whole list.
 */
const STALE_RECONCILE_MAX_PER_CALL = 5

async function reconcileStalePendingTransactions(
  ownerUserId: string,
  transactions: OwnerCollectedTransaction[]
): Promise<OwnerCollectedTransaction[]> {
  const stale = transactions.filter(
    (tx) => isStalePendingCollectedCharge(tx) && tx.stripePaymentIntentId
  )
  if (stale.length === 0) return transactions

  const { isStripeConfigured } = await import("@/lib/stripe-config")
  if (!isStripeConfigured()) return transactions

  let connectAccountId: string
  try {
    const { requireConnectReady } = await import("@/lib/stripe-connect")
    connectAccountId = (await requireConnectReady(ownerUserId)).accountId
  } catch {
    return transactions
  }

  const { confirmJobPaymentIntent } = await import("@/lib/job-payments")
  const resolved = new Map<string, "COMPLETED" | "FAILED">()
  for (const tx of stale.slice(0, STALE_RECONCILE_MAX_PER_CALL)) {
    try {
      const result = await confirmJobPaymentIntent(tx.stripePaymentIntentId!, {
        stripeConnectAccountId: connectAccountId,
      })
      if (result.status === "succeeded" || result.status === "already_completed") {
        resolved.set(tx.id, "COMPLETED")
      } else if (result.status === "failed") {
        resolved.set(tx.id, "FAILED")
      }
    } catch (e) {
      console.warn("[owner-collected] stale pending reconcile failed:", tx.stripePaymentIntentId, e)
    }
  }
  if (resolved.size === 0) return transactions
  return transactions.map((tx) => (resolved.has(tx.id) ? { ...tx, status: resolved.get(tx.id)! } : tx))
}

export type ListOwnerCollectedOptions = {
  /** Max rows (1–200). Default 100. */
  limit?: number
  /** Search name, phone digits, or job label (vehicle / job type). */
  q?: string
}

/** Digits-only phone fragment for ILIKE matching against E.164. */
function searchPhoneDigits(q: string): string {
  return q.replace(/\D/g, "").slice(0, 15)
}

/**
 * Recent wallet ledger rows for this business (job payments + walk-up charges).
 * Includes pending/failed so owners can look up cards that did not settle.
 * Prefer CRM display_name when the job phone matches a saved customer.
 */
export async function listOwnerCollectedTransactions(
  ownerUserId: string,
  limitOrOpts: number | ListOwnerCollectedOptions = 100
): Promise<OwnerCollectedTransaction[]> {
  const uid = ownerUserId.trim()
  if (!uid) return []

  const opts: ListOwnerCollectedOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts ?? {}
  const sql = neon(resolveNeonDatabaseUrl())
  const safeLimit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 100)))
  const qRaw = (opts.q ?? "").trim()
  const qLike = qRaw ? `%${qRaw.replace(/[%_]/g, "")}%` : ""
  const phoneDigits = searchPhoneDigits(qRaw)
  const phoneLike = phoneDigits.length >= 3 ? `%${phoneDigits}%` : ""
  const hasSearch = Boolean(qLike)

  try {
    // Walk-up rows store contact on wt.customer_* (migration 124); job rows use ai_leads + CRM.
    const rows = hasSearch
      ? await sql`
          SELECT
            wt.id::text AS id,
            wt.amount::float8 AS amount,
            wt.status,
            wt.payment_method,
            wt.created_at,
            wt.job_id::text AS job_id,
            wt.stripe_payment_intent_id,
            COALESCE(
              NULLIF(TRIM(al.caller_e164), ''),
              NULLIF(TRIM(wt.customer_phone), '')
            ) AS caller_e164,
            COALESCE(
              NULLIF(TRIM(crm.display_name), ''),
              NULLIF(TRIM(wt.customer_name), ''),
              NULLIF(TRIM(al.collected->>'customer_name'), ''),
              NULLIF(TRIM(al.collected->>'name'), ''),
              NULLIF(TRIM(al.collected->>'caller_name'), ''),
              NULLIF(TRIM(cpl.customer_name), '')
            ) AS customer_name,
            NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
            NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
            NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
            NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type,
            ps.tip_cents,
            CASE WHEN ps.signature_png IS NOT NULL AND ps.signature_png <> '' THEN true ELSE false END AS has_signature
          FROM wallet_transactions wt
          LEFT JOIN ai_leads al ON al.id = wt.job_id
          LEFT JOIN customers crm
            ON crm.user_id = ${uid}
            AND (
              (al.caller_e164 IS NOT NULL AND crm.phone_e164 = al.caller_e164)
              OR (
                NULLIF(TRIM(wt.customer_phone), '') IS NOT NULL
                AND crm.phone_e164 = wt.customer_phone
              )
            )
          LEFT JOIN LATERAL (
            SELECT cpl0.customer_name
            FROM collect_pay_links cpl0
            WHERE cpl0.owner_user_id = ${uid}
              AND wt.job_id IS NOT NULL
              AND cpl0.job_id = wt.job_id::text
              AND NULLIF(TRIM(cpl0.customer_name), '') IS NOT NULL
            ORDER BY cpl0.created_at DESC
            LIMIT 1
          ) cpl ON true
          LEFT JOIN payment_slips ps ON ps.stripe_payment_intent_id = wt.stripe_payment_intent_id
          WHERE
            (al.user_id = ${uid} OR (wt.job_id IS NULL AND wt.user_id = ${uid}))
            AND (
              COALESCE(
                NULLIF(TRIM(crm.display_name), ''),
                NULLIF(TRIM(wt.customer_name), ''),
                NULLIF(TRIM(al.collected->>'customer_name'), ''),
                NULLIF(TRIM(al.collected->>'name'), ''),
                NULLIF(TRIM(al.collected->>'caller_name'), ''),
                NULLIF(TRIM(cpl.customer_name), '')
              ) ILIKE ${qLike}
              OR COALESCE(al.caller_e164, '') ILIKE ${qLike}
              OR COALESCE(wt.customer_phone, '') ILIKE ${qLike}
              OR COALESCE(wt.customer_name, '') ILIKE ${qLike}
              OR (
                ${phoneLike} <> ''
                AND (
                  regexp_replace(COALESCE(al.caller_e164, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}
                  OR regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}
                )
              )
              OR COALESCE(al.collected->>'vehicle_make', '') ILIKE ${qLike}
              OR COALESCE(al.collected->>'vehicle_model', '') ILIKE ${qLike}
              OR COALESCE(al.collected->>'job_type', '') ILIKE ${qLike}
            )
          ORDER BY wt.created_at DESC
          LIMIT ${safeLimit}
        `
      : await sql`
          SELECT
            wt.id::text AS id,
            wt.amount::float8 AS amount,
            wt.status,
            wt.payment_method,
            wt.created_at,
            wt.job_id::text AS job_id,
            wt.stripe_payment_intent_id,
            COALESCE(
              NULLIF(TRIM(al.caller_e164), ''),
              NULLIF(TRIM(wt.customer_phone), '')
            ) AS caller_e164,
            COALESCE(
              NULLIF(TRIM(crm.display_name), ''),
              NULLIF(TRIM(wt.customer_name), ''),
              NULLIF(TRIM(al.collected->>'customer_name'), ''),
              NULLIF(TRIM(al.collected->>'name'), ''),
              NULLIF(TRIM(al.collected->>'caller_name'), ''),
              NULLIF(TRIM(cpl.customer_name), '')
            ) AS customer_name,
            NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
            NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
            NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
            NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type,
            ps.tip_cents,
            CASE WHEN ps.signature_png IS NOT NULL AND ps.signature_png <> '' THEN true ELSE false END AS has_signature
          FROM wallet_transactions wt
          LEFT JOIN ai_leads al ON al.id = wt.job_id
          LEFT JOIN customers crm
            ON crm.user_id = ${uid}
            AND (
              (al.caller_e164 IS NOT NULL AND crm.phone_e164 = al.caller_e164)
              OR (
                NULLIF(TRIM(wt.customer_phone), '') IS NOT NULL
                AND crm.phone_e164 = wt.customer_phone
              )
            )
          LEFT JOIN LATERAL (
            SELECT cpl0.customer_name
            FROM collect_pay_links cpl0
            WHERE cpl0.owner_user_id = ${uid}
              AND wt.job_id IS NOT NULL
              AND cpl0.job_id = wt.job_id::text
              AND NULLIF(TRIM(cpl0.customer_name), '') IS NOT NULL
            ORDER BY cpl0.created_at DESC
            LIMIT 1
          ) cpl ON true
          LEFT JOIN payment_slips ps ON ps.stripe_payment_intent_id = wt.stripe_payment_intent_id
          WHERE
            al.user_id = ${uid}
            OR (wt.job_id IS NULL AND wt.user_id = ${uid})
          ORDER BY wt.created_at DESC
          LIMIT ${safeLimit}
        `

    const mapped = (rows as Record<string, unknown>[]).map(mapOwnerCollectedRow)
    const reconciled = await reconcileStalePendingTransactions(uid, mapped)
    return reconciled.filter((tx) => !isStalePendingCollectedCharge(tx))
  } catch (e) {
    // payment_slips / customers / collect_pay_links / customer_phone missing — leaner query.
    const msg = e instanceof Error ? e.message : String(e)
    if (
      /payment_slips|customers|collect_pay_links|customer_phone|customer_name|vehicle_year|vehicle_make|job_type|column|relation/i.test(
        msg
      ) ||
      isMissingWalletSchemaError(e)
    ) {
      try {
        const rows = hasSearch
          ? await sql`
              SELECT
                wt.id::text AS id,
                wt.amount::float8 AS amount,
                wt.status,
                wt.payment_method,
                wt.created_at,
                wt.job_id::text AS job_id,
                wt.stripe_payment_intent_id,
                COALESCE(
                  NULLIF(TRIM(al.caller_e164), ''),
                  NULLIF(TRIM(wt.customer_phone), '')
                ) AS caller_e164,
                COALESCE(
                  NULLIF(TRIM(wt.customer_name), ''),
                  NULLIF(TRIM(al.collected->>'customer_name'), ''),
                  NULLIF(TRIM(al.collected->>'name'), ''),
                  NULLIF(TRIM(al.collected->>'caller_name'), '')
                ) AS customer_name,
                NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
                NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
                NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
                NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type
              FROM wallet_transactions wt
              LEFT JOIN ai_leads al ON al.id = wt.job_id
              WHERE
                (al.user_id = ${uid} OR (wt.job_id IS NULL AND wt.user_id = ${uid}))
                AND (
                  COALESCE(
                    NULLIF(TRIM(wt.customer_name), ''),
                    NULLIF(TRIM(al.collected->>'customer_name'), ''),
                    NULLIF(TRIM(al.collected->>'name'), ''),
                    NULLIF(TRIM(al.collected->>'caller_name'), '')
                  ) ILIKE ${qLike}
                  OR COALESCE(al.caller_e164, '') ILIKE ${qLike}
                  OR COALESCE(wt.customer_phone, '') ILIKE ${qLike}
                  OR COALESCE(wt.customer_name, '') ILIKE ${qLike}
                  OR (
                    ${phoneLike} <> ''
                    AND (
                      regexp_replace(COALESCE(al.caller_e164, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}
                      OR regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}
                    )
                  )
                  OR COALESCE(al.collected->>'vehicle_make', '') ILIKE ${qLike}
                  OR COALESCE(al.collected->>'vehicle_model', '') ILIKE ${qLike}
                  OR COALESCE(al.collected->>'job_type', '') ILIKE ${qLike}
                )
              ORDER BY wt.created_at DESC
              LIMIT ${safeLimit}
            `
          : await sql`
              SELECT
                wt.id::text AS id,
                wt.amount::float8 AS amount,
                wt.status,
                wt.payment_method,
                wt.created_at,
                wt.job_id::text AS job_id,
                wt.stripe_payment_intent_id,
                COALESCE(
                  NULLIF(TRIM(al.caller_e164), ''),
                  NULLIF(TRIM(wt.customer_phone), '')
                ) AS caller_e164,
                COALESCE(
                  NULLIF(TRIM(wt.customer_name), ''),
                  NULLIF(TRIM(al.collected->>'customer_name'), ''),
                  NULLIF(TRIM(al.collected->>'name'), ''),
                  NULLIF(TRIM(al.collected->>'caller_name'), '')
                ) AS customer_name,
                NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
                NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
                NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
                NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type
              FROM wallet_transactions wt
              LEFT JOIN ai_leads al ON al.id = wt.job_id
              WHERE
                al.user_id = ${uid}
                OR (wt.job_id IS NULL AND wt.user_id = ${uid})
              ORDER BY wt.created_at DESC
              LIMIT ${safeLimit}
            `
        return (rows as Record<string, unknown>[])
          .map(mapOwnerCollectedRow)
          .filter((tx) => !isStalePendingCollectedCharge(tx))
      } catch (e2) {
        if (isMissingWalletSchemaError(e2)) return []
        console.warn("[owner-collected] list fallback failed:", e2)
        return []
      }
    }
    console.warn("[owner-collected] list failed:", e)
    return []
  }
}

/** Last 10 digits of a phone — same key CRM uses to match people. */
function phoneLast10(phone: string): string {
  const d = phone.replace(/\D/g, "")
  return d.length >= 10 ? d.slice(-10) : d
}

/**
 * Wallet charges for one customer phone (walk-up + job payments).
 * Matches last-10 digits on wallet customer_phone or job caller_e164.
 */
export async function listOwnerCollectedTransactionsForPhone(
  ownerUserId: string,
  phoneE164: string,
  limit = 50
): Promise<OwnerCollectedTransaction[]> {
  const uid = ownerUserId.trim()
  const digits = phoneLast10(phoneE164)
  if (!uid || digits.length < 10) return []

  const sql = neon(resolveNeonDatabaseUrl())
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))

  try {
    const rows = await sql`
      SELECT
        wt.id::text AS id,
        wt.amount::float8 AS amount,
        wt.status,
        wt.payment_method,
        wt.created_at,
        wt.job_id::text AS job_id,
        wt.stripe_payment_intent_id,
        COALESCE(
          NULLIF(TRIM(al.caller_e164), ''),
          NULLIF(TRIM(wt.customer_phone), '')
        ) AS caller_e164,
        COALESCE(
          NULLIF(TRIM(crm.display_name), ''),
          NULLIF(TRIM(wt.customer_name), ''),
          NULLIF(TRIM(al.collected->>'customer_name'), ''),
          NULLIF(TRIM(al.collected->>'name'), ''),
          NULLIF(TRIM(al.collected->>'caller_name'), '')
        ) AS customer_name,
        -- Labels are only on ai_leads.collected (no top-level vehicle_*/job_type columns).
        NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
        NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
        NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
        NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type,
        ps.tip_cents,
        CASE WHEN ps.signature_png IS NOT NULL AND ps.signature_png <> '' THEN true ELSE false END AS has_signature
      FROM wallet_transactions wt
      LEFT JOIN ai_leads al ON al.id = wt.job_id
      LEFT JOIN customers crm
        ON crm.user_id = ${uid}
        AND (
          (al.caller_e164 IS NOT NULL AND crm.phone_e164 = al.caller_e164)
          OR (
            NULLIF(TRIM(wt.customer_phone), '') IS NOT NULL
            AND crm.phone_e164 = wt.customer_phone
          )
        )
      LEFT JOIN payment_slips ps ON ps.stripe_payment_intent_id = wt.stripe_payment_intent_id
      WHERE
        (al.user_id = ${uid} OR (wt.job_id IS NULL AND wt.user_id = ${uid}))
        AND (
          right(regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
          OR right(regexp_replace(COALESCE(al.caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${digits}
        )
      ORDER BY wt.created_at DESC
      LIMIT ${safeLimit}
    `
    const mapped = (rows as Record<string, unknown>[]).map(mapOwnerCollectedRow)
    const reconciled = await reconcileStalePendingTransactions(uid, mapped)
    return reconciled.filter((tx) => !isStalePendingCollectedCharge(tx))
  } catch (e) {
    if (isMissingWalletSchemaError(e)) return []
    // Fallback without payment_slips / customers — still match walk-up by customer_phone digits.
    const msg = e instanceof Error ? e.message : String(e)
    if (/payment_slips|customers|customer_phone|customer_name|column|relation/i.test(msg)) {
      try {
        const rows = await sql`
          SELECT
            wt.id::text AS id,
            wt.amount::float8 AS amount,
            wt.status,
            wt.payment_method,
            wt.created_at,
            wt.job_id::text AS job_id,
            wt.stripe_payment_intent_id,
            COALESCE(
              NULLIF(TRIM(al.caller_e164), ''),
              NULLIF(TRIM(wt.customer_phone), '')
            ) AS caller_e164,
            COALESCE(
              NULLIF(TRIM(wt.customer_name), ''),
              NULLIF(TRIM(al.collected->>'customer_name'), ''),
              NULLIF(TRIM(al.collected->>'name'), ''),
              NULLIF(TRIM(al.collected->>'caller_name'), '')
            ) AS customer_name,
            NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
            NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
            NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
            NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type
          FROM wallet_transactions wt
          LEFT JOIN ai_leads al ON al.id = wt.job_id
          WHERE
            (al.user_id = ${uid} OR (wt.job_id IS NULL AND wt.user_id = ${uid}))
            AND (
              right(regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
              OR right(regexp_replace(COALESCE(al.caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${digits}
            )
          ORDER BY wt.created_at DESC
          LIMIT ${safeLimit}
        `
          return (rows as Record<string, unknown>[])
            .map(mapOwnerCollectedRow)
            .filter((tx) => !isStalePendingCollectedCharge(tx))
        } catch (e2) {
          if (isMissingWalletSchemaError(e2)) return []
          // Last resort: job-phone only (no customer_phone column on wallet yet).
        try {
          const rows = await sql`
            SELECT
              wt.id::text AS id,
              wt.amount::float8 AS amount,
              wt.status,
              wt.payment_method,
              wt.created_at,
              wt.job_id::text AS job_id,
              wt.stripe_payment_intent_id,
              al.caller_e164,
              COALESCE(
                NULLIF(TRIM(al.collected->>'customer_name'), ''),
                NULLIF(TRIM(al.collected->>'name'), ''),
                NULLIF(TRIM(al.collected->>'caller_name'), '')
              ) AS customer_name,
              NULLIF(TRIM(al.collected->>'vehicle_year'), '') AS vehicle_year,
              NULLIF(TRIM(al.collected->>'vehicle_make'), '') AS vehicle_make,
              NULLIF(TRIM(al.collected->>'vehicle_model'), '') AS vehicle_model,
              NULLIF(TRIM(al.collected->>'job_type'), '') AS job_type
            FROM wallet_transactions wt
            LEFT JOIN ai_leads al ON al.id = wt.job_id
            WHERE
              (al.user_id = ${uid} OR (wt.job_id IS NULL AND wt.user_id = ${uid}))
              AND right(regexp_replace(COALESCE(al.caller_e164, ''), '[^0-9]', '', 'g'), 10) = ${digits}
            ORDER BY wt.created_at DESC
            LIMIT ${safeLimit}
          `
          return (rows as Record<string, unknown>[])
            .map(mapOwnerCollectedRow)
            .filter((tx) => !isStalePendingCollectedCharge(tx))
        } catch (e3) {
          console.warn("[owner-collected] phone list fallback failed:", e3)
          return []
        }
      }
    }
    console.warn("[owner-collected] phone list failed:", e)
    return []
  }
}

/**
 * Walk-up (no job) completed wallet totals by last-10 phone digits.
 * Used to add Collect charges into CRM LTV without double-counting job quotes.
 */
export async function sumWalkUpCompletedCentsByPhoneDigits(
  ownerUserId: string,
  digitKeys: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const uid = ownerUserId.trim()
  const keys = digitKeys.filter((d) => d.length >= 10)
  if (!uid || keys.length === 0) return out

  const sql = neon(resolveNeonDatabaseUrl())
  try {
    const rows = (await sql`
      SELECT
        right(regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g'), 10) AS phone_key,
        COALESCE(SUM(wt.amount), 0)::float8 AS usd
      FROM wallet_transactions wt
      WHERE wt.user_id = ${uid}
        AND wt.job_id IS NULL
        AND wt.status = 'COMPLETED'
        AND wt.amount > 0
        AND right(regexp_replace(COALESCE(wt.customer_phone, ''), '[^0-9]', '', 'g'), 10) = ANY(${keys})
      GROUP BY 1
    `) as Record<string, unknown>[]

    for (const row of rows) {
      const key = String(row.phone_key ?? "")
      if (key.length < 10) continue
      const usd = Number(row.usd ?? 0) || 0
      out.set(key, Math.round(usd * 100))
    }
  } catch (e) {
    if (!isMissingWalletSchemaError(e)) {
      console.warn("[owner-collected] walk-up LTV agg failed:", e)
    }
  }
  return out
}

/** Sum completed payment dollars (as cents) from a transaction list. */
export function sumCompletedCollectedCents(transactions: OwnerCollectedTransaction[]): number {
  let cents = 0
  for (const tx of transactions) {
    if (tx.status !== "COMPLETED") continue
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) continue
    cents += Math.round(tx.amount * 100)
  }
  return cents
}

function mapOwnerCollectedRow(row: Record<string, unknown>): OwnerCollectedTransaction {
  const statusRaw = String(row.status || "PENDING").toUpperCase()
  const status: OwnerCollectedTransaction["status"] =
    statusRaw === "COMPLETED" || statusRaw === "FAILED" ? statusRaw : "PENDING"
  const methodRaw = String(row.payment_method || "MANUAL_CARD").toUpperCase()
  const paymentMethod: OwnerCollectedTransaction["paymentMethod"] =
    methodRaw === "TAP_TO_PAY" || methodRaw === "CASH" ? methodRaw : "MANUAL_CARD"
  const year = row.vehicle_year != null ? String(row.vehicle_year) : ""
  const make = row.vehicle_make != null ? String(row.vehicle_make) : ""
  const model = row.vehicle_model != null ? String(row.vehicle_model) : ""
  const jobType = row.job_type != null ? String(row.job_type).trim() : ""
  const vehicle = [year, make, model].filter(Boolean).join(" ").trim()
  return {
    id: String(row.id),
    amount: Number(row.amount ?? 0) || 0,
    status,
    paymentMethod,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
    jobId: row.job_id != null ? String(row.job_id) : null,
    customerName:
      row.customer_name != null && String(row.customer_name).trim()
        ? String(row.customer_name).trim()
        : null,
    customerPhone:
      row.caller_e164 != null && String(row.caller_e164).trim()
        ? String(row.caller_e164).trim()
        : null,
    jobLabel: vehicle || jobType || null,
    stripePaymentIntentId:
      row.stripe_payment_intent_id != null ? String(row.stripe_payment_intent_id) : null,
    tipCents:
      row.tip_cents != null && Number.isFinite(Number(row.tip_cents))
        ? Math.round(Number(row.tip_cents))
        : null,
    hasSignature: row.has_signature === true,
  }
}
