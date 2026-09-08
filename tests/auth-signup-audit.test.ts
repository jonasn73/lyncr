import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const createUser = vi.fn()
const acceptTeamInviteSignup = vi.fn()
const getUserAccountStatus = vi.fn()
const recordAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  createUser: (...args: unknown[]) => createUser(...args),
  acceptTeamInviteSignup: (...args: unknown[]) => acceptTeamInviteSignup(...args),
  getUserAccountStatus: (...args: unknown[]) => getUserAccountStatus(...args),
}))
vi.mock("@/lib/audit-log", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))
vi.mock("@/lib/auth", () => ({
  createSessionCookie: (userId: string) => `signed:${userId}`,
  getSessionCookieName: () => "lyncr_session",
  getSessionCookieOptions: () => ({}),
}))
vi.mock("@/lib/signup-confirmation-email", () => ({
  buildSignupConfirmationEmailPayload: () => ({}),
  buildTeamMemberConfirmationEmailPayload: () => ({}),
  sendSignupConfirmationEmail: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock("@/lib/post-auth-redirect", () => ({
  postAuthPayload: () => ({ operator_access: false, account_role: "owner", redirect: "/dashboard", account_status: "pending" }),
}))

import { POST } from "@/app/api/auth/signup/route"

function signupRequest(body: unknown): NextRequest {
  return new NextRequest("https://lyncr.app/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserAccountStatus.mockResolvedValue("pending")
})

describe("POST /api/auth/signup — audit trail", () => {
  it("records auth.signup for a new owner account", async () => {
    createUser.mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      account_role: "owner",
    })

    const res = await POST(
      signupRequest({
        email: "owner@example.com",
        password: "password123",
        name: "Jane Owner",
        phone: "5025551234",
        business_name: "Jane's Locksmith",
        industry: "locksmith",
      })
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        actorUserId: "user-1",
        actorRole: "owner",
        eventType: "auth.signup",
      })
    )
  })

  it("records auth.signup with actorRole receptionist for an invited team member", async () => {
    acceptTeamInviteSignup.mockResolvedValue({
      user: { id: "user-2", email: "recept@example.com", account_role: "receptionist", name: "Ann" },
    })

    const res = await POST(
      signupRequest({
        email: "recept@example.com",
        password: "password123",
        invite_token: "tok-1",
        phone: "5025551234",
      })
    )

    expect(res.status).toBe(200)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-2",
        actorUserId: "user-2",
        actorRole: "receptionist",
        eventType: "auth.signup",
        detail: expect.objectContaining({ via_invite: true }),
      })
    )
  })

  it("does not record an event when validation fails before a user is created", async () => {
    const res = await POST(signupRequest({ email: "", password: "" }))
    expect(res.status).toBe(400)
    expect(recordAuditEvent).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
  })
})
