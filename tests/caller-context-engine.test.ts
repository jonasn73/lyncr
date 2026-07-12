import { describe, expect, it } from "vitest"
import { formatUnknownCallerCnamToken } from "@/lib/cnam-token-framework"
import { resolveCallerContext } from "@/lib/caller-context-engine"
import type { UnassignedPoolJob } from "@/lib/types"

function poolJob(partial: Partial<UnassignedPoolJob> & { id: string }): UnassignedPoolJob {
  return {
    id: partial.id,
    customer_name: partial.customer_name ?? "Kelly Wilson",
    customer_phone: partial.customer_phone ?? "+15025550100",
    location: partial.location ?? null,
    neighborhood: partial.neighborhood ?? null,
    summary: partial.summary ?? null,
    job_type: partial.job_type ?? "Lockout",
    vehicle_year: partial.vehicle_year ?? "2022",
    vehicle_make: partial.vehicle_make ?? "Subaru",
    vehicle_model: partial.vehicle_model ?? "Outback",
    job_notes: partial.job_notes ?? null,
    scheduled_at: partial.scheduled_at ?? new Date().toISOString(),
    duration_minutes: partial.duration_minutes ?? 60,
    dispatch_status: partial.dispatch_status ?? "DISPATCHED",
    created_at: partial.created_at ?? new Date().toISOString(),
    latitude: null,
    longitude: null,
  }
}

describe("formatUnknownCallerCnamToken", () => {
  it("maps Louisville NPA to a CNAM utility string", () => {
    expect(formatUnknownCallerCnamToken("+15025551212")).toBe("Louisville, KY • Verified Personal Line")
  })
})

describe("resolveCallerContext", () => {
  it("surfaces an active job badge when the caller matches the pool", () => {
    const ctx = resolveCallerContext("+15025550100", {
      pool: [poolJob({ id: "job-1" })],
      scheduled: [],
    })
    expect(ctx.kind).toBe("active_job")
    if (ctx.kind === "active_job") {
      expect(ctx.metaLine).toContain("Kelly Wilson")
      expect(ctx.metaLine).toContain("2022")
      expect(ctx.metaLine).toContain("Subaru")
    }
  })

  it("falls back to CNAM token when no jobs match", () => {
    const ctx = resolveCallerContext("+15025559999", { pool: [], scheduled: [] })
    expect(ctx).toEqual({
      kind: "unknown",
      cnamToken: "Louisville, KY • Verified Personal Line",
    })
  })
})
