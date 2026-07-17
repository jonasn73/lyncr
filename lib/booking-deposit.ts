// Booking deposit holds — Stripe Checkout for /book when require_deposit is on.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getAppUrl } from "@/lib/telnyx"
import { getStripeClient } from "@/lib/stripe-config"
import { getUser } from "@/lib/db"
import { createUnassignedJobFromIntake } from "@/lib/create-intake-job"

function sqlClient() {
  return neon(resolveNeonDatabaseUrl())
}

export const DEFAULT_BOOKING_DEPOSIT_CENTS = 2500
/** Non-refundable special-order retainer when key is out of stock / specialty. */
export const SPECIAL_ORDER_RETAINER_CENTS = 5000

export async function getUserRequireDeposit(ownerUserId: string): Promise<boolean> {
  const sql = sqlClient()
  try {
    const rows = await sql`
      SELECT require_deposit FROM users WHERE id = ${ownerUserId} LIMIT 1
    `
    return (rows[0] as { require_deposit?: boolean } | undefined)?.require_deposit === true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("require_deposit")) return false
    throw e
  }
}

export async function setUserRequireDeposit(ownerUserId: string, require: boolean): Promise<void> {
  const sql = sqlClient()
  await sql`
    UPDATE users SET require_deposit = ${require === true} WHERE id = ${ownerUserId}
  `
}

export async function createBookingHold(params: {
  ownerUserId: string
  businessLine: string | null
  customerPhone: string | null
  customerName?: string | null
  scheduledAtIso: string
  amountCents?: number
}): Promise<{ id: string; amountCents: number }> {
  const sql = sqlClient()
  const amount = params.amountCents ?? DEFAULT_BOOKING_DEPOSIT_CENTS
  const rows = await sql`
    INSERT INTO booking_holds (
      owner_user_id, business_line, customer_phone, customer_name,
      scheduled_at, amount_cents, status
    ) VALUES (
      ${params.ownerUserId},
      ${params.businessLine},
      ${params.customerPhone},
      ${params.customerName || null},
      ${params.scheduledAtIso},
      ${amount},
      'pending'
    )
    RETURNING id
  `
  const id = String((rows[0] as { id: string }).id)
  return { id, amountCents: amount }
}

export async function attachStripeSessionToHold(
  holdId: string,
  sessionId: string
): Promise<void> {
  const sql = sqlClient()
  await sql`
    UPDATE booking_holds
    SET stripe_checkout_session_id = ${sessionId}, updated_at = now()
    WHERE id = ${holdId}
  `
}

export async function createBookingDepositCheckout(params: {
  ownerUserId: string
  holdId: string
  amountCents: number
  customerEmail?: string | null
  /** Special-order $50 retainer vs standard booking hold. */
  purpose?: "booking_deposit" | "special_order_retainer"
  productName?: string
  productDescription?: string
  successPath?: string
  cancelPath?: string
}): Promise<{ url: string; sessionId: string }> {
  const owner = await getUser(params.ownerUserId)
  void owner
  const appUrl = getAppUrl().replace(/\/$/, "")
  const stripe = getStripeClient()
  const purpose = params.purpose ?? "booking_deposit"
  const successPath =
    params.successPath ??
    (purpose === "special_order_retainer"
      ? `/dashboard/leads?deposit=success&hold=${params.holdId}`
      : `/book?deposit=success&hold=${params.holdId}`)
  const cancelPath =
    params.cancelPath ??
    (purpose === "special_order_retainer"
      ? `/dashboard/leads?deposit=cancelled&hold=${params.holdId}`
      : `/book?deposit=cancelled&hold=${params.holdId}`)
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: params.ownerUserId,
    customer_email: params.customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: {
            name:
              params.productName ??
              (purpose === "special_order_retainer"
                ? "Special order key retainer"
                : "Service booking deposit"),
            description:
              params.productDescription ??
              (purpose === "special_order_retainer"
                ? "Non-refundable $50 retainer to special-order your key (shipping lead time applies)."
                : "Holds your appointment slot until payment confirms."),
          },
        },
      },
    ],
    metadata: {
      checkout_type: purpose,
      user_id: params.ownerUserId,
      hold_id: params.holdId,
    },
    success_url: `${appUrl}${successPath.startsWith("/") ? successPath : `/${successPath}`}`,
    cancel_url: `${appUrl}${cancelPath.startsWith("/") ? cancelPath : `/${cancelPath}`}`,
  })
  if (!session.url) throw new Error("Stripe did not return a checkout URL.")
  await attachStripeSessionToHold(params.holdId, session.id)
  return { url: session.url, sessionId: session.id }
}

/** Mark hold paid and create the calendar job after Stripe Checkout completes. */
export async function fulfillBookingDepositFromCheckout(session: {
  id: string
  metadata?: Record<string, string> | null
  payment_status?: string | null
}): Promise<void> {
  if (session.metadata?.checkout_type !== "booking_deposit") return
  if (session.payment_status && session.payment_status !== "paid") return

  const holdId = session.metadata?.hold_id?.trim()
  const ownerUserId = session.metadata?.user_id?.trim()
  if (!holdId || !ownerUserId) return

  const sql = sqlClient()
  const rows = await sql`
    SELECT * FROM booking_holds WHERE id = ${holdId} AND owner_user_id = ${ownerUserId} LIMIT 1
  `
  const hold = rows[0] as Record<string, unknown> | undefined
  if (!hold) return
  if (hold.status === "paid") return

  const scheduledAt =
    hold.scheduled_at instanceof Date
      ? hold.scheduled_at.toISOString()
      : String(hold.scheduled_at)

  const job = await createUnassignedJobFromIntake({
    ownerUserId,
    callerE164: (hold.customer_phone as string) || "+10000000000",
    customerName: (hold.customer_name as string) || "Online booking",
    jobType: "Booked online (deposit paid)",
    notes: `Public /book · Deposit hold ${holdId} · Stripe ${session.id}`,
    scheduledAtIso: scheduledAt,
    pendingCallback: false,
    intakeSource: "public_book",
  })

  const leadId = job.lead_id || null

  await sql`
    UPDATE booking_holds
    SET status = 'paid', lead_id = ${leadId}, updated_at = now()
    WHERE id = ${holdId}
  `
}
