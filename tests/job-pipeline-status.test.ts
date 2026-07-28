import { describe, expect, it } from "vitest"
import {
  isTerminalJobStatus,
  pipelineStatusFromJob,
  pipelineStatusPillLabel,
} from "@/lib/job-pipeline-status"

describe("pipelineStatusFromJob", () => {
  it("defaults leftover pool dispatch to In pool", () => {
    expect(
      pipelineStatusFromJob({
        dispatch_status: "unassigned_pool",
        assigned_tech_id: null,
      })
    ).toBe("unassigned_pool")
    expect(pipelineStatusPillLabel("unassigned_pool")).toBe("In pool")
  })

  it("shows Done when job_status is terminal even if dispatch is still pool/lead", () => {
    expect(
      pipelineStatusFromJob({
        dispatch_status: "unassigned_pool",
        assigned_tech_id: null,
        job_status: "completed",
      })
    ).toBe("completed")
    expect(
      pipelineStatusFromJob({
        dispatch_status: "lead",
        job_status: "completed",
      })
    ).toBe("completed")
    expect(pipelineStatusPillLabel("completed")).toBe("Done")
  })

  it("treats completed dispatch_status as terminal", () => {
    expect(
      pipelineStatusFromJob({
        dispatch_status: "completed",
        job_status: null,
      })
    ).toBe("completed")
  })

  it("detects terminal job statuses", () => {
    expect(isTerminalJobStatus("completed")).toBe(true)
    expect(isTerminalJobStatus("referred")).toBe(true)
    expect(isTerminalJobStatus("en_route")).toBe(false)
  })
})
