import { describe, expect, it } from "vitest"
import {
  DEFAULT_SMS_PHASE_TEMPLATES,
  LEGACY_SMS_PHASE_TEMPLATES,
  renderSmsTemplate,
  stockOrSaved,
  withOptionalVehicleTemplate,
} from "@/lib/sms-template-defaults"
import { DEFAULT_SMS_STATUS_TEMPLATES, normalizeSmsStatusTemplates } from "@/lib/sms-status-templates"

describe("stockOrSaved", () => {
  it("upgrades empty and old built-in booking copy", () => {
    expect(stockOrSaved("", DEFAULT_SMS_PHASE_TEMPLATES.booking, LEGACY_SMS_PHASE_TEMPLATES.booking)).toBe(
      DEFAULT_SMS_PHASE_TEMPLATES.booking
    )
    expect(
      stockOrSaved(
        LEGACY_SMS_PHASE_TEMPLATES.booking[0],
        DEFAULT_SMS_PHASE_TEMPLATES.booking,
        LEGACY_SMS_PHASE_TEMPLATES.booking
      )
    ).toBe(DEFAULT_SMS_PHASE_TEMPLATES.booking)
    expect(
      stockOrSaved("Hey Pat — custom shop line.", DEFAULT_SMS_PHASE_TEMPLATES.booking, LEGACY_SMS_PHASE_TEMPLATES.booking)
    ).toBe("Hey Pat — custom shop line.")
  })

  it("drops for the {{vehicle}} when there is no vehicle", () => {
    const stripped = withOptionalVehicleTemplate(DEFAULT_SMS_PHASE_TEMPLATES.booking, "")
    expect(stripped).not.toMatch(/\{\{\s*vehicle\s*\}\}/)
    expect(renderSmsTemplate(stripped, { customer_name: "Sam", business_name: "Lyncr", vehicle: "" })).not.toContain(
      "for the"
    )
  })
})

describe("normalizeSmsStatusTemplates", () => {
  it("fills check-in and upgrades old late copy", () => {
    const next = normalizeSmsStatusTemplates({
      late: "Hi {{customer_name}}, running about {{eta_minutes}} minutes late — on my way. Sorry for the wait! — {{business_name}}",
    })
    expect(next.check_in).toContain("just checking in")
    expect(next.late).toContain("Sorry about that")
    expect(next.late.toLowerCase()).not.toContain("on my way")
  })
})
