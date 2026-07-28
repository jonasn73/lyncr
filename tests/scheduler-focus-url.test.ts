import { describe, expect, it } from "vitest"
import {
  buildCrmReturnUrl,
  buildSchedulerFocusUrl,
  isCompleteDatetimeLocalValue,
  parseSchedulerFocusSearch,
  shouldAutoAdvanceAfterSchedulePick,
} from "@/lib/scheduler-focus-url"

describe("scheduler focus url", () => {
  it("builds focus + schedule links", () => {
    expect(buildSchedulerFocusUrl("lead-1")).toBe("/dashboard/scheduler?focus=lead-1")
    expect(buildSchedulerFocusUrl("lead-1", { schedule: true })).toBe(
      "/dashboard/scheduler?focus=lead-1&schedule=1"
    )
  })

  it("builds CRM return context on focus links", () => {
    expect(
      buildSchedulerFocusUrl("lead-1", { fromCrm: true, customerId: "cust-9" })
    ).toBe("/dashboard/scheduler?focus=lead-1&from=crm&customer=cust-9")
  })

  it("builds CRM return urls", () => {
    expect(buildCrmReturnUrl(null)).toBe("/dashboard/customers")
    expect(buildCrmReturnUrl("cust-9")).toBe("/dashboard/customers?customer=cust-9")
  })

  it("parses focus search params", () => {
    expect(parseSchedulerFocusSearch("focus=abc&schedule=1")).toEqual({
      focusLeadId: "abc",
      scheduleFromIntake: true,
      fromCrm: false,
      customerId: null,
    })
    expect(parseSchedulerFocusSearch("focus=abc")).toEqual({
      focusLeadId: "abc",
      scheduleFromIntake: false,
      fromCrm: false,
      customerId: null,
    })
    expect(parseSchedulerFocusSearch("focus=abc&from=crm&customer=cust-9")).toEqual({
      focusLeadId: "abc",
      scheduleFromIntake: false,
      fromCrm: true,
      customerId: "cust-9",
    })
  })

  it("detects complete datetime-local values", () => {
    expect(isCompleteDatetimeLocalValue("2026-06-25T14:30")).toBe(true)
    expect(isCompleteDatetimeLocalValue("2026-06-25")).toBe(false)
  })

  it("auto-advances for future days or later today", () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0")
    const d = String(tomorrow.getDate()).padStart(2, "0")
    expect(shouldAutoAdvanceAfterSchedulePick(`${y}-${m}-${d}T10:00`)).toBe(true)
  })
})
