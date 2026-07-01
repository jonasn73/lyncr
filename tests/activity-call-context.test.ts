import { describe, expect, it } from "vitest"
import { buildCallActivityContextMap, formatActivityScheduleLabel } from "@/lib/activity-call-context"

describe("activity call context", () => {
  it("formats schedule labels", () => {
    const iso = new Date(2026, 5, 30, 20, 0, 0).toISOString()
    const label = formatActivityScheduleLabel(iso)
    expect(label).toContain("Jun")
    expect(label).toContain("·")
  })

  it("maps dispatched intake from linked lead", () => {
    const callId = "call-1"
    const map = buildCallActivityContextMap({
      calls: [{ id: callId, from_number: "+15025369252", disposition: null }],
      leadRows: [
        {
          id: "lead-1",
          caller_e164: "+15025369252",
          collected: {
            call_log_id: callId,
            source: "answered_call_intake",
            job_type: "Key replacement",
            vehicle_year: "2017",
            vehicle_make: "TOYOTA",
            vehicle_model: "RAV4",
          },
          summary: "Key replacement — 2017 TOYOTA RAV4 — Allen",
          scheduled_at: "2026-06-30T20:00:00.000Z",
          created_at: "2026-06-30T19:00:00.000Z",
        },
      ],
      customerCallLogIds: new Set(),
      phoneE164ByCallId: new Map([[callId, "+15025369252"]]),
    })

    const ctx = map.get(callId)
    expect(ctx?.intakeAction).toBe("Sent to dispatch")
    expect(ctx?.intakeDetail).toContain("Key replacement")
    expect(ctx?.leadId).toBe("lead-1")
    expect(ctx?.scheduleLabel).toBeTruthy()
  })

  it("shows contact saved when no lead but customer row exists", () => {
    const callId = "call-2"
    const map = buildCallActivityContextMap({
      calls: [{ id: callId, from_number: "+15025369252", disposition: null }],
      leadRows: [],
      customerCallLogIds: new Set([callId]),
      phoneE164ByCallId: new Map([[callId, "+15025369252"]]),
    })
    expect(map.get(callId)?.intakeAction).toBe("Contact saved")
  })
})
