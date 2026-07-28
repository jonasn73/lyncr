// Deposit SMS helpers for Active Job Money rail (real pay links come from /api/payments/send-pay-link).

import { formatJobMoneyCents, suggestedJobDepositCents } from "@/lib/job-billing-balance"

/** @deprecated Prefer real Stripe pay links via /api/payments/send-pay-link. Kept for older tests. */
export function createMockSecureDepositLink(jobId: string): string {
  const id = String(jobId ?? "").trim() || "job"
  const slug = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "deposit"
  const token = Math.random().toString(36).slice(2, 10)
  return `https://pay.lyncr.app/d/${slug}-${token}`
}

/** Default SMS body with the deposit URL appended for dispatcher editing / copy-paste. */
export function buildDepositSmsStagingTemplate(options: {
  customerName?: string | null
  depositUrl: string
  amountLabel?: string | null
}): string {
  const name = (options.customerName ?? "").trim() || "there"
  const amount = (options.amountLabel ?? "").trim()
  const amountClause = amount ? ` (${amount} deposit)` : ""
  return `Hi ${name} — to lock in your booking, please secure your deposit${amountClause} here: ${options.depositUrl}`
}

/** Build amount label + SMS preview for a suggested deposit against a job balance. */
export function buildSuggestedDepositSmsPreview(options: {
  customerName?: string | null
  balanceCents: number
  /** When the real Stripe URL is known, include it; otherwise leave a placeholder. */
  depositUrl?: string | null
}): { depositCents: number; amountLabel: string; smsBody: string } {
  const depositCents = suggestedJobDepositCents(options.balanceCents)
  const amountLabel = depositCents > 0 ? formatJobMoneyCents(depositCents) : ""
  const depositUrl = (options.depositUrl ?? "").trim() || "https://lyncr.app/pay/…"
  return {
    depositCents,
    amountLabel,
    smsBody: buildDepositSmsStagingTemplate({
      customerName: options.customerName,
      depositUrl,
      amountLabel: amountLabel || null,
    }),
  }
}
