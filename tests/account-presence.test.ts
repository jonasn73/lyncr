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
    // TeXML escapes apostrophes — assert on distinctive unescaped phrases.
    expect(closed).toContain("off-duty for the evening")
    expect(closed).toContain("priority appointment slot")
    expect(closed).toContain("presence-closed")

    const onJob = buildPresenceOnJobGatherXml(
      "https://lyncr.app/api/telnyx-capture?step=presence-on-job"
    )
    expect(onJob).toContain("live lockout service")
    expect(onJob).toContain("next open dispatch slot")
    expect(onJob).toContain("presence-on-job")

    // Closed and On-Job must not share the same Speak copy.
    expect(PRESENCE_CLOSED_PROMPT).not.toBe(PRESENCE_ON_JOB_PROMPT)
  })
})
