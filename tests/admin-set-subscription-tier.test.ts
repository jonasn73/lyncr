import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const requireLyncrAdmin = vi.fn()
const adminSetUserSubscriptionTier = vi.fn()

vi.mock("@/lib/admin-api-guard", () => ({
  requireLyncrAdmin: (...args: unknown[]) => requireLyncrAdmin(...args),
}))

vi.mock("@/lib/db", () => ({
  adminSetUserSubscriptionTier: (...args: unknown[]) => adminSetUserSubscriptionTier(...args),
}))

import { POST } from "@/app/api/admin/set-subscription-tier/route"

function postRequest(body: unknown): NextRequest {
  return new NextRequest("https://lyncr.app/api/admin/set-subscription-tier", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireLyncrAdmin.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
  adminSetUserSubscriptionTier.mockResolvedValue({
    user_id: "user-1",
    has_active_subscription: true,
    subscription_tier: "professional",
  })
})

describe("POST /api/admin/set-subscription-tier (087 admin tier override)", () => {
  it("rejects non-admin requests before touching the DB", async () => {
    requireLyncrAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))

    const res = await POST(postRequest({ userId: "user-1", tier: "professional" }))

    expect(res.status).toBe(403)
    expect(adminSetUserSubscriptionTier).not.toHaveBeenCalled()
  })

  it("requires userId", async () => {
    const res = await POST(postRequest({ tier: "professional" }))
    expect(res.status).toBe(400)
    expect(adminSetUserSubscriptionTier).not.toHaveBeenCalled()
  })

  it("normalizes an invalid tier string to free_trial rather than passing it through raw", async () => {
    await POST(postRequest({ userId: "user-1", tier: "made-up-tier" }))
    expect(adminSetUserSubscriptionTier).toHaveBeenCalledWith("user-1", "free_trial")
  })

  it("writes the exact requested tier for a valid value", async () => {
    const res = await POST(postRequest({ userId: "user-1", tier: "business" }))
    expect(adminSetUserSubscriptionTier).toHaveBeenCalledWith("user-1", "business")
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.subscription_tier).toBe("professional")
  })
})
