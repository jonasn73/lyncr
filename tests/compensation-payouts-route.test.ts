import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const getUserIdFromRequest = vi.fn()
const getUser = vi.fn()
const getReceptionist = vi.fn()
const getFieldTechnicianByIdForOwner = vi.fn()
const getEarningsTotal = vi.fn()
const listWorkerPayouts = vi.fn()
const recordWorkerPayout = vi.fn()
const sendWorkerPayoutSms = vi.fn()
const recordAuditEvent = vi.fn()

vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  getReceptionist: (...a: unknown[]) => getReceptionist(...a),
  getFieldTechnicianByIdForOwner: (...a: unknown[]) => getFieldTechnicianByIdForOwner(...a),
}))
vi.mock("@/lib/compensation/ledger", () => ({
  getEarningsTotal: (...a: unknown[]) => getEarningsTotal(...a),
  listWorkerPayouts: (...a: unknown[]) => listWorkerPayouts(...a),
  recordWorkerPayout: (...a: unknown[]) => recordWorkerPayout(...a),
}))
vi.mock("@/lib/worker-payout-sms", () => ({
  sendWorkerPayoutSms: (...a: unknown[]) => sendWorkerPayoutSms(...a),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}))

import { GET as payoutsGet, POST as payoutsPost } from "@/app/api/compensation/payouts/route"

function getRequest(query: string) {
  return new NextRequest(`https://lyncr.app/api/compensation/payouts?${query}`, {
    headers: { cookie: "lyncr_session=abc" },
  })
}

function postRequest(body: Record<string, unknown>) {
  return new Request("https://lyncr.app/api/compensation/payouts", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof payoutsPost>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserIdFromRequest.mockReturnValue("owner-1")
  getUser.mockResolvedValue({ id: "owner-1", account_role: "owner" })
  getFieldTechnicianByIdForOwner.mockResolvedValue({
    id: "tech-1",
    portal_user_id: "tech-portal-1",
    organization_id: null,
  })
  getEarningsTotal.mockResolvedValue({ cents: 34000, rows: 5 })
  listWorkerPayouts.mockResolvedValue([])
  recordWorkerPayout.mockResolvedValue({ id: "ledger-row-1" })
  sendWorkerPayoutSms.mockResolvedValue({ ok: true, to: "+15551234567" })
})

describe("GET /api/compensation/payouts", () => {
  it("rejects a receptionist or field tech session", async () => {
    getUser.mockResolvedValue({ id: "owner-1", account_role: "field_tech" })
    const res = await payoutsGet(getRequest("field_technician_id=tech-1"))
    expect(res.status).toBe(403)
  })

  it("returns owed cents and payout history for a valid tech", async () => {
    const res = await payoutsGet(getRequest("field_technician_id=tech-1"))
    const json = (await res.json()) as { data: { owedCents: number } }
    expect(res.status).toBe(200)
    expect(json.data.owedCents).toBe(34000)
  })

  it("404s when the tech does not belong to this owner", async () => {
    getFieldTechnicianByIdForOwner.mockResolvedValue(null)
    const res = await payoutsGet(getRequest("field_technician_id=not-mine"))
    expect(res.status).toBe(404)
  })

  it("400s when both or neither id is passed", async () => {
    const res = await payoutsGet(getRequest(""))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/compensation/payouts", () => {
  it("records a payout, audits it, and texts the worker — the fix for the missing tech payout mechanism", async () => {
    const res = await payoutsPost(
      postRequest({ field_technician_id: "tech-1", amountCents: 34000, method: "cash", note: "Sep payout" })
    )
    expect(res.status).toBe(200)

    expect(recordWorkerPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        ref: { role: "field_tech", field_technician_id: "tech-1" },
        amountCents: 34000,
        method: "CASH",
        note: "Sep payout",
      })
    )
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payout.recorded",
        ownerUserId: "owner-1",
        entityType: "worker_payout",
        detail: expect.objectContaining({ worker_role: "field_tech", amount_cents: 34000, method: "CASH" }),
      })
    )
    expect(sendWorkerPayoutSms).toHaveBeenCalledTimes(1)
  })

  it("rejects a non-positive amount", async () => {
    const res = await payoutsPost(postRequest({ field_technician_id: "tech-1", amountCents: 0, method: "cash" }))
    expect(res.status).toBe(400)
    expect(recordWorkerPayout).not.toHaveBeenCalled()
  })

  it("rejects an unrecognized method", async () => {
    const res = await payoutsPost(
      postRequest({ field_technician_id: "tech-1", amountCents: 5000, method: "bitcoin" })
    )
    expect(res.status).toBe(400)
    expect(recordWorkerPayout).not.toHaveBeenCalled()
  })

  it("still succeeds when the confirmation SMS fails to send", async () => {
    sendWorkerPayoutSms.mockResolvedValue({ ok: false, reason: "no-worker-phone" })
    const res = await payoutsPost(postRequest({ field_technician_id: "tech-1", amountCents: 5000, method: "cash" }))
    const json = (await res.json()) as { data: { smsSent: boolean } }
    expect(res.status).toBe(200)
    expect(json.data.smsSent).toBe(false)
  })

  it("404s when neither id belongs to this owner", async () => {
    getFieldTechnicianByIdForOwner.mockResolvedValue(null)
    const res = await payoutsPost(postRequest({ field_technician_id: "not-mine", amountCents: 5000, method: "cash" }))
    expect(res.status).toBe(404)
  })
})
