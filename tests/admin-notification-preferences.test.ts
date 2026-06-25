import { describe, expect, it } from "vitest"
import {
  isOutOfStateLead,
  parseAdminNotificationPreferences,
  resolveAdminNotificationPreferences,
} from "@/lib/admin-notification-preferences"
import {
  prepareOwnerEventForDelivery,
  shouldSendAdminLeadSms,
  shouldSendAdminLocalJobAssignmentSms,
} from "@/lib/admin-notification-dispatch"
import type { User } from "@/lib/types"

const adminUser: User = {
  id: "1",
  email: "admin@lyncr.app",
  name: "Admin",
  phone: "+15551234567",
  business_name: "Lyncr",
  account_role: "owner",
  inbound_receptionist_whisper_enabled: true,
  industry: "generic",
  telnyx_ai_assistant_id: null,
  created_at: new Date().toISOString(),
  credit_balance_cents: 0,
  billing_plan: "trial",
  is_platform_admin: true,
  answered_call_customer_popup_enabled: true,
  admin_notification_preferences: {
    sms_local_job_assignments: true,
    sms_global_out_of_state_bookings: false,
    push_live_inbound_ringing: false,
    push_operator_dispositions: true,
    email_daily_revenue_digest: true,
    email_system_fallback_alerts: true,
  },
}

describe("admin-notification-preferences", () => {
  it("parses partial JSON with defaults", () => {
    const prefs = parseAdminNotificationPreferences({ push_live_inbound_ringing: false })
    expect(prefs.push_live_inbound_ringing).toBe(false)
    expect(prefs.sms_local_job_assignments).toBe(true)
  })

  it("detects out-of-state leads", () => {
    expect(
      isOutOfStateLead({
        collected: { job_address_state: "TX" },
        ownerHomeState: "CA",
      })
    ).toBe(true)
    expect(
      isOutOfStateLead({
        collected: { job_address_state: "CA" },
        ownerHomeState: "CA",
      })
    ).toBe(false)
  })
})

describe("admin-notification-dispatch", () => {
  it("blocks global booking SMS when disabled", () => {
    expect(
      shouldSendAdminLeadSms({
        user: adminUser,
        collected: { job_address_state: "NY" },
        ownerHomeState: "CA",
      })
    ).toBe(false)
  })

  it("allows local dispatch SMS when enabled", () => {
    expect(shouldSendAdminLocalJobAssignmentSms(adminUser)).toBe(true)
  })

  it("tags inbound push events silent when ringing disabled", async () => {
    const prepared = await prepareOwnerEventForDelivery(
      adminUser.id,
      "call-initiated",
      { foo: 1 },
      adminUser
    )
    expect(prepared.publish).toBe(true)
    expect(prepared.payload.notificationDelivery).toBe("silent")
  })

  it("passes through for non-admin owners", async () => {
    const owner = { ...adminUser, is_platform_admin: false }
    const prepared = await prepareOwnerEventForDelivery(owner.id, "call-initiated", {}, owner)
    expect(prepared.payload.notificationDelivery).toBeUndefined()
  })
})
