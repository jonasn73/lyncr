import { describe, expect, it, vi } from "vitest"
import type { LostLeadRow } from "@/lib/lost-leads"

vi.mock("@/lib/lost-leads", () => ({
  markLostLeadFailed10Dlc: vi.fn(() => Promise.resolve()),
  markLostLeadRecoverySms: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/realtime/pusher-server", () => ({
  publishOwnerEvent: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("@/lib/telnyx-sms", () => ({
  TEN_DLC_BLOCK_USER_MESSAGE: "Message blocked by carrier due to missing 10DLC profile registration.",
  classifyTelnyxSmsError: (raw: string) => ({
    errorType: raw.includes("10DLC") ? "10DLC_BLOCK" : "OTHER",
    message: raw,
  }),
  sendTelnyxSms: vi.fn(),
}))

import { markLostLeadFailed10Dlc } from "@/lib/lost-leads"
import { publishOwnerEvent } from "@/lib/realtime/pusher-server"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { sendLostLeadRecoverySms } from "@/lib/lost-lead-recovery-sms"

const sampleRow: LostLeadRow = {
  id: "lost-1",
  user_id: "user-1",
  organization_id: null,
  call_log_id: null,
  phone_number: "+15551234567",
  last_quoted_price_cents: 8500,
  failure_reason: "Price too high",
  status: "lost_lead",
  vehicle_year: "2018",
  vehicle_make: "Ford",
  vehicle_model: "F-150",
  service_type: "Lockout",
  collected: {},
  recovery_sms_sent_at: null,
  recovery_sms_body: null,
  recovery_sms_error: null,
  created_at: new Date().toISOString(),
}

describe("sendLostLeadRecoverySms", () => {
  it("marks failed_10dlc and publishes salvage-recovery-blocked on 10DLC errors", async () => {
    vi.mocked(sendTelnyxSms).mockResolvedValue({
      ok: false,
      error: "10DLC campaign not assigned",
      errorType: "10DLC_BLOCK",
    })

    const result = await sendLostLeadRecoverySms(sampleRow)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failed10Dlc).toBe(true)
    expect(markLostLeadFailed10Dlc).toHaveBeenCalledWith(
      expect.objectContaining({ id: "lost-1", error: expect.any(String) })
    )
    expect(publishOwnerEvent).toHaveBeenCalledWith(
      "user-1",
      "salvage-recovery-blocked",
      expect.objectContaining({ status: "failed_10dlc", manual_retry_required: true })
    )
  })
})
