import { describe, expect, it } from "vitest"
import {
  dedupeSalvagePoolEntries,
  mergeSalvageEntries,
  type SalvagePoolEntry,
} from "@/lib/salvage-pool"

const baseAi = (overrides: Partial<SalvagePoolEntry> = {}): SalvagePoolEntry => ({
  id: "ai-1",
  source: "ai_lead",
  caller_e164: "+15551234567",
  summary: "Receptionist notes",
  failure_reason: "Price rejected",
  status: "PRICE_REJECTED",
  last_quoted_price_cents: null,
  collected: { captured_by_name: "Sam" },
  created_at: "2026-07-04T14:00:00.000Z",
  manual_retry_required: false,
  recovery_blocked_reason: null,
  call_log_id: "log-ai",
  vehicle_label: null,
  service_type: null,
  has_receptionist_log: false,
  ...overrides,
})

const baseLost = (overrides: Partial<SalvagePoolEntry> = {}): SalvagePoolEntry => ({
  id: "lost-1",
  source: "lost_lead",
  caller_e164: "+1 (555) 123-4567",
  summary: "Lockout · Price too high",
  failure_reason: "Price too high",
  status: "lost_lead",
  last_quoted_price_cents: 8500,
  collected: { intake: true },
  created_at: "2026-07-04T16:00:00.000Z",
  manual_retry_required: false,
  recovery_blocked_reason: null,
  call_log_id: "log-lost",
  vehicle_label: "2018 Honda Civic",
  service_type: "Lockout",
  has_receptionist_log: false,
  ...overrides,
})

describe("mergeSalvageEntries", () => {
  it("favors lost_lead pricing and flags receptionist context", () => {
    const merged = mergeSalvageEntries(baseAi(), baseLost())
    expect(merged.source).toBe("lost_lead")
    expect(merged.id).toBe("lost-1")
    expect(merged.last_quoted_price_cents).toBe(8500)
    expect(merged.vehicle_label).toBe("2018 Honda Civic")
    expect(merged.has_receptionist_log).toBe(true)
    expect(merged.collected.receptionist_lead_id).toBe("ai-1")
  })
})

describe("dedupeSalvagePoolEntries", () => {
  it("collapses same caller on the same calendar day", () => {
    const deduped = dedupeSalvagePoolEntries([baseAi(), baseLost()])
    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.has_receptionist_log).toBe(true)
  })

  it("keeps separate rows for different days", () => {
    const deduped = dedupeSalvagePoolEntries([
      baseAi(),
      baseLost({ created_at: "2026-07-03T16:00:00.000Z", id: "lost-2" }),
    ])
    expect(deduped).toHaveLength(2)
  })
})
