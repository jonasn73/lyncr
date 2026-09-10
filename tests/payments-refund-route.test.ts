import { describe, expect, it, vi, beforeEach } from "vitest"

const getUserIdFromRequest = vi.fn()
const getUser = vi.fn()
const isStripeConfigured = vi.fn(() => true)
const refundCollectedCharge = vi.fn()

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...a: unknown[]) => getUser(...a),
}))
vi.mock("@/lib/stripe-config", () => ({
  isStripeConfigured: () => isStripeConfigured(),
}))
vi.mock("@/lib/job-payments", () => ({
  refundCollectedCharge: (...a: unknown[]) => refundCollectedCharge(...a),
}))

import { POST as refundPost } from "@/app/api/payments/refund/route"

function postRequest(body: Record<string, unknown>) {
  return new Request("https://lyncr.app/api/payments/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof refundPost>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  isStripeConfigured.mockReturnValue(true)
  getUserIdFromRequest.mockReturnValue("owner-1")
  getUser.mockResolvedValue({ id: "owner-1", account_role: "owner" })
  refundCollectedCharge.mockResolvedValue({ refundId: "re_123", amountCents: 10000 })
})

describe("POST /api/payments/refund", () => {
  it("issues a refund for an owner session", async () => {
    const res = await refundPost(postRequest({ stripePaymentIntentId: "pi_123" }))
    const json = (await res.json()) as { data: { refundId: string } }

    expect(res.status).toBe(200)
    expect(json.data.refundId).toBe("re_123")
    expect(refundCollectedCharge).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      paymentIntentId: "pi_123",
      amountCents: undefined,
    })
  })

  it("passes through a partial amount", async () => {
    await refundPost(postRequest({ stripePaymentIntentId: "pi_123", amountCents: 2500 }))
    expect(refundCollectedCharge).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      paymentIntentId: "pi_123",
      amountCents: 2500,
    })
  })

  it("rejects a receptionist session — owner only", async () => {
    getUser.mockResolvedValue({ id: "recep-1", account_role: "receptionist" })

    const res = await refundPost(postRequest({ stripePaymentIntentId: "pi_123" }))

    expect(res.status).toBe(403)
    expect(refundCollectedCharge).not.toHaveBeenCalled()
  })

  it("rejects a field tech session — owner only", async () => {
    getUser.mockResolvedValue({ id: "tech-1", account_role: "field_tech" })

    const res = await refundPost(postRequest({ stripePaymentIntentId: "pi_123" }))

    expect(res.status).toBe(403)
    expect(refundCollectedCharge).not.toHaveBeenCalled()
  })

  it("400s without a payment intent id", async () => {
    const res = await refundPost(postRequest({}))
    expect(res.status).toBe(400)
    expect(refundCollectedCharge).not.toHaveBeenCalled()
  })

  it("maps a 'not found' error to 404", async () => {
    refundCollectedCharge.mockRejectedValue(new Error("Payment not found"))
    const res = await refundPost(postRequest({ stripePaymentIntentId: "pi_missing" }))
    expect(res.status).toBe(404)
  })

  it("maps a validation error to 400", async () => {
    refundCollectedCharge.mockRejectedValue(new Error("This charge has already been fully refunded"))
    const res = await refundPost(postRequest({ stripePaymentIntentId: "pi_123" }))
    expect(res.status).toBe(400)
  })
})
