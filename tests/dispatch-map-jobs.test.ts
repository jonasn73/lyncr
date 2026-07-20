import { describe, expect, it } from "vitest"
import { isActiveDispatchMapJob, mergeDispatchMapJobs } from "@/lib/dispatch-map-jobs"
import type { DispatchJob, UnassignedPoolJob } from "@/lib/types"

describe("isActiveDispatchMapJob", () => {
  it("keeps open hopper and assigned field jobs", () => {
    expect(
      isActiveDispatchMapJob({
        job_status: "UNASSIGNED",
        dispatch_status: "unassigned_pool",
      })
    ).toBe(true)
    expect(
      isActiveDispatchMapJob({
        job_status: "en_route",
        dispatch_status: "DISPATCHED",
        assigned_tech_id: "tech-1",
      })
    ).toBe(true)
  })

  it("drops completed, cancelled, and CRM quote leads", () => {
    expect(isActiveDispatchMapJob({ job_status: "completed" })).toBe(false)
    expect(isActiveDispatchMapJob({ job_status: "cancelled" })).toBe(false)
    expect(isActiveDispatchMapJob({ dispatch_status: "lead" })).toBe(false)
    expect(isActiveDispatchMapJob({ dispatch_status: "lost_lead" })).toBe(false)
    expect(
      isActiveDispatchMapJob({
        job_status: "UNASSIGNED",
        location: "PENDING_CALLBACK",
      })
    ).toBe(false)
  })
})

describe("mergeDispatchMapJobs", () => {
  it("merges hopper into booked and skips inactive rows", () => {
    const booked: DispatchJob[] = [
      {
        id: "done-1",
        customer_name: "Done",
        customer_phone: null,
        location: "1 Main St",
        summary: null,
        job_status: "completed",
        assigned_tech_id: null,
        assigned_tech_name: null,
        latitude: 38.2,
        longitude: -85.7,
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "live-1",
        customer_name: "Live",
        customer_phone: null,
        location: "2 Main St",
        summary: null,
        job_status: "assigned",
        assigned_tech_id: "tech-1",
        assigned_tech_name: "Sam",
        latitude: 38.21,
        longitude: -85.71,
        created_at: "2026-07-19T00:00:00.000Z",
      },
    ]
    const pool: UnassignedPoolJob[] = [
      {
        id: "pool-1",
        customer_name: "Harrison",
        customer_phone: "+15025000986",
        location: "1535 South Shelby Street",
        neighborhood: "Louisville",
        summary: "Key replacement",
        job_type: "Key replacement",
        vehicle_year: "2019",
        vehicle_make: "MAZDA",
        vehicle_model: "CX-3",
        job_notes: null,
        scheduled_at: null,
        duration_minutes: 60,
        dispatch_status: "unassigned_pool",
        created_at: "2026-07-18T00:00:00.000Z",
        latitude: 38.223,
        longitude: -85.742,
      },
    ]
    const merged = mergeDispatchMapJobs(booked, pool)
    expect(merged.map((j) => j.id).sort()).toEqual(["live-1", "pool-1"])
  })
})
