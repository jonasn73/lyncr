import { describe, expect, it } from "vitest"
import {
  initialPresencePaneMounted,
  isDashboardRouteSsrPane,
  shouldMountPresencePane,
  shouldUseDeferredDynamicPane,
  shouldUseSsrActiveSlot,
} from "@/lib/dashboard-presence-ssr"

describe("dashboard presence SSR active tab", () => {
  it("statically SSR’s the hard-refresh URL pane (Activity, CRM, Map, …)", () => {
    // Reloading /dashboard/activity must use the page.tsx static import, not dynamic().
    expect(shouldUseSsrActiveSlot("activity", "activity")).toBe(true)
    expect(shouldUseSsrActiveSlot("customers", "customers")).toBe(true)
    expect(shouldUseSsrActiveSlot("contacts", "contacts")).toBe(true)
    expect(shouldUseSsrActiveSlot("messages", "messages")).toBe(true)
    expect(shouldUseSsrActiveSlot("pay", "pay")).toBe(true)
    expect(shouldUseSsrActiveSlot("settings", "settings")).toBe(true)
    expect(shouldUseSsrActiveSlot("scheduler", "scheduler")).toBe(true)
  })

  it("does not treat Lines as a route SSR slot (host already static-imports DashboardPage)", () => {
    // /dashboard paints DashboardPage from the presence host, not from page children.
    expect(isDashboardRouteSsrPane("dashboard")).toBe(false)
    expect(shouldUseSsrActiveSlot("dashboard", "dashboard")).toBe(false)
  })

  it("keeps inactive tabs on deferred dynamic() after a refresh of another URL", () => {
    // Reloading Activity must not SSR CRM/Map chunks; those stay ssr:false until visit.
    expect(shouldUseDeferredDynamicPane("activity", "customers")).toBe(true)
    expect(shouldUseDeferredDynamicPane("activity", "contacts")).toBe(true)
    expect(shouldUseDeferredDynamicPane("activity", "activity")).toBe(false)
  })

  it("mounts the active tab on first paint even when deferUntilVisit is on", () => {
    // Hard reload of the open tab cannot start as `null` then mount (that flashes).
    expect(initialPresencePaneMounted(true, true)).toBe(true)
    expect(initialPresencePaneMounted(true, false)).toBe(false)
    expect(initialPresencePaneMounted(false, false)).toBe(true)
  })

  it("mounts a deferred tab on the first click without a blank frame", () => {
    // visited=false + active=true must still mount (Map / CRM first open).
    expect(shouldMountPresencePane(true, false, true)).toBe(true)
    expect(shouldMountPresencePane(true, false, false)).toBe(false)
    expect(shouldMountPresencePane(true, true, false)).toBe(true)
    expect(shouldMountPresencePane(false, false, false)).toBe(true)
  })
})
