import { describe, expect, it, vi, beforeEach } from "vitest"
import { lookupReceptionistCaller } from "@/lib/receptionist-caller-lookup"

const listCrmCustomersForUser = vi.fn()
const listCrmServiceHistoryForCustomer = vi.fn()

// Hoisted by vitest above the import, so the module under test binds to these.
vi.mock("@/lib/db", () => ({
  listCrmCustomersForUser: (...args: unknown[]) => listCrmCustomersForUser(...args),
  listCrmServiceHistoryForCustomer: (...args: unknown[]) => listCrmServiceHistoryForCustomer(...args),
  normalizePhoneNumberE164: (raw: string) => {
    const digits = String(raw ?? "").replace(/\D/g, "")
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return raw
  },
}))

function crmRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    phone_e164: "+15025551234",
    display_name: "Jade Sanders",
    city: "Louisville",
    region: "KY",
    jobs_completed: 2,
    lifetime_revenue_cents: 38000,
    open_lead_count: 1,
    has_book_form_lead: false,
    job_status_label: "Price quoted",
    job_status_tone: "amber",
    notes: "",
    ...overrides,
  }
}

beforeEach(() => {
  listCrmCustomersForUser.mockReset()
  listCrmServiceHistoryForCustomer.mockReset()
  listCrmServiceHistoryForCustomer.mockResolvedValue([])
})

describe("receptionist caller lookup", () => {
  it("returns the CRM record for a known caller", async () => {
    listCrmCustomersForUser.mockResolvedValue([crmRow()])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.found).toBe(true)
    expect(result.display_name).toBe("Jade Sanders")
    expect(result.jobs_completed).toBe(2)
    expect(result.job_status_label).toBe("Price quoted")
    expect(result.job_status_tone).toBe("amber")
  })

  it("matches regardless of +1 and formatting", async () => {
    // Carrier gives one shape, CRM stores another — matching on the last 10 digits is
    // what actually lines them up.
    listCrmCustomersForUser.mockResolvedValue([crmRow({ phone_e164: "(502) 555-1234" })])
    const result = await lookupReceptionistCaller("owner-1", "+1 502 555 1234")
    expect(result.found).toBe(true)
  })

  it("does not claim identity when the fuzzy search returns someone else", async () => {
    // The CRM search is fuzzy; announcing the wrong customer's history is worse than none.
    listCrmCustomersForUser.mockResolvedValue([crmRow({ phone_e164: "+15029999999" })])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.found).toBe(false)
    expect(result.display_name).toBeNull()
    expect(result.phone_e164).toBe("+15025551234")
  })

  it("treats an unknown caller as a normal outcome", async () => {
    listCrmCustomersForUser.mockResolvedValue([])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.found).toBe(false)
    expect(result.jobs_completed).toBe(0)
  })

  it("skips the query for a number that cannot identify anyone", async () => {
    for (const bad of [null, "", "blocked", "911"]) {
      const result = await lookupReceptionistCaller("owner-1", bad)
      expect(result.found).toBe(false)
    }
    expect(listCrmCustomersForUser).not.toHaveBeenCalled()
  })

  it("never throws when CRM fails — the screen-pop must still render", async () => {
    listCrmCustomersForUser.mockRejectedValue(new Error("neon down"))
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.found).toBe(false)
    expect(result.phone_e164).toBe("+15025551234")
  })

  it("scopes the lookup to the owner the receptionist is linked to", async () => {
    listCrmCustomersForUser.mockResolvedValue([])
    await lookupReceptionistCaller("owner-42", "+15025551234")
    expect(listCrmCustomersForUser).toHaveBeenCalledWith("owner-42", expect.anything())
  })

  it("surfaces a waiting book form ahead of a plain open lead", async () => {
    listCrmCustomersForUser.mockResolvedValue([
      crmRow({ has_book_form_lead: true, open_lead_count: 3 }),
    ])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.has_open_book_form).toBe(true)
    expect(result.open_lead_count).toBe(3)
  })

  it("surfaces the last job's split vehicle YMM and job type for one-tap prefill", async () => {
    listCrmCustomersForUser.mockResolvedValue([crmRow()])
    listCrmServiceHistoryForCustomer.mockResolvedValue([
      {
        summary: "Ignition repair",
        vehicle_label: "2019 Honda Civic",
        vehicle_year: "2019",
        vehicle_make: "Honda",
        vehicle_model: "Civic",
        job_type: "Ignition",
        scheduled_at: "2026-02-01T10:00:00.000Z",
        at: "2026-01-30T10:00:00.000Z",
      },
    ])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.last_job_vehicle_year).toBe("2019")
    expect(result.last_job_vehicle_make).toBe("Honda")
    expect(result.last_job_vehicle_model).toBe("Civic")
    expect(result.last_job_type).toBe("Ignition")
  })

  it("leaves vehicle prefill fields null when there is no job history", async () => {
    listCrmCustomersForUser.mockResolvedValue([crmRow()])
    const result = await lookupReceptionistCaller("owner-1", "+15025551234")
    expect(result.last_job_vehicle_year).toBeNull()
    expect(result.last_job_vehicle_make).toBeNull()
    expect(result.last_job_vehicle_model).toBeNull()
    expect(result.last_job_type).toBeNull()
  })
})
