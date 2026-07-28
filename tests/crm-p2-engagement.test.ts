import { describe, expect, it } from "vitest"
import type { CrmServiceHistoryItem } from "@/lib/types"

/** Mirror CRM history action labels used by crm-workspace-view (P2 salvage). */
function crmJobNavAction(item: CrmServiceHistoryItem): "Book job" | "Open job" | "View job" | "Recover" | null {
  const terminal = new Set(["Done", "Completed", "Cancelled", "Referred", "Unresolved"])
  if (terminal.has(item.status_label)) return "View job"
  if (item.is_open_lead && item.is_salvageable) return "Recover"
  if (item.is_open_lead) return "Book job"
  if (
    item.status_label === "In pool" ||
    item.status_label === "Scheduled" ||
    item.status_label === "En route" ||
    item.status_label === "On site" ||
    item.status_label === "Paused"
  ) {
    return "Open job"
  }
  return null
}

function historyStub(partial: Partial<CrmServiceHistoryItem>): CrmServiceHistoryItem {
  return {
    id: "lead-1",
    summary: "Lockout",
    status_label: "Needs call",
    status_tone: "amber",
    assigned_tech_name: null,
    amount_cents: null,
    vehicle_label: null,
    vehicle_year: null,
    vehicle_make: null,
    vehicle_model: null,
    service_quote_type_id: null,
    job_type: null,
    has_job_address: false,
    at: new Date().toISOString(),
    scheduled_at: null,
    dispatch_status: "lead",
    is_open_lead: true,
    is_salvageable: false,
    ...partial,
  }
}

describe("P2 CRM engagement actions", () => {
  it("maps missed-call / callback open leads to Book job", () => {
    expect(
      crmJobNavAction(
        historyStub({ status_label: "Needs call", dispatch_status: "lead", is_open_lead: true })
      )
    ).toBe("Book job")
  })

  it("maps price-rejected / lost salvage leads to Recover", () => {
    expect(
      crmJobNavAction(
        historyStub({
          status_label: "Needs recovery",
          status_tone: "rose",
          dispatch_status: "salvage_pending",
          is_open_lead: true,
          is_salvageable: true,
        })
      )
    ).toBe("Recover")
    expect(
      crmJobNavAction(
        historyStub({
          status_label: "Price rejected",
          dispatch_status: "lost_lead",
          is_open_lead: true,
          is_salvageable: true,
        })
      )
    ).toBe("Recover")
  })

  it("keeps pool jobs on Open job (not Recover)", () => {
    expect(
      crmJobNavAction(
        historyStub({
          status_label: "In pool",
          dispatch_status: "unassigned_pool",
          is_open_lead: false,
          is_salvageable: false,
        })
      )
    ).toBe("Open job")
  })
})
