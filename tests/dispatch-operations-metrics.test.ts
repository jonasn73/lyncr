import { describe, expect, it } from "vitest"
import {
  computeDispatchOperationsMetrics,
  countCompletedTodayJobs,
} from "@/lib/dispatch-operations-metrics"
import type { SchedulerEvent } from "@/lib/types"

function event(partial: Partial<SchedulerEvent> & { id: string }): SchedulerEvent {
  return {
    customer_name: "Test",
    customer_phone: null,
    location: null,
    summary: null,
    disposition: "BOOKED",
    scheduled_at: "2026-07-04T14:00:00.000Z",
    scheduled_tentative: false,
    created_at: "2026-07-04T10:00:00.000Z",
    job_type: "Lockout",
    duration_minutes: 60,
    assigned_tech_id: "tech-1",
    assigned_tech_name: "Alex",
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    job_notes: null,
    latitude: null,
    longitude: null,
    job_status: "assigned",
    dispatch_status: "DISPATCHED",
    completed_at: null,
    ...partial,
  }
}

describe("countCompletedTodayJobs", () => {
  it("counts completed jobs from raw calendar payload by completion day", () => {
    const jobs = [
      event({
        id: "a",
        job_status: "completed",
        completed_at: "2026-07-04T18:30:00.000Z",
      }),
      event({
        id: "b",
        job_status: "completed",
        completed_at: "2026-07-03T18:30:00.000Z",
      }),
    ]

    expect(
      countCompletedTodayJobs({
        rawCalendarJobs: jobs,
        todayKey: "2026-07-04",
      })
    ).toBe(1)
  })

  it("includes optimistic ledger entries not present in raw payload", () => {
    expect(
      countCompletedTodayJobs({
        rawCalendarJobs: [],
        todayKey: "2026-07-04",
        completedTodayLedger: new Map([["job-1", "2026-07-04T20:15:00.000Z"]]),
      })
    ).toBe(1)
  })
})

describe("computeDispatchOperationsMetrics", () => {
  it("does not derive Done from filtered timeline rows alone", () => {
    const metrics = computeDispatchOperationsMetrics({
      poolJobs: [],
      activePipelineJobs: [],
      dayEvents: [],
      rawCalendarJobs: [
        event({
          id: "done-1",
          job_status: "completed",
          completed_at: "2026-07-04T17:00:00.000Z",
        }),
      ],
      todayKey: "2026-07-04",
    })

    expect(metrics.completedToday).toBe(1)
  })
})
