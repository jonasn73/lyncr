// Mock secure deposit link for booking lock-in SMS staging.

/** Build a deterministic-looking mock payment URL for a job (not a real charge). */
export function createMockSecureDepositLink(jobId: string): string {
  const id = String(jobId ?? "").trim() || "job"
  const slug = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "deposit"
  const token = Math.random().toString(36).slice(2, 10)
  return `https://pay.lyncr.app/d/${slug}-${token}`
}

/** Default SMS body with the deposit URL appended for dispatcher editing. */
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
