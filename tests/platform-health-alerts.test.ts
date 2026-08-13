import { describe, expect, it } from "vitest"
import {
  decidePlatformHealthAlert,
  formatPlatformHealthAlertMessage,
  isPlatformHealthRed,
} from "@/lib/platform-health-alerts"
import {
  shouldSendAdminPlatformHealthEmail,
  shouldSendAdminPlatformHealthSms,
} from "@/lib/admin-notification-dispatch"
import type { User } from "@/lib/types"

const now = new Date("2026-08-13T14:00:00.000Z")

describe("isPlatformHealthRed", () => {
  it("treats only error as red", () => {
    expect(isPlatformHealthRed("error")).toBe(true)
    expect(isPlatformHealthRed("ok")).toBe(false)
    expect(isPlatformHealthRed("unconfigured")).toBe(false)
    expect(isPlatformHealthRed(null)).toBe(false)
  })
})

describe("decidePlatformHealthAlert", () => {
  it("pages on the first error with no snapshot", () => {
    expect(
      decidePlatformHealthAlert({ currentStatus: "error", previous: null, now })
    ).toEqual({ action: "alert_down", reason: "first_error" })
  })

  it("pages when flipping from ok to error", () => {
    expect(
      decidePlatformHealthAlert({
        currentStatus: "error",
        previous: { status: "ok", last_alerted_at: null, last_recovery_alerted_at: null },
        now,
      })
    ).toEqual({ action: "alert_down", reason: "flipped_to_error" })
  })

  it("stays quiet while still red inside cooldown", () => {
    expect(
      decidePlatformHealthAlert({
        currentStatus: "error",
        previous: {
          status: "error",
          last_alerted_at: "2026-08-13T13:50:00.000Z",
          last_recovery_alerted_at: null,
        },
        now,
        cooldownMs: 20 * 60 * 1000,
      })
    ).toEqual({ action: "none", reason: "error_within_cooldown" })
  })

  it("re-pages after cooldown while still red", () => {
    expect(
      decidePlatformHealthAlert({
        currentStatus: "error",
        previous: {
          status: "error",
          last_alerted_at: "2026-08-13T13:30:00.000Z",
          last_recovery_alerted_at: null,
        },
        now,
        cooldownMs: 20 * 60 * 1000,
      })
    ).toEqual({ action: "alert_down", reason: "error_cooldown_elapsed" })
  })

  it("sends one recovery alert when error becomes ok", () => {
    expect(
      decidePlatformHealthAlert({
        currentStatus: "ok",
        previous: {
          status: "error",
          last_alerted_at: "2026-08-13T13:00:00.000Z",
          last_recovery_alerted_at: null,
        },
        now,
      })
    ).toEqual({ action: "alert_up", reason: "recovered" })
  })

  it("does not alert on unconfigured Telnyx", () => {
    expect(
      decidePlatformHealthAlert({
        currentStatus: "unconfigured",
        previous: { status: "unconfigured", last_alerted_at: null, last_recovery_alerted_at: null },
        now,
      })
    ).toEqual({ action: "none", reason: "healthy" })
  })
})

describe("formatPlatformHealthAlertMessage", () => {
  it("uses plain shop English", () => {
    expect(
      formatPlatformHealthAlertMessage({ checkName: "neon", action: "alert_down", status: "error" })
    ).toContain("Neon (database) is down")
    expect(
      formatPlatformHealthAlertMessage({ checkName: "telnyx", action: "alert_up", status: "ok" })
    ).toContain("Telnyx (phone) is OK again")
  })
})

describe("platform health notification toggles", () => {
  const admin: User = {
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
      sms_global_out_of_state_bookings: true,
      push_live_inbound_ringing: true,
      push_operator_dispositions: true,
      email_daily_revenue_digest: true,
      email_system_fallback_alerts: true,
      sms_platform_health: false,
    },
  }

  it("never texts shop owners about platform health", () => {
    expect(shouldSendAdminPlatformHealthSms({ ...admin, is_platform_admin: false })).toBe(false)
    expect(shouldSendAdminPlatformHealthEmail({ ...admin, is_platform_admin: false })).toBe(false)
  })

  it("respects the Platform health SMS mute", () => {
    expect(shouldSendAdminPlatformHealthSms(admin)).toBe(false)
    expect(
      shouldSendAdminPlatformHealthSms({
        ...admin,
        admin_notification_preferences: {
          ...admin.admin_notification_preferences!,
          sms_platform_health: true,
        },
      })
    ).toBe(true)
  })
})
