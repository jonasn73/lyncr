import { describe, expect, it } from "vitest"
import { dashboardNavItems, mobileBottomNavItems } from "@/lib/dashboard-nav"

describe("dashboard nav", () => {
  it("keeps Scheduler on desktop command dock", () => {
    expect(dashboardNavItems.some((i) => i.id === "scheduler")).toBe(true)
  })

  it("hides Scheduler from mobile bottom nav (Lines · Activity · Messages · Map · CRM)", () => {
    expect(mobileBottomNavItems.map((i) => i.id)).toEqual([
      "dashboard",
      "activity",
      "messages",
      "contacts",
      "customers",
    ])
    expect(mobileBottomNavItems.some((i) => i.id === "scheduler")).toBe(false)
  })

  it("orders the rail by the path a call travels — Lines first, Settings last", () => {
    expect(dashboardNavItems.map((i) => i.id)).toEqual([
      "dashboard",
      "activity",
      "messages",
      "scheduler",
      "contacts",
      "customers",
      "pay",
      "settings",
    ])
  })

  it("labels the routing hub 'Lines' on both rail and bottom nav", () => {
    expect(dashboardNavItems.find((i) => i.id === "dashboard")?.label).toBe("Lines")
    expect(mobileBottomNavItems.find((i) => i.id === "dashboard")?.label).toBe("Lines")
  })

  it("keeps the bottom nav a subset of the rail, in the same relative order", () => {
    const railOrder = dashboardNavItems.map((i) => i.id)
    const mobileIds = mobileBottomNavItems.map((i) => i.id)
    expect(mobileIds.every((id) => railOrder.includes(id))).toBe(true)
    expect(mobileIds).toEqual(railOrder.filter((id) => mobileIds.includes(id)))
  })
})
