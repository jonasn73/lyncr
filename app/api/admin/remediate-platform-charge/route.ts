// POST /api/admin/remediate-platform-charge
// Moves net funds from a stranded platform Charge to a Connect account (admin only).
// Body: { chargeId?, destinationAccountId?, deductLyncrApplicationFee?, useMichaelPreset? }
// Omit ids + useMichaelPreset:true (or empty body) to run the known Michael Jul-24 remediation.

import { NextRequest, NextResponse } from "next/server"
import { requireLyncrAdmin } from "@/lib/admin-api-guard"
import {
  MICHAEL_STRANDED_PLATFORM_CHARGE,
  remediatePlatformChargeToConnect,
} from "@/lib/remediate-platform-charge-to-connect"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const ctx = await requireLyncrAdmin(req)
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as {
    chargeId?: string
    destinationAccountId?: string
    deductLyncrApplicationFee?: boolean
    useMichaelPreset?: boolean
  }

  const usePreset =
    body.useMichaelPreset === true ||
    (!String(body.chargeId || "").trim() && !String(body.destinationAccountId || "").trim())

  const chargeId = usePreset
    ? MICHAEL_STRANDED_PLATFORM_CHARGE.chargeId
    : String(body.chargeId || "").trim()
  const destinationAccountId = usePreset
    ? MICHAEL_STRANDED_PLATFORM_CHARGE.destinationAccountId
    : String(body.destinationAccountId || "").trim()

  if (!chargeId || !destinationAccountId) {
    return NextResponse.json(
      { error: "chargeId and destinationAccountId are required (or useMichaelPreset: true)." },
      { status: 400 }
    )
  }

  try {
    const result = await remediatePlatformChargeToConnect({
      chargeId,
      destinationAccountId,
      deductLyncrApplicationFee: body.deductLyncrApplicationFee === true,
      metadata: {
        remediated_by_admin_user_id: ctx.userId,
        ...(usePreset
          ? {
              job_id: MICHAEL_STRANDED_PLATFORM_CHARGE.jobId,
              owner_user_id: MICHAEL_STRANDED_PLATFORM_CHARGE.ownerUserId,
              customer_name: MICHAEL_STRANDED_PLATFORM_CHARGE.customerName,
              preset: "michael_jul24_2026",
            }
          : {}),
      },
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      data: {
        transferId: result.transferId,
        amountCents: result.amountCents,
        amountDollars: (result.amountCents / 100).toFixed(2),
        alreadyTransferred: result.alreadyTransferred,
        chargeId: result.chargeId,
        destinationAccountId: result.destinationAccountId,
        paymentIntentId: result.paymentIntentId,
        stripeFeeCents: result.stripeFeeCents,
        netCents: result.netCents,
        note: result.alreadyTransferred
          ? "Transfer already existed — no second move."
          : "Transfer created. Funds should appear in Get paid (Available or Pending, then bank payout on schedule).",
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Remediation failed"
    console.error("[admin/remediate-platform-charge] POST:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
