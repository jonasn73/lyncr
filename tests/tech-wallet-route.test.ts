import { describe, expect, it, vi, beforeEach } from "vitest"

const resolveActor = vi.fn()
const getFieldTechnicianByPortalUserId = vi.fn()
const getTechWalletSummary = vi.fn()
const getEarningsTotal = vi.fn()

vi.mock("@/lib/actor", () => ({
  resolveActor: (...a: unknown[]) => resolveActor(...a),
}))
vi.mock("@/lib/db", () => ({
  getFieldTechnicianByPortalUserId: (...a: unknown[]) => getFieldTechnicianByPortalUserId(...a),
  getUser: vi.fn(),
}))
vi.mock("@/lib/tech-wallet", () => ({
  getTechWalletSummary: (...a: unknown[]) => getTechWalletSummary(...a),
}))
vi.mock("@/lib/compensation/ledger", () => ({
  getEarningsTotal: (...a: unknown[]) => getEarningsTotal(...a),
}))

import { GET as techWalletGet } from "@/app/api/tech/wallet/route"

function walletRequest() {
  return new Request("https://lyncr.app/api/tech/wallet", {
    headers: { cookie: "lyncr_session=abc" },
  }) as unknown as Parameters<typeof techWalletGet>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveActor.mockResolvedValue({ actorRole: "field_tech", actingUserId: "tech-user-1" })
  getTechWalletSummary.mockResolvedValue({
    availableBalance: 42.5,
    pendingClearance: 10,
    recentTransactions: [],
  })
})

describe("GET /api/tech/wallet", () => {
  it("surfaces the owner's commission-plan total — the fix for the dead earnings_ledger read path", async () => {
    getFieldTechnicianByPortalUserId.mockResolvedValue({ id: "tech-row-1" })
    getEarningsTotal.mockResolvedValue({ cents: 12345, rows: 3 })

    const res = await techWalletGet(walletRequest())
    const json = (await res.json()) as { data: { commissionEarned: number } }

    expect(getEarningsTotal).toHaveBeenCalledWith(
      { role: "field_tech", field_technician_id: "tech-row-1" },
      expect.any(String),
      expect.any(String)
    )
    expect(json.data.commissionEarned).toBeCloseTo(123.45)
  })

  it("returns 0 commission when the tech isn't linked to a field_technicians row", async () => {
    getFieldTechnicianByPortalUserId.mockResolvedValue(null)

    const res = await techWalletGet(walletRequest())
    const json = (await res.json()) as { data: { commissionEarned: number } }

    expect(getEarningsTotal).not.toHaveBeenCalled()
    expect(json.data.commissionEarned).toBe(0)
  })

  it("still returns the existing wallet balance fields unchanged", async () => {
    getFieldTechnicianByPortalUserId.mockResolvedValue(null)

    const res = await techWalletGet(walletRequest())
    const json = (await res.json()) as { data: { availableBalance: number; pendingClearance: number } }

    expect(json.data.availableBalance).toBe(42.5)
    expect(json.data.pendingClearance).toBe(10)
  })
})
