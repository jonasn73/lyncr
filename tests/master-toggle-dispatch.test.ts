import { describe, expect, it } from "vitest"
import {
  isSevereOwnerRoutingException,
  shouldSendLeadSmsForPlatformAdmin,
  withMasterToggleMeta,
} from "@/lib/master-toggle-dispatch"
import type { User } from "@/lib/types"

describe("master-toggle-dispatch", () => {
  it("tags silent admin payloads", () => {
    const out = withMasterToggleMeta({ foo: 1 }, "silent", "admin")
    expect(out.masterToggleDelivery).toBe("silent")
    expect(out.masterToggleMode).toBe("admin")
    expect(out.foo).toBe(1)
  })

  it("detects severe porting rejection", () => {
    expect(
      isSevereOwnerRoutingException("porting-update", { status: "rejected" })
    ).toBe(true)
    expect(isSevereOwnerRoutingException("job-booked", {})).toBe(false)
  })

  it("allows lead SMS only in tech mode for platform admins", () => {
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
      master_toggle_mode: "admin",
      answered_call_customer_popup_enabled: true,
    }
    expect(shouldSendLeadSmsForPlatformAdmin(admin)).toBe(false)
    expect(shouldSendLeadSmsForPlatformAdmin({ ...admin, master_toggle_mode: "tech" })).toBe(true)
  })
})
