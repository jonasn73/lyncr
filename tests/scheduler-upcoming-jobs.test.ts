import { describe, expect, it } from "vitest"
import {
  listUpcomingSchedulerJobs,
  upcomingJobNeedsDispatch,
} from "@/lib/scheduler-upcoming-jobs"
import type { ActivePipelineJob } from "@/lib/types"

function job(partial: Partial<ActivePipelineJob> & { id: string }): ActivePipelineJob {
  return {
    id: partial.id,
    customer_name: partial.customer_name ?? "Test Customer",
    customer_phone: partial.customer_phone ?? "+15025550100",
    location: partial.location ?? null,
    neighborhood: partial.neighborhood ?? null,
    summary: partial.summary ?? null,
    job_type: partial.job_type ?? "Lockout",
    vehicle_year: partial.vehicle_year ?? null,
    vehicle_make: partial.vehicle_make ?? null,
    vehicle_model: partial.vehicle_model ?? null,
    job_notes: partial.job_notes ?? null,
    scheduled_at: partial.scheduled_at ?? null,
    duration_minutes: partial.duration_minutes ?? 60,
    dispatch_status: partial.dispatch_status ?? "unassigned_pool",
    created_at: partial.created_at ?? new Date().toISOString(),
    latitude: partial.latitude ?? null,
    longitude: partial.longitude ?? null,
    job_status: partial.job_status ?? null,
    assigned_tech_id: partial.assigned_tech_id ?? null,
    assigned_tech_name: partial.assigned_tech_name ?? null,
  }
}

describe("listUpcomingSchedulerJobs", () => {
  const now = new Date("2026-07-01T12:32:00-04:00")
  const selectedDay = new Date("2026-07-01T08:00:00-04:00")

  it("lists future jobs today sorted by time", () => {
    const upcoming = listUpcomingSchedulerJobs({
      now,
      selectedDay,
      activePipelineJobs: [
        job({
          id: "later",
          customer_name: "Later",
          scheduled_at: "2026-07-01T13:30:00-04:00",
        }),
        job({
          id: "sooner",
          customer_name: "Sooner",
          scheduled_at: "2026-07-01T12:45:00-04:00",
        }),
      ],
      dayEvents: [],
      poolJobs: [],
    })
    expect(upcoming.map((j) => j.id)).toEqual(["sooner", "later"])
  })

  it("puts en route jobs first", () => {
    const upcoming = listUpcomingSchedulerJobs({
      now,
      selectedDay,
      activePipelineJobs: [
        job({
          id: "future",
          scheduled_at: "2026-07-01T14:00:00-04:00",
        }),
        job({
          id: "active",
          scheduled_at: "2026-07-01T11:00:00-04:00",
          job_status: "en_route",
          assigned_tech_id: "tech-1",
          dispatch_status: "DISPATCHED",
        }),
      ],
      dayEvents: [],
      poolJobs: [],
    })
    expect(upcoming[0]?.id).toBe("active")
    expect(upcoming[0]?.isActiveNow).toBe(true)
  })

  it("returns empty for past calendar days", () => {
    const upcoming = listUpcomingSchedulerJobs({
      now,
      selectedDay: new Date("2026-06-30T08:00:00-04:00"),
      activePipelineJobs: [job({ id: "old", scheduled_at: "2026-06-30T10:00:00-04:00" })],
      dayEvents: [],
      poolJobs: [],
    })
    expect(upcoming).toEqual([])
  })
})

describe("upcomingJobNeedsDispatch", () => {
  it("flags unassigned and unscheduled jobs", () => {
    expect(
      upcomingJobNeedsDispatch({ phase: "unassigned", scheduled_at: "2026-07-01T13:00:00Z" })
    ).toBe(true)
    expect(upcomingJobNeedsDispatch({ phase: "scheduled", scheduled_at: null })).toBe(true)
    expect(
      upcomingJobNeedsDispatch({ phase: "scheduled", scheduled_at: "2026-07-01T13:00:00Z" })
    ).toBe(false)
  })
})
