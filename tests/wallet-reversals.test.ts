import { describe, expect, it, vi, beforeEach } from "vitest"
import type Stripe from "stripe"

const recordWalletReversal = vi.fn()
const sumReversedForPaymentIntent = vi.fn()
const getOnboardingProfile = vi.fn()
const getUser = vi.fn()
const resolveLeadAlertSmsRecipient = vi.fn()
const sendTelnyxSms = vi.fn()
const reverseJobEarnings = vi.fn()

vi.mock("@/lib/tech-wallet", () => ({
  recordWalletReversal: (...a: unknown[]) => recordWalletReversal(...a),
  sumReversedForPaymentIntent: (...a: unknown[]) => sumReversedForPaymentIntent(...a),
}))
vi.mock("@/lib/db", () => ({
  getOnboardingProfile: (...a: unknown[]) => getOnboardingProfile(...a),
  getUser: (...a: unknown[]) => getUser(...a),
}))
vi.mock("@/lib/lead-sms-recipient", () => ({
  resolveLeadAlertSmsRecipient: (...a: unknown[]) => resolveLeadAlertSmsRecipient(...a),
}))
vi.mock("@/lib/telnyx-sms", () => ({
  sendTelnyxSms: (...a: unknown[]) => sendTelnyxSms(...a),
}))
vi.mock("@/lib/compensation/settle-job", () => ({
  reverseJobEarnings: (...a: unknown[]) => reverseJobEarnings(...a),
}))

import { handleStripeChargeRefunded } from "@/lib/wallet-reversals"

function fakeCharge(overrides: Partial<{ paymentIntent: string; amountRefunded: number; id: string }> = {}) {
  return {
    id: overrides.id ?? "ch_1",
    payment_intent: overrides.paymentIntent ?? "pi_1",
    amount_refunded: overrides.amountRefunded ?? 5000,
  } as unknown as Stripe.Charge
}

beforeEach(() => {
  vi.clearAllMocks()
  sumReversedForPaymentIntent.mockResolvedValue(0)
  resolveLeadAlertSmsRecipient.mockReturnValue(null)
  reverseJobEarnings.mockResolvedValue(0)
})

describe("handleStripeChargeRefunded", () => {
  it("reverses job earnings for the tech/receptionist when the reversed wallet tx has a jobId (149/154 fix)", async () => {
    recordWalletReversal.mockResolvedValue({ ownerUserId: "owner-1", jobId: "job-1" })

    await handleStripeChargeRefunded(fakeCharge())

    expect(reverseJobEarnings).toHaveBeenCalledTimes(1)
    expect(reverseJobEarnings).toHaveBeenCalledWith("job-1")
  })

  it("does not call reverseJobEarnings for a walk-up payment with no jobId", async () => {
    recordWalletReversal.mockResolvedValue({ ownerUserId: "owner-1", jobId: null })

    await handleStripeChargeRefunded(fakeCharge())

    expect(reverseJobEarnings).not.toHaveBeenCalled()
  })

  it("does not call reverseJobEarnings when the wallet reversal itself was a no-op (e.g. duplicate webhook)", async () => {
    recordWalletReversal.mockResolvedValue(null)

    await handleStripeChargeRefunded(fakeCharge())

    expect(reverseJobEarnings).not.toHaveBeenCalled()
  })

  it("a failed commission reversal never throws past the webhook handler", async () => {
    recordWalletReversal.mockResolvedValue({ ownerUserId: "owner-1", jobId: "job-1" })
    reverseJobEarnings.mockRejectedValue(new Error("ledger down"))

    await expect(handleStripeChargeRefunded(fakeCharge())).resolves.toBeUndefined()
  })
})
