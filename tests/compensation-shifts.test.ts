import { describe, expect, it } from "vitest"
import { shiftSeconds, type WorkShift } from "@/lib/compensation/shifts"
import { workweekSourceId } from "@/lib/compensation/wage-floor"

function shift(overrides: Partial<WorkShift> = {}): WorkShift {
  return {
    id: "shift-1",
    owner_user_id: "owner-1",
    organization_id: null,
    worker_role: "receptionist",
    receptionist_id: "rec-1",
    field_technician_id: null,
    worker_user_id: "user-1",
    started_at: "2026-08-25T13:00:00.000Z",
    ended_at: "2026-08-25T21:00:00.000Z",
    source: "AVAILABILITY",
    approved_at: null,
    note: null,
    ...overrides,
  }
}

describe("how long a shift ran", () => {
  it("measures a closed shift end to end", () => {
    expect(shiftSeconds(shift())).toBe(8 * 3600)
  })

  it("treats an open shift as still running", () => {
    const open = shift({ ended_at: null })
    expect(shiftSeconds(open, "2026-08-25T17:00:00.000Z")).toBe(4 * 3600)
  })

  it("refuses to count a shift that ends before it starts", () => {
    // A corrected timesheet entry, or a heartbeat older than the shift start.
    expect(shiftSeconds(shift({ ended_at: "2026-08-25T12:00:00.000Z" }))).toBe(0)
  })

  it("counts nothing for a shift with an unparseable time", () => {
    expect(shiftSeconds(shift({ started_at: "not a date" }))).toBe(0)
  })
})

describe("the workweek dedupe key", () => {
  it("is stable for the same worker and week", () => {
    const ref = { role: "receptionist" as const, receptionist_id: "rec-1" }
    expect(workweekSourceId(ref, "2026-08-09T00:00:00.000Z")).toBe(
      workweekSourceId(ref, "2026-08-09T00:00:00.000Z")
    )
  })

  it("differs across weeks, so two top-ups can coexist", () => {
    // A shared key would collide on the ledger's dedupe index and silently drop the
    // second week's top-up.
    const ref = { role: "receptionist" as const, receptionist_id: "rec-1" }
    expect(workweekSourceId(ref, "2026-08-09T00:00:00.000Z")).not.toBe(
      workweekSourceId(ref, "2026-08-16T00:00:00.000Z")
    )
  })

  it("differs across workers in the same week", () => {
    expect(
      workweekSourceId({ role: "receptionist", receptionist_id: "rec-1" }, "2026-08-09T00:00:00.000Z")
    ).not.toBe(
      workweekSourceId({ role: "receptionist", receptionist_id: "rec-2" }, "2026-08-09T00:00:00.000Z")
    )
  })

  it("keys a tech on their own roster row", () => {
    expect(
      workweekSourceId({ role: "field_tech", field_technician_id: "tech-1" }, "2026-08-09T00:00:00.000Z")
    ).toContain("tech-1")
  })
})
