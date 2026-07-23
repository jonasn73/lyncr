// Persist tip + signature after Collect Payment (Neon payment_slips).

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getStripeClient } from "@/lib/stripe-config"
import { loadOwnedPaymentIntent } from "@/lib/payment-receipt-send"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingPaymentSlipsTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /payment_slips/i.test(msg) && /does not exist|undefined_table/i.test(msg)
}

export type PaymentSlipRow = {
  id: string
  user_id: string
  stripe_payment_intent_id: string
  tip_cents: number
  tip_payment_intent_id: string | null
  signature_png: string | null
  signed_at: string | null
}

/** Cap signature PNG data URLs (~120KB) so we don’t blow row size. */
export function sanitizeSignaturePng(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim()
  if (!s) return null
  if (!s.startsWith("data:image/png;base64,")) {
    throw new Error("Signature must be a PNG image")
  }
  if (s.length > 180_000) {
    throw new Error("Signature image is too large — clear and sign again")
  }
  return s
}

export async function upsertPaymentSlip(params: {
  userId: string
  paymentIntentId: string
  tipCents: number
  signaturePng?: string | null
  tipPaymentIntentId?: string | null
}): Promise<PaymentSlipRow> {
  const tipCents = Math.max(0, Math.round(params.tipCents))
  const signature = sanitizeSignaturePng(params.signaturePng)
  const signedAt = signature ? new Date().toISOString() : null

  // Confirm the actor owns this succeeded charge.
  await loadOwnedPaymentIntent(params.paymentIntentId, params.userId)

  const sql = getSql()
  try {
    const rows = await sql`
      INSERT INTO payment_slips (
        user_id,
        stripe_payment_intent_id,
        tip_cents,
        tip_payment_intent_id,
        signature_png,
        signed_at,
        updated_at
      )
      VALUES (
        ${params.userId},
        ${params.paymentIntentId},
        ${tipCents},
        ${params.tipPaymentIntentId ?? null},
        ${signature},
        ${signedAt},
        now()
      )
      ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
        tip_cents = EXCLUDED.tip_cents,
        tip_payment_intent_id = COALESCE(EXCLUDED.tip_payment_intent_id, payment_slips.tip_payment_intent_id),
        signature_png = COALESCE(EXCLUDED.signature_png, payment_slips.signature_png),
        signed_at = COALESCE(EXCLUDED.signed_at, payment_slips.signed_at),
        updated_at = now()
      RETURNING
        id::text,
        user_id::text,
        stripe_payment_intent_id,
        tip_cents,
        tip_payment_intent_id,
        signature_png,
        signed_at::text
    `
    const row = rows[0] as Record<string, unknown>
    // Mirror tip on the PaymentIntent for receipts / Stripe Dashboard.
    try {
      const stripe = getStripeClient()
      const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId)
      await stripe.paymentIntents.update(params.paymentIntentId, {
        metadata: {
          ...intent.metadata,
          tip_cents: String(tipCents),
          has_signature: signature ? "1" : "0",
        },
      })
    } catch (e) {
      console.warn("[payment-slips] PI metadata update failed", e)
    }

    return {
      id: String(row.id),
      user_id: String(row.user_id),
      stripe_payment_intent_id: String(row.stripe_payment_intent_id),
      tip_cents: Number(row.tip_cents ?? 0),
      tip_payment_intent_id: row.tip_payment_intent_id
        ? String(row.tip_payment_intent_id)
        : null,
      signature_png: row.signature_png ? String(row.signature_png) : null,
      signed_at: row.signed_at ? String(row.signed_at) : null,
    }
  } catch (e) {
    if (isMissingPaymentSlipsTable(e)) {
      throw new Error(
        "Database needs migration 112 — run scripts/112-payment-slips.sql in Neon SQL Editor"
      )
    }
    throw e
  }
}

export async function getPaymentSlipByIntent(
  paymentIntentId: string,
  userId: string
): Promise<PaymentSlipRow | null> {
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT
        id::text,
        user_id::text,
        stripe_payment_intent_id,
        tip_cents,
        tip_payment_intent_id,
        signature_png,
        signed_at::text
      FROM payment_slips
      WHERE stripe_payment_intent_id = ${paymentIntentId}
        AND user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      stripe_payment_intent_id: String(row.stripe_payment_intent_id),
      tip_cents: Number(row.tip_cents ?? 0),
      tip_payment_intent_id: row.tip_payment_intent_id
        ? String(row.tip_payment_intent_id)
        : null,
      signature_png: row.signature_png ? String(row.signature_png) : null,
      signed_at: row.signed_at ? String(row.signed_at) : null,
    }
  } catch (e) {
    if (isMissingPaymentSlipsTable(e)) return null
    throw e
  }
}
