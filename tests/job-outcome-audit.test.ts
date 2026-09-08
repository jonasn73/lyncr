import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// The route calls next/server's after() for fire-and-forget SMS sends on some statuses —
// outside a real request scope (as here) it throws. Run the callback inline instead.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return { ...actual, after: (fn: () => unknown) => void fn() }
})

const resolveCapabilityActor = vi.fn()
const getOwnerSchedulerEventById = vi.fn()
const setJobStatusForOwner = vi.fn()
const setLeadDispatchStatus = vi.fn()
const publishOwnerEvent = vi.fn()
const recordAuditEvent = vi.fn()
const assignJobToTech = vi.fn()
const listFieldTechnicians = vi.fn()
const publishTechnicianEvent = vi.fn()
const sendTechJobAssignedSms = vi.fn()

vi.mock("@/lib/receptionist-capability-auth", () => ({
  resolveCapabilityActor: (...args: unknown[]) => resolveCapabilityActor(...args),
}))
vi.mock("@/lib/db", () => ({
  getOwnerSchedulerEventById: (...args: unknown[]) => getOwnerSchedulerEventById(...args),
  setJobStatusForOwner: (...args: unknown[]) => setJobStatusForOwner(...args),
  setLeadDispatchStatus: (...args: unknown[]) => setLeadDispatchStatus(...args),
  assignJobToTech: (...args: unknown[]) => assignJobToTech(...args),
  listFieldTechnicians: (...args: unknown[]) => listFieldTechnicians(...args),
}))
vi.mock("@/lib/dispatch-customer-sms", () => ({
  sendDispatchEnRouteCustomerSms: vi.fn(),
  sendDispatchOnSiteCustomerSms: vi.fn(),
  sendDispatchPausedPartsCustomerSms: vi.fn(),
  sendDispatchPausedWaitCustomerSms: vi.fn(),
}))
vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: (...args: unknown[]) => publishOwnerEvent(...args),
  publishTechnicianEvent: (...args: unknown[]) => publishTechnicianEvent(...args),
}))
vi.mock("@/lib/sms-pipeline", () => ({
  onJobStateChange: vi.fn(),
  sendManualThanksReviewSms: vi.fn(),
}))
vi.mock("@/lib/tech-job-assigned-sms", () => ({
  sendTechJobAssignedSms: (...args: unknown[]) => sendTechJobAssignedSms(...args),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))

import { PATCH as jobStatus } from "@/app/api/owner/jobs/[id]/status/route"
import { POST as jobAssign } from "@/app/api/owner/jobs/assign/route"

function patchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

const baseActor = { ownerUserId: "owner-1", actingUserId: "owner-1", actorRole: "owner", receptionistId: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/owner/jobs/[id]/status — audit trail", () => {
  beforeEach(() => {
    resolveCapabilityActor.mockResolvedValue(baseActor)
    getOwnerSchedulerEventById.mockResolvedValue({
      job_status: "arrived",
      assigned_tech_id: "tech-1",
      assigned_tech_name: "Ann",
      customer_phone: "+15551234567",
      customer_name: "Jo",
    })
    setJobStatusForOwner.mockResolvedValue(true)
    setLeadDispatchStatus.mockResolvedValue(undefined)
    publishOwnerEvent.mockResolvedValue(undefined)
  })

  it("records job.outcome_recorded for a terminal status (cancelled)", async () => {
    const res = await jobStatus(
      patchRequest("https://lyncr.app/api/owner/jobs/job-1/status", { status: "cancelled" }),
      { params: Promise.resolve({ id: "job-1" }) }
    )
    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        eventType: "job.outcome_recorded",
        entityType: "job",
        entityId: "job-1",
        detail: { status: "cancelled", previous_status: "arrived" },
      })
    )
  })

  it("does not record an event for a non-terminal status (en_route)", async () => {
    const res = await jobStatus(
      patchRequest("https://lyncr.app/api/owner/jobs/job-1/status", { status: "en_route" }),
      { params: Promise.resolve({ id: "job-1" }) }
    )
    expect(res.status).toBe(200)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it("does not record a second event when the job is already in that terminal status", async () => {
    getOwnerSchedulerEventById.mockResolvedValue({
      job_status: "cancelled",
      assigned_tech_id: "tech-1",
      assigned_tech_name: "Ann",
    })
    await jobStatus(
      patchRequest("https://lyncr.app/api/owner/jobs/job-1/status", { status: "cancelled" }),
      { params: Promise.resolve({ id: "job-1" }) }
    )
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe("POST /api/owner/jobs/assign — audit trail", () => {
  it("records job.tech_assigned with the assigned tech id", async () => {
    resolveCapabilityActor.mockResolvedValue(baseActor)
    listFieldTechnicians.mockResolvedValue([{ portal_user_id: "tech-1", is_active: true }])
    assignJobToTech.mockResolvedValue(true)
    sendTechJobAssignedSms.mockResolvedValue({ ok: true })
    publishTechnicianEvent.mockResolvedValue(undefined)

    const res = await jobAssign(
      postRequest("https://lyncr.app/api/owner/jobs/assign", { leadId: "job-1", techUserId: "tech-1" })
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        eventType: "job.tech_assigned",
        entityType: "job",
        entityId: "job-1",
        detail: { tech_user_id: "tech-1" },
      })
    )
  })

  it("records job.tech_assigned with tech_user_id null when clearing the assignment", async () => {
    resolveCapabilityActor.mockResolvedValue(baseActor)
    assignJobToTech.mockResolvedValue(true)

    const res = await jobAssign(
      postRequest("https://lyncr.app/api/owner/jobs/assign", { leadId: "job-1", techUserId: null })
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "job.tech_assigned", detail: { tech_user_id: null } })
    )
    expect(listFieldTechnicians).not.toHaveBeenCalled()
  })

  it("does not record an event when the job is not found", async () => {
    resolveCapabilityActor.mockResolvedValue(baseActor)
    assignJobToTech.mockResolvedValue(false)

    const res = await jobAssign(
      postRequest("https://lyncr.app/api/owner/jobs/assign", { leadId: "job-1", techUserId: null })
    )

    expect(res.status).toBe(404)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})
