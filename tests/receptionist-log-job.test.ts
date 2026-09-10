import { describe, expect, it, vi, beforeEach } from "vitest"

const getUserIdFromRequest = vi.fn()
const getReceptionistPortalContext = vi.fn()
const saveCallIntake = vi.fn()
const attributeLeadToCallReceptionist = vi.fn()
const recordAuditEvent = vi.fn()
const applyLeadDisposition = vi.fn()
const setCallLogDisposition = vi.fn()
const resolveDispatchTechForOwner = vi.fn()
const assignJobToTech = vi.fn()
const setLeadDispatchStatus = vi.fn()
const setLeadScheduledAt = vi.fn()

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // `after` needs a request scope that a unit test does not have.
  after: (fn: () => unknown) => void fn,
}))
vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...a: unknown[]) => getReceptionistPortalContext(...a),
}))
vi.mock("@/lib/intake-engine", () => ({
  saveCallIntake: (...a: unknown[]) => saveCallIntake(...a),
}))
vi.mock("@/lib/create-intake-job", () => ({
  attributeLeadToCallReceptionist: (...a: unknown[]) => attributeLeadToCallReceptionist(...a),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}))
vi.mock("@/lib/db", () => ({
  applyLeadDisposition: (...a: unknown[]) => applyLeadDisposition(...a),
  setCallLogDisposition: (...a: unknown[]) => setCallLogDisposition(...a),
  resolveDispatchTechForOwner: (...a: unknown[]) => resolveDispatchTechForOwner(...a),
  assignJobToTech: (...a: unknown[]) => assignJobToTech(...a),
  setLeadDispatchStatus: (...a: unknown[]) => setLeadDispatchStatus(...a),
  setLeadScheduledAt: (...a: unknown[]) => setLeadScheduledAt(...a),
}))
vi.mock("@/lib/tech-job-assigned-sms", () => ({
  sendTechJobAssignedSms: vi.fn(),
}))
vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: vi.fn(),
  publishTechnicianEvent: vi.fn(),
}))
vi.mock("@/lib/sms-pipeline", () => ({
  onJobStateChange: vi.fn(),
}))
vi.mock("@/lib/geocode-persist", () => ({
  persistLeadAddressFromFields: vi.fn(),
}))

import { POST as logJobPost } from "@/app/api/receptionist/log-job/route"

function logJobRequest(body: Record<string, unknown>) {
  return new Request("https://lyncr.app/api/receptionist/log-job", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof logJobPost>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserIdFromRequest.mockReturnValue("recep-portal-1")
  getReceptionistPortalContext.mockResolvedValue({
    owner_user_id: "owner-1",
    receptionist: { id: "recep-row-1", name: "Dana" },
    business_name: "Key Squad 502",
  })
  saveCallIntake.mockResolvedValue({ id: "lead-1", sms_sent: true, sms_error: null })
  applyLeadDisposition.mockResolvedValue(undefined)
  setCallLogDisposition.mockResolvedValue(undefined)
  resolveDispatchTechForOwner.mockResolvedValue(null)
})

describe("POST /api/receptionist/log-job", () => {
  it("attributes the lead to the receptionist's call — the fix for silently-lost commission", async () => {
    const res = await logJobPost(
      logJobRequest({ callLogId: "call-log-1", status: "BOOKED", businessType: "locksmith" })
    )
    expect(res.status).toBe(200)

    expect(attributeLeadToCallReceptionist).toHaveBeenCalledTimes(1)
    expect(attributeLeadToCallReceptionist).toHaveBeenCalledWith("lead-1", "owner-1", "call-log-1")
  })

  it("skips attribution when no callLogId was provided", async () => {
    await logJobPost(logJobRequest({ status: "BOOKED", businessType: "locksmith" }))
    expect(attributeLeadToCallReceptionist).not.toHaveBeenCalled()
  })

  it("writes an audit event naming the receptionist as actor — the fix for the missing audit trail", async () => {
    await logJobPost(
      logJobRequest({ callLogId: "call-log-1", status: "PRICE_REJECTED", businessType: "locksmith" })
    )

    expect(recordAuditEvent).toHaveBeenCalledTimes(1)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        actorUserId: "recep-portal-1",
        actorRole: "receptionist",
        eventType: "receptionist.job_logged",
        entityId: "lead-1",
        detail: expect.objectContaining({ disposition: "PRICE_REJECTED", call_log_id: "call-log-1" }),
      })
    )
  })
})
