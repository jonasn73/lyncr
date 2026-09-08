import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const getTelnyxAccountBalance = vi.fn()
vi.mock("@/lib/telnyx-billing", () => ({
  getTelnyxAccountBalance: (...args: unknown[]) => getTelnyxAccountBalance(...args),
}))

import {
  fetchVercelBillingCharges,
  fetchNeonConsumption,
  fetchTelnyxBalance,
  resolveNeonProjectDetail,
  resolveVercelMonthlyBudgetCents,
  resolveNeonMonthlyBudgetCents,
  resolveTelnyxLowBalanceFloorCents,
} from "@/lib/admin-infra-cost"

const originalEnv = { ...process.env }
const originalFetch = global.fetch

beforeEach(() => {
  process.env = { ...originalEnv }
  global.fetch = vi.fn()
  getTelnyxAccountBalance.mockReset()
})

afterEach(() => {
  process.env = { ...originalEnv }
  global.fetch = originalFetch
})

describe("fetchVercelBillingCharges", () => {
  it("returns ok:false with a reason when VERCEL_API_TOKEN is not set, without calling fetch", async () => {
    delete process.env.VERCEL_API_TOKEN
    const result = await fetchVercelBillingCharges({ from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" })
    expect(result).toEqual({ ok: false, categories: [], error: "VERCEL_API_TOKEN is not set" })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("parses JSONL and sums BilledCost by ServiceCategory", async () => {
    process.env.VERCEL_API_TOKEN = "test-token"
    const jsonl = [
      JSON.stringify({ BilledCost: 1.5, ServiceCategory: "Compute" }),
      JSON.stringify({ BilledCost: 0.5, ServiceCategory: "Compute" }),
      JSON.stringify({ BilledCost: 2, ServiceCategory: "Storage" }),
      "", // trailing blank line — must be skipped, not counted as a malformed row
    ].join("\n")
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      text: async () => jsonl,
    } as Response)

    const result = await fetchVercelBillingCharges({ from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" })

    expect(result.ok).toBe(true)
    expect(result.categories).toEqual(
      expect.arrayContaining([
        { provider: "vercel", category: "Compute", costCents: 200, isEstimate: false },
        { provider: "vercel", category: "Storage", costCents: 200, isEstimate: false },
      ])
    )
  })

  it("falls back to ServiceName when ServiceCategory is missing, and skips unparsable lines", async () => {
    process.env.VERCEL_API_TOKEN = "test-token"
    const jsonl = [
      JSON.stringify({ BilledCost: 1, ServiceName: "Edge Config" }),
      "not valid json",
    ].join("\n")
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, text: async () => jsonl } as Response)

    const result = await fetchVercelBillingCharges({ from: "a", to: "b" })
    expect(result).toEqual({
      ok: true,
      categories: [{ provider: "vercel", category: "Edge Config", costCents: 100, isEstimate: false }],
    })
  })

  it("returns ok:false with the thrown message (never throws itself) when the request fails", async () => {
    process.env.VERCEL_API_TOKEN = "test-token"
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"))
    const result = await fetchVercelBillingCharges({ from: "a", to: "b" })
    expect(result).toEqual({ ok: false, categories: [], error: "network down" })
  })

  it("returns ok:false with the extracted upstream message on a non-OK response", async () => {
    process.env.VERCEL_API_TOKEN = "test-token"
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: { code: "not_found", message: "Plan not found." } }),
    } as Response)
    const result = await fetchVercelBillingCharges({ from: "a", to: "b" })
    expect(result).toEqual({ ok: false, categories: [], error: "404: Plan not found." })
  })
})

