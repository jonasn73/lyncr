import { describe, expect, it, vi, beforeEach } from "vitest"

const insertAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  insertAuditEvent: (...args: unknown[]) => insertAuditEvent(...args),
}))

import { recordAuditEvent } from "@/lib/audit-log"

beforeEach(() => {
  vi.clearAllMocks()
  insertAuditEvent.mockResolvedValue(undefined)
})

describe("recordAuditEvent", () => {
  it("passes ownerUserId/actorUserId/actorRole/eventType through to insertAuditEvent", async () => {
    await recordAuditEvent({
      ownerUserId: "owner-1",
      actorUserId: "actor-1",
      actorRole: "receptionist",
      eventType: "intake.job_created",
      entityType: "job",
      entityId: "job-1",
      detail: { source: "manual" },
    })
    expect(insertAuditEvent).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      actorUserId: "actor-1",
      actorRole: "receptionist",
      eventType: "intake.job_created",
      entityType: "job",
      entityId: "job-1",
      detail: { source: "manual" },
    })
  })

  it("defaults entityType/entityId/detail to null/empty when omitted", async () => {
    await recordAuditEvent({
      ownerUserId: "owner-1",
      actorUserId: null,
      actorRole: "system",
      eventType: "payment.collected",
    })
    expect(insertAuditEvent).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      actorUserId: null,
      actorRole: "system",
      eventType: "payment.collected",
      entityType: null,
      entityId: null,
      detail: {},
    })
  })

  it("never throws even when the underlying insert rejects", async () => {
    insertAuditEvent.mockRejectedValue(new Error("db down"))
    await expect(
      recordAuditEvent({
        ownerUserId: "owner-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        eventType: "auth.login",
      })
    ).resolves.toBeUndefined()
  })
})
