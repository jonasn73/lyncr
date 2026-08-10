import { describe, expect, it } from "vitest"
import { dashboardNavItems, mobileBottomNavItems } from "@/lib/dashboard-nav"

describe("dashboard nav", () => {
  it("keeps Scheduler on desktop command dock", () => {
    expect(dashboardNavItems.some((i) => i.id === "scheduler")).toBe(true)
  })

  it("hides Scheduler from mobile bottom nav (Lines · Activity · CRM · Map)", () => {
    expect(mobileBottomNavItems.map((i) => i.id)).toEqual([
      "dashboard",
      "activity",
      "customers",
      "contacts",
    ])
    expect(mobileBottomNavItems.some((i) => i.id === "scheduler")).toBe(false)
  })
})
