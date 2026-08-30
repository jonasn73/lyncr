// GET /api/admin/backfill-wallet-history — admin@lyncr.app only.
//
// One-time repair: the wallet ledger only started recording payouts (migration 155) and fees
// (migration 156) going forward from when that code deployed. Every payout sent, and every
// Stripe/Lyncr fee taken, BEFORE that point is real and already happened, but has no ledger
// row — inflating every business's wallet balance by exactly that much. This walks every
// connected account's real Stripe history and inserts the missing rows, using the same
// idempotency keys (`payout.id`, `${paymentIntentId}:fee`) the live code uses, so it's safe
// to run more than once and can never double-count against what the live code already wrote.
//
// Defaults to a dry run. Delete this route once every business's ledger has been backfilled —
// it is a one-time repair tool, same as scripts/repair-stuck-wallet-payments.ts was.

import { NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

export const dynamic = "force-dynamic"

type OwnerRow = { user_id: string; business_name: string; stripe_connect_account_id: string }

type BackfillRowResult = {
  kind: "payout" | "fee"
  stripe_ref: string
  amount: number
  created_at: string
  outcome: "would_insert" | "inserted" | "already_present" | "skipped_no_payment_intent"
}

type BusinessResult = {
  user_id: string
  business_name: string
  stripe_connect_account_id: string
  payouts_found: number
  fees_found: number
  rows: BackfillRowResult[]
  error?: string
}

async function listAllPayouts(
  stripe: ReturnType<typeof getStripeClient>,
  accountId: string
): Promise<{ id: string; amount: number; created: number }[]> {
  const out: { id: string; amount: number; created: number }[] = []
  let startingAfter: string | undefined
  for (let page = 0; page < 20; page++) {
    const batch = await stripe.payouts.list(
      { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      { stripeAccount: accountId }
    )
    for (const p of batch.data) {
      if (p.status === "paid" && (p.currency || "").toLowerCase() === "usd") {
        out.push({ id: p.id, amount: p.amount, created: p.created })
      }
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }
  return out
}

/**
 * Application Fees List is a platform-wide endpoint — Stripe has no per-account filter for it
 * (confirmed against lib/admin-business-economics.ts's fetchApplicationFeesByConnectAccount,
 * which groups client-side by fee.account for the same reason). Fetch once, group by account,
 * instead of re-paging full platform history once per business.
 */
async function listAllFeesByAccount(
  stripe: ReturnType<typeof getStripeClient>
): Promise<Map<string, { paymentIntentId: string; amount: number; created: number }[]>> {
  const byAccount = new Map<string, { paymentIntentId: string; amount: number; created: number }[]>()
  let startingAfter: string | undefined
  for (let page = 0; page < 50; page++) {
    const batch = await stripe.applicationFees.list({
      limit: 100,
      expand: ["data.charge"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const fee of batch.data) {
      if ((fee.currency || "").toLowerCase() !== "usd") continue
      const net = Math.max(0, (fee.amount || 0) - (fee.amount_refunded || 0))
      if (net <= 0) continue
      const acct =
        typeof fee.account === "string"
          ? fee.account
          : fee.account && "id" in fee.account
            ? String((fee.account as { id?: string }).id ?? "")
            : ""
      if (!acct) continue
      const charge = fee.charge
      const pi =
        charge && typeof charge === "object" && "payment_intent" in charge
          ? typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent as { id?: string } | null)?.id
          : null
      if (!pi) continue
      const list = byAccount.get(acct) ?? []
      list.push({ paymentIntentId: pi, amount: net, created: fee.created })
      byAccount.set(acct, list)
    }
    if (!batch.has_more || batch.data.length === 0) break
    startingAfter = batch.data[batch.data.length - 1]?.id
    if (!startingAfter) break
  }
  return byAccount
}

export async function GET(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured (STRIPE_SECRET_KEY)" }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get("dryRun") !== "false"
  const onlyUserId = (searchParams.get("userId") || "").trim() || null
  const diagnoseAccountId = (searchParams.get("diagnose") || "").trim() || null
  const checkPaymentIntentId = (searchParams.get("checkPi") || "").trim() || null

  const sql = neon(resolveNeonDatabaseUrl())
  const stripe = getStripeClient()

  if (checkPaymentIntentId && diagnoseAccountId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(checkPaymentIntentId, {
        stripeAccount: diagnoseAccountId,
      })
      return NextResponse.json({
        data: {
          id: intent.id,
          status: intent.status,
          amount: intent.amount / 100,
          amount_received: intent.amount_received / 100,
          created: new Date(intent.created * 1000).toISOString(),
          latest_charge: intent.latest_charge,
          application_fee_amount: (intent.application_fee_amount ?? 0) / 100,
          last_payment_error: intent.last_payment_error?.message ?? null,
        },
      })
    } catch (e) {
      return NextResponse.json({
        data: { id: checkPaymentIntentId, error: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  if (diagnoseAccountId) {
    const byType = new Map<string, { count: number; net: number }>()
    const rows: {
      id: string
      type: string
      amount: number
      net: number
      fee: number
      created: string
      description: string | null
      status: string
    }[] = []
    let startingAfter: string | undefined
    for (let page = 0; page < 30; page++) {
      const batch = await stripe.balanceTransactions.list(
        { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        { stripeAccount: diagnoseAccountId }
      )
      for (const tx of batch.data) {
        const entry = byType.get(tx.type) ?? { count: 0, net: 0 }
        entry.count++
        entry.net += tx.net
        byType.set(tx.type, entry)
        rows.push({
          id: tx.id,
          type: tx.type,
          amount: tx.amount / 100,
          net: tx.net / 100,
          fee: tx.fee / 100,
          created: new Date(tx.created * 1000).toISOString(),
          description: tx.description,
          status: tx.status,
        })
      }
      if (!batch.has_more || batch.data.length === 0) break
      startingAfter = batch.data[batch.data.length - 1]?.id
      if (!startingAfter) break
    }
    const byTypeOut: Record<string, { count: number; net_cents: number; net_usd: number }> = {}
    for (const [type, v] of byType) {
      byTypeOut[type] = { count: v.count, net_cents: v.net, net_usd: v.net / 100 }
    }
    const grandTotalCents = rows.reduce((s, r) => s + r.net * 100, 0)
    return NextResponse.json({
      data: {
        accountId: diagnoseAccountId,
        grand_total_net_usd: grandTotalCents / 100,
        by_type: byTypeOut,
        rows,
      },
    })
  }

  const owners = (await sql`
    SELECT u.id::text AS user_id,
           coalesce(nullif(trim(u.business_name), ''), 'Unnamed business') AS business_name,
           u.stripe_connect_account_id
    FROM users u
    WHERE coalesce(u.account_role, 'owner') = 'owner'
      AND nullif(trim(u.stripe_connect_account_id), '') IS NOT NULL
      AND (${onlyUserId}::text IS NULL OR u.id::text = ${onlyUserId})
    ORDER BY u.business_name ASC
  `) as OwnerRow[]

  const results: BusinessResult[] = []
  let totalInserted = 0
  let totalRecoveredCents = 0

  const feesByAccount = onlyUserId
    ? null // single-business dry run/apply — skip the full-platform fee pass, fetch per-account below
    : await listAllFeesByAccount(stripe)

  for (const owner of owners) {
    const accountId = owner.stripe_connect_account_id
    const businessResult: BusinessResult = {
      user_id: owner.user_id,
      business_name: owner.business_name,
      stripe_connect_account_id: accountId,
      payouts_found: 0,
      fees_found: 0,
      rows: [],
    }

    try {
      const [payouts, fees] = await Promise.all([
        listAllPayouts(stripe, accountId),
        feesByAccount
          ? Promise.resolve(feesByAccount.get(accountId) ?? [])
          : listAllFeesByAccount(stripe).then((m) => m.get(accountId) ?? []),
      ])
      businessResult.payouts_found = payouts.length
      businessResult.fees_found = fees.length

      for (const payout of payouts) {
        const existing = await sql`
          SELECT id FROM wallet_transactions WHERE stripe_payment_intent_id = ${payout.id} LIMIT 1
        `
        if (existing.length > 0) {
          businessResult.rows.push({
            kind: "payout",
            stripe_ref: payout.id,
            amount: payout.amount / 100,
            created_at: new Date(payout.created * 1000).toISOString(),
            outcome: "already_present",
          })
          continue
        }
        if (dryRun) {
          businessResult.rows.push({
            kind: "payout",
            stripe_ref: payout.id,
            amount: payout.amount / 100,
            created_at: new Date(payout.created * 1000).toISOString(),
            outcome: "would_insert",
          })
          continue
        }
        await sql`
          INSERT INTO wallet_transactions
            (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
             owner_user_id, entry_type, created_at)
          VALUES
            (gen_random_uuid(), ${owner.user_id}, NULL, ${-(payout.amount / 100)}, 'COMPLETED',
             'PAYOUT', ${payout.id}, ${owner.user_id}, 'PAYOUT', ${new Date(payout.created * 1000).toISOString()}::timestamptz)
          ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL DO NOTHING
        `
        totalInserted++
        totalRecoveredCents += payout.amount
        businessResult.rows.push({
          kind: "payout",
          stripe_ref: payout.id,
          amount: payout.amount / 100,
          created_at: new Date(payout.created * 1000).toISOString(),
          outcome: "inserted",
        })
      }

      for (const fee of fees) {
        const feeRef = `${fee.paymentIntentId}:fee`
        const chargeRow = await sql`
          SELECT id, user_id, job_id, payment_method
          FROM wallet_transactions
          WHERE stripe_payment_intent_id = ${fee.paymentIntentId}
          LIMIT 1
        `
        if (chargeRow.length === 0) {
          businessResult.rows.push({
            kind: "fee",
            stripe_ref: feeRef,
            amount: fee.amount / 100,
            created_at: new Date(fee.created * 1000).toISOString(),
            outcome: "skipped_no_payment_intent",
          })
          continue
        }
        const existing = await sql`
          SELECT id FROM wallet_transactions WHERE stripe_payment_intent_id = ${feeRef} LIMIT 1
        `
        if (existing.length > 0) {
          businessResult.rows.push({
            kind: "fee",
            stripe_ref: feeRef,
            amount: fee.amount / 100,
            created_at: new Date(fee.created * 1000).toISOString(),
            outcome: "already_present",
          })
          continue
        }
        if (dryRun) {
          businessResult.rows.push({
            kind: "fee",
            stripe_ref: feeRef,
            amount: fee.amount / 100,
            created_at: new Date(fee.created * 1000).toISOString(),
            outcome: "would_insert",
          })
          continue
        }
        const charge = chargeRow[0] as { user_id: string; job_id: string | null; payment_method: string }
        await sql`
          INSERT INTO wallet_transactions
            (id, user_id, job_id, amount, status, payment_method, stripe_payment_intent_id,
             owner_user_id, entry_type, created_at)
          VALUES
            (gen_random_uuid(), ${charge.user_id}, ${charge.job_id}, ${-(fee.amount / 100)}, 'COMPLETED',
             ${charge.payment_method}, ${feeRef}, ${owner.user_id}, 'FEE', ${new Date(fee.created * 1000).toISOString()}::timestamptz)
          ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL DO NOTHING
        `
        totalInserted++
        totalRecoveredCents += fee.amount
        businessResult.rows.push({
          kind: "fee",
          stripe_ref: feeRef,
          amount: fee.amount / 100,
          created_at: new Date(fee.created * 1000).toISOString(),
          outcome: "inserted",
        })
      }
    } catch (e) {
      businessResult.error = e instanceof Error ? e.message : String(e)
    }

    results.push(businessResult)
  }

  return NextResponse.json({
    data: {
      dryRun,
      businesses_checked: owners.length,
      total_inserted: totalInserted,
      total_recovered_cents: totalRecoveredCents,
      results,
    },
  })
}
