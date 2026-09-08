import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const requireLyncrAdmin = vi.fn()
const getUser = vi.fn()
const isLyncrAdminUser = vi.fn()
const recordAuditEvent = vi.fn()
const getUserIdFromRequest = vi.fn()
const verifySessionCookie = vi.fn()

vi.mock("@/lib/admin-api-guard", () => ({
  requireLyncrAdmin: (...args: unknown[]) => requireLyncrAdmin(...args),
}))
vi.mock("@/lib/db", () => ({
  getUser: (...args: unknown[]) => getUser(...args),
}))
vi.mock("@/lib/lyncr-admin", () => ({
  isLyncrAdminUser: (...args: unknown[]) => isLyncrAdminUser(...args),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))
vi.mock("@/lib/auth", () => ({
  createSessionCookie: (userId: string) => `signed:${userId}`,
  createSessionCookieWithTtl: (userId: string) => `signed:${userId}`,
  getSessionCookieName: () => "lyncr_session",
  getSessionCookieOptions: () => ({}),
  getLogoutCookieClearOptions: () => ({}),
  getUserIdFromRequest: (...args: unknown[]) => getUserIdFromRequest(...args),
  verifySessionCookie: (...args: unknown[]) => verifySessionCookie(...args),
}))

import { POST as impersonateStart } from "@/app/api/admin/impersonate/route"
import { POST as impersonateExit } from "@/app/api/admin/impersonate/exit/route"

function jsonRequest(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/admin/impersonate — audit trail", () => {
  it("records admin.impersonate_start with owner=target, actor=admin", async () => {
    requireLyncrAdmin.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
    getUser.mockResolvedValue({ id: "target-1", email: "owner@example.com" })
    isLyncrAdminUser.mockReturnValue(false)

    const res = await impersonateStart(
      jsonRequest("https://lyncr.app/api/admin/impersonate", { targetUserId: "target-1" })
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "target-1",
        actorUserId: "admin-1",
        actorRole: "platform_admin",
        eventType: "admin.impersonate_start",
      })
    )
  })

  it("does not record an event when the guard rejects the request", async () => {
    requireLyncrAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))

    const res = await impersonateStart(
      jsonRequest("https://lyncr.app/api/admin/impersonate", { targetUserId: "target-1" })
    )

    expect(res.status).toBe(403)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/impersonate/exit — audit trail", () => {
  it("records admin.impersonate_stop with owner=impersonated account, actor=admin", async () => {
    verifySessionCookie.mockReturnValue("admin-1")
    getUser.mockResolvedValue({ email: "admin@lyncr.app" })
    isLyncrAdminUser.mockReturnValue(true)
    getUserIdFromRequest.mockReturnValue("target-1")

    const res = await impersonateExit(
      jsonRequest(
        "https://lyncr.app/api/admin/impersonate/exit",
        {},
        "impersonating_from_admin=signed:admin-1"
      )
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "target-1",
        actorUserId: "admin-1",
        actorRole: "platform_admin",
        eventType: "admin.impersonate_stop",
      })
    )
  })

  it("does not record an event when there is no impersonation cookie", async () => {
    verifySessionCookie.mockReturnValue(null)

    const res = await impersonateExit(
      jsonRequest("https://lyncr.app/api/admin/impersonate/exit", {})
    )

    expect(res.status).toBe(400)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})
