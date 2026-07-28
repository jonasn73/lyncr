import { describe, expect, it } from "vitest"
import {
  OPERATOR_JOB_PHASE_LABEL,
  resolveOperatorJobPhase,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"

describe("resolveOperatorJobPhase", () => {
  it("never shows In pool when job_status is completed/done/paid", () => {
    expect(
      resolveOperatorJobPhase({
        job_status: "completed",
        dispatch_status: "unassigned_pool",
        assigned_tech_id: null,
      })
    ).toBe("done")
    expect(
      resolveOperatorJobPhase({
        job_status: "paid",
        dispatch_status: "lead",
      })
    ).toBe("done")
    expect(
      resolveOperatorJobPhase({
        job_status: "done",
        dispatch_status: "unassigned_pool",
      })
    ).toBe("done")
    expect(OPERATOR_JOB_PHASE_LABEL.done).toBe("Done")
  })

  it("maps quote leads before pool", () => {
    expect(
      resolveOperatorJobPhase({
        job_status: "lead",
        dispatch_status: "lead",
      })
    ).toBe("quote")
    expect(
      resolveOperatorJobPhase({
        dispatch_status: "unassigned_callback",
      })
    ).toBe("quote")
  })

  it("maps field progress to En route / On site", () => {
    expect(
      resolveOperatorJobPhase({
        job_status: "en_route",
        dispatch_status: "DISPATCHED",
        assigned_tech_id: "tech-1",
      })
    ).toBe("en_route")
    expect(
      resolveOperatorJobPhase({
        job_status: "arrived",
        assigned_tech_id: "tech-1",
      })
    ).toBe("on_site")
  })

  it("maps hopper + scheduled", () => {
    expect(
      resolveOperatorJobPhase({
        job_status: "unassigned",
        dispatch_status: "unassigned_pool",
      })
    ).toBe("in_pool")
    expect(
      resolveOperatorJobPhase({
        job_status: "assigned",
        dispatch_status: "DISPATCHED",
        assigned_tech_id: "tech-1",
        scheduled_at: "2026-07-01T13:00:00Z",
      })
    ).toBe("scheduled")
  })
})

describe("schedulerLifecyclePhase terminal reconciliation", () => {
  it("treats done/paid as completed so cards never stay Unassigned", () => {
    expect(
      schedulerLifecyclePhase({
        job_status: "done",
        dispatch_status: "unassigned_pool",
        assigned_tech_id: null,
      })
    ).toBe("completed")
    expect(
      schedulerLifecyclePhase({
        job_status: "paid",
        dispatch_status: "lead",
        assigned_tech_id: null,
      })
    ).toBe("completed")
  })
})
