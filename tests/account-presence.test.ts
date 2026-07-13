import { describe, expect, it } from "vitest"
import { normalizePresenceStatus } from "@/lib/account-presence"
import {
  PRESENCE_CLOSED_PROMPT,
  PRESENCE_ON_JOB_PROMPT,
  buildPresenceClosedGatherXml,
  buildPresenceOnJobGatherXml,
} from "@/lib/inbound-time-capture"

describe("account presence", () => {
  it("normalizes presence status aliases", () => {
    expect(normalizePresenceStatus("AVAILABLE")).toBe("AVAILABLE")
    expect(normalizePresenceStatus("on_job")).toBe("ON_JOB")
    expect(normalizePresenceStatus("busy")).toBe("ON_JOB")
    expect(normalizePresenceStatus("CLOSED")).toBe("CLOSED")
    expect(normalizePresenceStatus("off")).toBe("CLOSED")
    expect(normalizePresenceStatus("")).toBe("AVAILABLE")
  })

  it("builds presence Closed and On-Job Gather prompts", () => {
    const closed = buildPresenceClosedGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-closed"
    )
    expect(closed).toContain(PRESENCE_CLOSED_PROMPT)
    expect(closed).toContain("presence-closed")

    const onJob = buildPresenceOnJobGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-on-job"
    )
    expect(onJob).toContain(PRESENCE_ON_JOB_PROMPT)
    expect(onJob).toContain("presence-on-job")
  })
})
