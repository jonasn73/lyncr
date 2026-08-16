import { describe, expect, it } from "vitest"
import {
  isOpenCollectJobStatus,
  pickOpenCollectJobForPhone,
} from "@/lib/collect-job-match"
import type { DispatchJob } from "@/lib/types"

function job(partial: Partial<DispatchJob> & { id: string }): DispatchJob {
  return {
    id: partial.id,
    customer_name: partial.customer_name ?? "Pat",
    customer_phone: partial.customer_phone ?? null,
    location: null,
    summary: null,
    job_status: partial.job_status ?? "assigned",
    assigned_tech_id: null,
    assigned_tech_name: null,
    latitude: null,
    longitude: null,
    created_at: partial.created_at ?? "2026-08-16T12:00:00.000Z",
  }
}

describe("collect job match", () => {
  it("treats completed and cancelled as closed", () => {
    expect(isOpenCollectJobStatus("completed")).toBe(false)
    expect(isOpenCollectJobStatus("cancelled")).toBe(false)
    expect(isOpenCollectJobStatus("assigned")).toBe(true)
    expect(isOpenCollectJobStatus(null)).toBe(true)
  })

  it("picks the newest open job for a matching phone", () => {
    const jobs = [
      job({
        id: "old",
        customer_phone: "+15025550100",
        created_at: "2026-08-10T12:00:00.000Z",
      }),
      job({
        id: "new",
        customer_phone: "(502) 555-0100",
        created_at: "2026-08-16T15:00:00.000Z",
      }),
      job({
        id: "done",
        customer_phone: "+15025550100",
        job_status: "completed",
        created_at: "2026-08-16T16:00:00.000Z",
      }),
    ]
    expect(pickOpenCollectJobForPhone(jobs, "+1 502-555-0100")?.id).toBe("new")
  })

  it("returns null when no open phone match", () => {
    expect(
      pickOpenCollectJobForPhone(
        [job({ id: "a", customer_phone: "+15025550999", job_status: "completed" })],
        "+15025550100"
      )
    ).toBeNull()
  })
})
