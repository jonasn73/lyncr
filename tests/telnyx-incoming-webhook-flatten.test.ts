import { describe, expect, it } from "vitest"
import { flattenJsonWebhookToStringMap } from "@/lib/telnyx-incoming-webhook-flatten"

describe("flattenJsonWebhookToStringMap", () => {
  it("reads To / From / CallSid from data.payload (Telnyx-style nesting)", () => {
    const fields = flattenJsonWebhookToStringMap({
      data: {
        event_type: "call.initiated",
        payload: {
          from: "+15551230001",
          to: "+15025199908",
          call_control_id: "v2:abc-123-control",
        },
      },
    })
    expect(fields.To).toBe("+15025199908")
    expect(fields.From).toBe("+15551230001")
    expect(fields.CallSid).toBe("v2:abc-123-control")
  })

  it("still flattens one-level data.to when payload is absent", () => {
    const fields = flattenJsonWebhookToStringMap({
      data: {
        to: "+15025199741",
        from: "+15559876543",
        call_control_id: "cc-999",
      },
    })
    expect(fields.To).toBe("+15025199741")
    expect(fields.From).toBe("+15559876543")
    expect(fields.CallSid).toBe("cc-999")
  })

  it("reads root-level payload without data wrapper", () => {
    const fields = flattenJsonWebhookToStringMap({
      payload: {
        to: "+18005551212",
        call_control_id: "sid-root",
      },
    })
    expect(fields.To).toBe("+18005551212")
    expect(fields.CallSid).toBe("sid-root")
  })
})