describe("resolveNeonProjectDetail", () => {
  it("returns ok:false with a reason when NEON_API_KEY is not set", async () => {
    delete process.env.NEON_API_KEY
    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({ ok: false, error: "NEON_API_KEY is not set" })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("resolves org_id via /users/me/organizations, lists projects, then fetches the first one's full detail", async () => {
    process.env.NEON_API_KEY = "test-key"
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organizations: [{ id: "org-1" }] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ id: "proj-1", org_id: "org-1" }, { id: "proj-2", org_id: "org-2" }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: { id: "proj-1", org_id: "org-1", compute_time_seconds: 42 } }),
      } as Response)

    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({
      ok: true,
      project: { id: "proj-1", org_id: "org-1", compute_time_seconds: 42 },
    })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it("fetches the project directly by id when NEON_PROJECT_ID is set — the only listing a project-scoped key can do", async () => {
    process.env.NEON_API_KEY = "test-key"
    process.env.NEON_PROJECT_ID = "proj-2"
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ project: { id: "proj-2", org_id: "org-2" } }),
    } as Response)

    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({ ok: true, project: { id: "proj-2", org_id: "org-2" } })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string
    expect(String(url)).toContain("/projects/proj-2")
  })

  it("falls back to the listing flow when the direct-by-id fetch fails (e.g. a stale NEON_PROJECT_ID)", async () => {
    process.env.NEON_API_KEY = "test-key"
    process.env.NEON_ORG_ID = "org-2"
    process.env.NEON_PROJECT_ID = "proj-2"
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ id: "proj-1", org_id: "org-1" }, { id: "proj-2", org_id: "org-2" }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: { id: "proj-2", org_id: "org-2" } }),
      } as Response)

    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({ ok: true, project: { id: "proj-2", org_id: "org-2" } })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it("retries /projects with no org_id when the org_id-scoped call 404s (and no NEON_ORG_ID override)", async () => {
    process.env.NEON_API_KEY = "test-key"
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organizations: [{ id: "org-1" }] }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects: [{ id: "proj-1", org_id: "org-1" }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ project: { id: "proj-1", org_id: "org-1" } }),
      } as Response)

    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({ ok: true, project: { id: "proj-1", org_id: "org-1" } })
    expect(global.fetch).toHaveBeenCalledTimes(4)
    const listingCallUrl = vi.mocked(global.fetch).mock.calls[2][0] as string
    expect(String(listingCallUrl)).not.toContain("org_id")
  })

  it("does not retry without org_id when NEON_ORG_ID was explicitly set (an override failing is a real failure)", async () => {
    process.env.NEON_API_KEY = "test-key"
    process.env.NEON_ORG_ID = "org-2"
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 404, text: async () => "not found" } as Response)

    const result = await resolveNeonProjectDetail()
    expect(result).toEqual({ ok: false, error: "404: not found" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe("fetchNeonConsumption", () => {
  it("returns ok:false with a reason when NEON_API_KEY is not set", async () => {
    delete process.env.NEON_API_KEY
    const result = await fetchNeonConsumption({ from: "a", to: "b" })
    expect(result).toEqual({ ok: false, categories: [], error: "NEON_API_KEY is not set" })
  })

  it("converts the project detail's current-period usage fields to dollar estimates using Neon's documented formulas", async () => {
    process.env.NEON_API_KEY = "test-key"
    process.env.NEON_PROJECT_ID = "proj-1" // single direct fetch, no listing needed
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        project: {
          id: "proj-1",
          org_id: "org-1",
          // 3600 CU-seconds = 1 CU-hour = $0.106
          compute_time_seconds: 3600,
          // 1e9 bytes * 730.5 hours = exactly 1 GB-month (bytes-per-GB * avg hours-per-month) = $0.35
          data_storage_bytes_hour: 1_000_000_000 * 730.5,
          // 600 GB transferred, 500 GB free -> 100 GB billable * $0.10 = $10
          data_transfer_bytes: 600_000_000_000,
        },
      }),
    } as Response)

    const result = await fetchNeonConsumption({ from: "2026-09-01T00:00:00Z", to: "2026-10-01T00:00:00Z" })

    expect(result).toEqual({
      ok: true,
      categories: [
        { provider: "neon", category: "Compute", costCents: 11, isEstimate: true }, // round(0.106*100)
        { provider: "neon", category: "Storage", costCents: 35, isEstimate: true }, // round(0.35*100)
        { provider: "neon", category: "Network", costCents: 1000, isEstimate: true }, // round(100*0.10*100)
      ],
    })
  })

  it("treats missing usage fields as zero rather than throwing", async () => {
    process.env.NEON_API_KEY = "test-key"
    process.env.NEON_PROJECT_ID = "proj-1"
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ project: { id: "proj-1", org_id: "org-1" } }),
    } as Response)

    const result = await fetchNeonConsumption({ from: "a", to: "b" })
    expect(result).toEqual({
      ok: true,
      categories: [
        { provider: "neon", category: "Compute", costCents: 0, isEstimate: true },
        { provider: "neon", category: "Storage", costCents: 0, isEstimate: true },
        { provider: "neon", category: "Network", costCents: 0, isEstimate: true },
      ],
    })
  })

  it("returns ok:false with the upstream reason when project resolution fails", async () => {
    process.env.NEON_API_KEY = "test-key"
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" } as Response)
    const result = await fetchNeonConsumption({ from: "a", to: "b" })
    expect(result).toEqual({ ok: false, categories: [], error: "403: forbidden" })
  })
})

describe("fetchTelnyxBalance", () => {
  it("reports available_credit_usd as cents, with the resolved floor, on success", async () => {
    process.env.TELNYX_LOW_BALANCE_FLOOR_CENTS = "1000"
    getTelnyxAccountBalance.mockResolvedValue({
      balance_usd: 12.5,
      available_credit_usd: 45.67,
      credit_limit_usd: 0,
      currency: "USD",
    })

    const result = await fetchTelnyxBalance()
    expect(result).toEqual({ ok: true, balanceCents: 4567, floorCents: 1000 })
  })

  it("never throws — returns ok:false with the error message when the balance call rejects", async () => {
    process.env.TELNYX_LOW_BALANCE_FLOOR_CENTS = "1000"
    getTelnyxAccountBalance.mockRejectedValue(new Error("Could not read Telnyx balance"))

    const result = await fetchTelnyxBalance()
    expect(result).toEqual({
      ok: false,
      balanceCents: 0,
      floorCents: 1000,
      error: "Could not read Telnyx balance",
    })
  })
})

describe("resolveTelnyxLowBalanceFloorCents", () => {
  it("defaults to $20 (2000 cents) when unset", () => {
    delete process.env.TELNYX_LOW_BALANCE_FLOOR_CENTS
    expect(resolveTelnyxLowBalanceFloorCents()).toBe(2000)
  })

  it("honors a configured override", () => {
    process.env.TELNYX_LOW_BALANCE_FLOOR_CENTS = "500"
    expect(resolveTelnyxLowBalanceFloorCents()).toBe(500)
  })
})

describe("budget resolvers", () => {
  it("default to $20/mo (2000 cents) when unset", () => {
    delete process.env.VERCEL_MONTHLY_BUDGET_CENTS
    delete process.env.NEON_MONTHLY_BUDGET_CENTS
    expect(resolveVercelMonthlyBudgetCents()).toBe(2000)
    expect(resolveNeonMonthlyBudgetCents()).toBe(2000)
  })

  it("honor a configured override", () => {
    process.env.VERCEL_MONTHLY_BUDGET_CENTS = "5000"
    expect(resolveVercelMonthlyBudgetCents()).toBe(5000)
  })
})
