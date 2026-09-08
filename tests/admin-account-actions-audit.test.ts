import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const requireLyncrAdmin = vi.fn()
const requireLyncrAdminSession = vi.fn()
const adminApplyUserOverride = vi.fn()
const adminAdjustProfileCarrierCredit = vi.fn()
const getUser = vi.fn()
const recordAuditEvent = vi.fn()

vi.mock("@/lib/admin-api-guard", () => ({
  requireLyncrAdmin: (...args: unknown[]) => requireLyncrAdmin(...args),
}))
vi.mock("@/lib/admin-server-auth", () => ({
  requireLyncrAdminSession: (...args: unknown[]) => requireLyncrAdminSession(...args),
  AdminAuthError: class AdminAuthError extends Error {},
}))
vi.mock("@/lib/db", () => ({
  adminApplyUserOverride: (...args: unknown[]) => adminApplyUserOverride(...args),
  adminAdjustProfileCarrierCredit: (...args: unknown[]) => adminAdjustProfileCarrierCredit(...args),
  getUser: (...args: unknown[]) => getUser(...args),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}))

import { POST as userOverride } from "@/app/api/admin/user-override/route"
import { adjustUserCredit } from "@/app/actions/admin-actions"

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/admin/user-override — audit trail", () => {
  beforeEach(() => {
    requireLyncrAdmin.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
    adminApplyUserOverride.mockResolvedValue({ ok: true })
  })

  it("records admin.account_status_changed when targetStatus is included", async () => {
    const res = await userOverride(
      postRequest("https://lyncr.app/api/admin/user-override", { userId: "user-1", targetStatus: "active" })
    )
    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        actorUserId: "admin-1",
        actorRole: "platform_admin",
        eventType: "admin.account_status_changed",
        detail: { to: "active" },
      })
    )
  })

  it("does not record an account-status event for unrelated override fields", async () => {
    const res = await userOverride(
      postRequest("https://lyncr.app/api/admin/user-override", { userId: "user-1", adminNotes: "note" })
    )
    expect(res.status).toBe(200)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it("does not record an event when the guard rejects the request", async () => {
    requireLyncrAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    await userOverride(
      postRequest("https://lyncr.app/api/admin/user-override", { userId: "user-1", targetStatus: "denied" })
    )
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe("adjustUserCredit (admin-actions server action) — audit trail", () => {
  it("records admin.credit_adjusted with the admin as actor and the target as owner", async () => {
    requireLyncrAdminSession.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
    getUser.mockResolvedValue({ id: "user-1" })
    adminAdjustProfileCarrierCredit.mockResolvedValue({ user_id: "user-1", carrier_credit_after: 42.5 })

    const result = await adjustUserCredit("user-1", 25)

    expect(result).toEqual({ ok: true, user_id: "user-1", carrier_credit_after: 42.5 })
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        actorUserId: "admin-1",
        actorRole: "platform_admin",
        eventType: "admin.credit_adjusted",
        detail: { amount_usd: 25, balance_after_usd: 42.5 },
      })
    )
  })

  it("does not record an event when the target user does not exist", async () => {
    requireLyncrAdminSession.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
    getUser.mockResolvedValue(null)

    const result = await adjustUserCredit("user-1", 25)

    expect(result.ok).toBe(false)
    expect(recordAuditEvent).not.toHaveBeenCalled()
    expect(adminAdjustProfileCarrierCredit).not.toHaveBeenCalled()
  })
})
