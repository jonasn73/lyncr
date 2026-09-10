import { describe, expect, it, vi, beforeEach } from "vitest"

const resolveActor = vi.fn()
const getFieldTechnicianByPortalUserId = vi.fn()
const getOwnerIdForLead = vi.fn()
const getOwnerMerchantConfigured = vi.fn()
const listJobsForTech = vi.fn()
const setJobStatusForTech = vi.fn()
const createJobInvoice = vi.fn()
const publishOwnerEvent = vi.fn()
const recordAuditEvent = vi.fn()
const createWalletTransaction = vi.fn()

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn,
}))
vi.mock("@/lib/actor", () => ({
  resolveActor: (...a: unknown[]) => resolveActor(...a),
}))
vi.mock("@/lib/db", () => ({
  createJobInvoice: (...a: unknown[]) => createJobInvoice(...a),
  getFieldTechnicianByPortalUserId: (...a: unknown[]) => getFieldTechnicianByPortalUserId(...a),
  getOwnerIdForLead: (...a: unknown[]) => getOwnerIdForLead(...a),
  getOwnerMerchantConfigured: (...a: unknown[]) => getOwnerMerchantConfigured(...a),
  getUser: vi.fn(),
  listJobsForTech: (...a: unknown[]) => listJobsForTech(...a),
  setJobStatusForTech: (...a: unknown[]) => setJobStatusForTech(...a),
}))
vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: (...a: unknown[]) => publishOwnerEvent(...a),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}))
vi.mock("@/lib/sms-pipeline", () => ({
  onJobStateChange: vi.fn(),
}))
vi.mock("@/lib/tech-wallet", () => ({
  createWalletTransaction: (...a: unknown[]) => createWalletTransaction(...a),
  walletStatusFromInvoice: () => ({ status: "COMPLETED", paymentMethod: "CASH" }),
}))

import { POST as techInvoicePost } from "@/app/api/tech/invoice/route"

function invoiceRequest(body: Record<string, unknown>) {
  return new Request("https://lyncr.app/api/tech/invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof techInvoicePost>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveActor.mockResolvedValue({
    actorRole: "field_tech",
    actingUserId: "tech-user-1",
    capabilities: { customer_contact: true },
  })
  getFieldTechnicianByPortalUserId.mockResolvedValue({ id: "tech-row-1", owner_user_id: "owner-1" })
  listJobsForTech.mockResolvedValue([{ id: "job-1", customer_name: "Dana", customer_phone: "+15550001111" }])
  getOwnerMerchantConfigured.mockResolvedValue(false)
  createJobInvoice.mockResolvedValue({ id: "inv-1" })
  getOwnerIdForLead.mockResolvedValue("owner-1")
  publishOwnerEvent.mockResolvedValue(undefined)
})

describe("POST /api/tech/invoice", () => {
  it("audits the job completion an invoice triggers — the fix for the silent tech-invoice path", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: true, previousStatus: "arrived" })

    const res = await techInvoicePost(
      invoiceRequest({ leadId: "job-1", lineItems: [{ label: "Labor", amountCents: 5000 }] })
    )
    expect(res.status).toBe(200)

    expect(recordAuditEvent).toHaveBeenCalledTimes(1)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        actorUserId: "tech-user-1",
        actorRole: "field_tech",
        eventType: "job.outcome_recorded",
        entityId: "job-1",
        detail: expect.objectContaining({ status: "completed", previous_status: "arrived", via: "invoice" }),
      })
    )
  })

  it("does not double-audit a job that was already completed", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: true, previousStatus: "completed" })

    await techInvoicePost(invoiceRequest({ leadId: "job-1", lineItems: [{ label: "Labor", amountCents: 5000 }] }))

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it("skips the audit write when the status update failed", async () => {
    setJobStatusForTech.mockResolvedValue({ ok: false, previousStatus: null })

    await techInvoicePost(invoiceRequest({ leadId: "job-1", lineItems: [{ label: "Labor", amountCents: 5000 }] }))

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})
