import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const requireLyncrAdmin = vi.fn()
const listRecentCallHistory = vi.fn()

vi.mock("@/lib/admin-api-guard", () => ({
  requireLyncrAdmin: (...args: unknown[]) => requireLyncrAdmin(...args),
}))

vi.mock("@/lib/db", () => ({
  listRecentCallHistory: (...args: unknown[]) => listRecentCallHistory(...args),
}))

import { GET } from "@/app/api/admin/call-history/route"

function getRequest(query = ""): NextRequest {
  return new NextRequest(`https://lyncr.app/api/admin/call-history${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  requireLyncrAdmin.mockResolvedValue({ userId: "admin-1", user: { email: "admin@lyncr.app" } })
  listRecentCallHistory.mockResolvedValue([])
})

describe("GET /api/admin/call-history", () => {
  it("rejects non-admin requests before reading calls", async () => {
    requireLyncrAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))

    const res = await GET(getRequest())

    expect(res.status).toBe(403)
    expect(listRecentCallHistory).not.toHaveBeenCalled()
  })

  it("defaults to the 50 newest calls with no search", async () => {
    await GET(getRequest())
    expect(listRecentCallHistory).toHaveBeenCalledWith({ limit: 50, search: "" })
  })

  it("passes the trimmed search term and limit through", async () => {
    await GET(getRequest("?search=%20Fresh%20Auto%20&limit=200"))
    expect(listRecentCallHistory).toHaveBeenCalledWith({ limit: 200, search: "Fresh Auto" })
  })

  it("falls back to the default limit when limit is not a number", async () => {
    await GET(getRequest("?limit=all"))
    expect(listRecentCallHistory).toHaveBeenCalledWith({ limit: 50, search: "" })
  })

  it("returns an empty degraded payload instead of a 500 when the read fails", async () => {
    listRecentCallHistory.mockRejectedValue(new Error("neon down"))

    const res = await GET(getRequest())
    const json = (await res.json()) as { data: { calls: unknown[] }; degraded?: boolean }

    expect(res.status).toBe(200)
    expect(json.degraded).toBe(true)
    expect(json.data.calls).toEqual([])
  })
})
