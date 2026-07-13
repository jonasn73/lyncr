import { describe, expect, it } from "vitest"
import { collapseMissedHotlist } from "@/components/dashboard/missed-call-rescue-sheet"

describe("collapseMissedHotlist", () => {
  it("groups by number across non-consecutive rows and keeps the newest timestamp", () => {
    const items = collapseMissedHotlist([
      {
        id: "1",
        call_type: "missed",
        from_number: "+18594170996",
        to_number: "+15025550100",
        created_at: "2026-07-13T13:33:00.000Z",
        status: "no-answer",
        routed_to_name: "Missed - Sent Night Link",
      },
      {
        id: "2",
        call_type: "missed",
        from_number: "+15025550999",
        to_number: "+15025550100",
        created_at: "2026-07-13T12:00:00.000Z",
        status: "no-answer",
        routed_to_name: "Missed - Sent Day Link",
      },
      {
        id: "3",
        call_type: "missed",
        from_number: "(859) 417-0996",
        to_number: "+15025550100",
        created_at: "2026-07-13T10:53:00.000Z",
        status: "no-answer",
        routed_to_name: "Night Capture",
      },
    ])

    expect(items).toHaveLength(2)
    expect(items[0].key).toBe("8594170996")
    expect(items[0].count).toBe(2)
    expect(items[0].latestAt).toBe("2026-07-13T13:33:00.000Z")
    expect(items[0].latestStatus).toBe("Missed - Sent Night Link")
    expect(items[0].times.length).toBe(2)
    expect(items[1].count).toBe(1)
  })
})
