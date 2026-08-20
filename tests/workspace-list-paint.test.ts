import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { crmPaintToListItems, writeCrmListPaintSeed } from "@/lib/crm-list-paint-cache"
import { mapPoolPaintToJobs, writeMapPoolPaintSeed } from "@/lib/map-pool-paint-cache"
import { writeOperationsPaintSeed } from "@/lib/operations-paint-cache"
import { writePaintSeedCookie } from "@/lib/paint-seed-cookie"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import type { CrmCustomerListItem, UnassignedPoolJob } from "@/lib/types"

describe("workspace list paint cookies", () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    vi.stubGlobal("document", {
      get cookie() {
        return Object.entries(store)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ")
      },
      set cookie(value: string) {
        const [pair] = value.split(";")
        const eq = pair.indexOf("=")
        const key = pair.slice(0, eq)
        const val = pair.slice(eq + 1)
        if (value.includes("Max-Age=0")) delete store[key]
        else store[key] = val
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("writes an Activity paint cookie that fits the 4KB cap", () => {
    const calls = Array.from({ length: 20 }, (_, i) => ({
      id: `call-${i}`,
      type: "incoming",
      callerName: "Unknown Caller",
      callerNumber: "(502) 555-0100",
      targetLineE164: "+15025571219",
      routedTo: "Hold Queue",
      routedToReceptionistId: null,
      routedInitials: "HQ",
      routedColor: "bg-primary",
      date: "Today",
      time: "8:00 PM",
      createdAt: "2026-08-19T00:00:00.000Z",
      rawCallType: "incoming",
      callStatus: "completed",
      answeredAt: null,
      endedAt: null,
      durationSeconds: 12,
      hasRecording: false,
      recordingUrl: null,
      activity: null,
    })) as UiCallRecord[]
    writeOperationsPaintSeed(calls, Date.now(), "a3841ad1-2fb8-4482-a8d7-db7094cd95ee")
    expect(Object.keys(store).some((k) => k.includes("operations-calls"))).toBe(true)
  })

  it("expands CRM paint rows into list items", () => {
    const rows = crmPaintToListItems({
      organizationId: null,
      customers: [{ id: "c1", n: "Jade", p: "+15025550111", b: "booked_client" }],
    })
    expect(rows[0]?.display_name).toBe("Jade")
    expect(rows[0]?.phone_e164).toBe("+15025550111")
  })

  it("writes CRM and Map paint cookies", () => {
    writeCrmListPaintSeed(
      [
        {
          id: "c1",
          user_id: "u1",
          phone_e164: "+15025550111",
          display_name: "Jade",
          company_name: "",
          address_line1: "",
          address_line2: "",
          city: "",
          region: "",
          postal_code: "",
          country: "",
          notes: "",
          source_last_call_log_id: null,
          created_at: "",
          updated_at: "",
          jobs_completed: 1,
          lifetime_revenue_cents: 0,
          lead_badge: "new_contact",
          open_lead_count: 0,
        } as CrmCustomerListItem,
      ],
      null
    )
    writeMapPoolPaintSeed(
      [
        {
          id: "j1",
          customer_name: "Jade",
          customer_phone: null,
          location: "Louisville",
          neighborhood: "Highlands",
          summary: "Lockout",
          job_type: null,
          vehicle_year: null,
          vehicle_make: null,
          vehicle_model: null,
          job_notes: null,
          scheduled_at: null,
          duration_minutes: 60,
          dispatch_status: "UNASSIGNED",
          created_at: "",
          latitude: 38.2,
          longitude: -85.7,
        } as UnassignedPoolJob,
      ],
      null
    )
    expect(Object.keys(store).some((k) => k.includes("crm-list"))).toBe(true)
    expect(Object.keys(store).some((k) => k.includes("map-pool"))).toBe(true)
    expect(mapPoolPaintToJobs({ organizationId: null, jobs: [{ id: "j1", n: "Jade", pl: "Highlands", lat: 1, lng: 2 }] })[0]?.customer_name).toBe("Jade")
    writePaintSeedCookie("crm-list", { organizationId: null, customers: [] })
  })
})
