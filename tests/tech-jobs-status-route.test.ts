import { describe, expect, it, vi, beforeEach } from "vitest"

const resolveActor = vi.fn()
const getOwnerIdForLead = vi.fn()
const setJobStatusForTech = vi.fn()
const publishOwnerEvent = vi.fn()
const recordAuditEvent = vi.fn()

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // `after` needs a request scope that a unit test does not have.
  after: (fn: () => unknown) => void fn,
}))
vi.mock("@/lib/actor", () => ({
  resolveActor: (...a: unknown[]) => resolveActor(...a),
}))
vi.mock("@/lib/db", () => ({
  getOwnerIdForLead: (...a: unknown[]) => getOwnerIdForLead(...a),
  getUser: vi.fn(),
  setJobStatusForTech: (...a: unknown[]) => setJobStatusForTech(...a),
  getOwnerSchedulerEventById: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: (...a: unknown[]) => publishOwnerEvent(...a),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}))
vi.mock("@/lib/dispatch-customer-sms", () => ({
  sendDispatchEnRouteCustomerSms: vi.fn(),
  sendDispatchOnSiteCustomerSms: vi.fn(),
  sendDispatchPausedPartsCustomerSms: vi.fn(),
  sendDispatchPausedWaitCustomerSms: vi.fn(),
}))
vi.mock("@/lib/latest-attention-sms", () => ({
  notifyOwnerLatestNeedsAttention: vi.fn(),
}))

import { PATCH as techJobStatusPatch } from "@/app/api/tech/jobs/[id]/route"

function statusRequest(status: string) {
  return new Request("https://lyncr.app/api/tech/jobs/job-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify({ status }),
  }) as unknown as Parameters<typeof techJobStatusPatch>[0]
}

function ctx() {
  return { params: Promise.resolve({ id: "job-1" }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveActor.mockResolvedValue({ actorRole: "field_tech", actingUserId: "tech-user-1" })
  getOwnerIdForLead.mockResolvedValue("owner-1")
  publishOwnerEvent.mockResolvedValue(undefined)
})

describe("PATCH /api/tech/jobs/[id]", () => {
  it("audits a tech-driven completion — the fix for the missing admin trail", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: true, previousStatus: "arrived" })

    const res = await techJobStatusPatch(statusRequest("completed"), ctx())
    expect(res.status).toBe(200)

    expect(recordAuditEvent).toHaveBeenCalledTimes(1)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        actorUserId: "tech-user-1",
        actorRole: "field_tech",
        eventType: "job.outcome_recorded",
        entityId: "job-1",
        detail: expect.objectContaining({ status: "completed", previous_status: "arrived" }),
      })
    )
  })

  it("does not audit non-terminal field progress like en_route", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: true, previousStatus: "assigned" })

    await techJobStatusPatch(statusRequest("en_route"), ctx())

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it("does not double-audit when the job was already completed", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: true, previousStatus: "completed" })

    await techJobStatusPatch(statusRequest("completed"), ctx())

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it("skips the audit write when the status update itself failed", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: false, previousStatus: null })

    const res = await techJobStatusPatch(statusRequest("completed"), ctx())

    expect(res.status).toBe(404)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})
