import { describe, expect, it, vi, beforeEach } from "vitest"

const findWalletTransactionByPaymentIntent = vi.fn()
const sumReversedForPaymentIntent = vi.fn()
const requireConnectReady = vi.fn()
const refundsCreate = vi.fn()
const recordAuditEvent = vi.fn()

vi.mock("@/lib/tech-wallet", () => ({
  findWalletTransactionByPaymentIntent: (...a: unknown[]) => findWalletTransactionByPaymentIntent(...a),
  sumReversedForPaymentIntent: (...a: unknown[]) => sumReversedForPaymentIntent(...a),
}))
vi.mock("@/lib/stripe-connect", () => ({
  requireConnectReady: (...a: unknown[]) => requireConnectReady(...a),
  connectDirectChargeOptions: (accountId: string) => ({ stripeAccount: accountId }),
}))
vi.mock("@/lib/stripe-config", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    refunds: { create: (...a: unknown[]) => refundsCreate(...a) },
  }),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}))

import { refundCollectedCharge } from "@/lib/job-payments"

function baseTx(overrides: Record<string, unknown> = {}) {
  return {
    id: "wt-1",
    userId: "collector-1",
    jobId: "job-1",
    amount: 100, // $100 charge
    status: "COMPLETED",
    paymentMethod: "MANUAL_CARD",
    stripePaymentIntentId: "pi_123",
    customerPhone: null,
    customerName: null,
    ownerUserId: "owner-1",
    entryType: "CHARGE",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sumReversedForPaymentIntent.mockResolvedValue(0)
  requireConnectReady.mockResolvedValue({ ready: true, accountId: "acct_123", row: {} })
  refundsCreate.mockResolvedValue({ id: "re_123" })
})

describe("refundCollectedCharge", () => {
  it("issues a full refund when no amount is given", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx())

    const result = await refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })

    expect(result).toEqual({ refundId: "re_123", amountCents: 10000 })
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 10000 },
      { stripeAccount: "acct_123" }
    )
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payment.refunded",
        ownerUserId: "owner-1",
        actorRole: "owner",
        entityId: "pi_123",
        detail: expect.objectContaining({ amount_cents: 10000, refund_id: "re_123" }),
      })
    )
  })

  it("issues a partial refund under the remaining balance", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx())

    const result = await refundCollectedCharge({
      ownerUserId: "owner-1",
      paymentIntentId: "pi_123",
      amountCents: 2500,
    })

    expect(result.amountCents).toBe(2500)
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_123", amount: 2500 },
      { stripeAccount: "acct_123" }
    )
  })

  it("accounts for a prior partial refund when computing the remaining amount", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx())
    sumReversedForPaymentIntent.mockResolvedValue(40) // $40 already refunded

    const result = await refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })

    expect(result.amountCents).toBe(6000) // $100 - $40 remaining
  })

  it("rejects a refund larger than what remains", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx())
    sumReversedForPaymentIntent.mockResolvedValue(90) // only $10 left

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123", amountCents: 5000 })
    ).rejects.toThrow(/Cannot refund more than/)
    expect(refundsCreate).not.toHaveBeenCalled()
  })

  it("rejects a charge that's already been fully refunded", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx())
    sumReversedForPaymentIntent.mockResolvedValue(100)

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })
    ).rejects.toThrow(/already been fully refunded/)
  })

  it("rejects when the charge belongs to a different owner", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx({ ownerUserId: "someone-else" }))

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })
    ).rejects.toThrow(/not found/)
    expect(refundsCreate).not.toHaveBeenCalled()
  })

  it("rejects a cash payment", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx({ paymentMethod: "CASH" }))

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })
    ).rejects.toThrow(/Cash payments/)
  })

  it("rejects a non-completed charge", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(baseTx({ status: "PENDING" }))

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_123" })
    ).rejects.toThrow(/completed charge/)
  })

  it("rejects when the payment intent isn't found", async () => {
    findWalletTransactionByPaymentIntent.mockResolvedValue(null)

    await expect(
      refundCollectedCharge({ ownerUserId: "owner-1", paymentIntentId: "pi_missing" })
    ).rejects.toThrow(/not found/)
  })
})
