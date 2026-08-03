// Helpers for CRM walk-up service-history cards (paid Collect with no ai_leads row).
import { describe, expect, it } from "vitest"
import {
  emailFromCustomerNotes,
  isWalkUpHistoryId,
  mergeCrmServiceHistoryWithWalkUps,
  walkUpHistoryFromPayments,
} from "@/lib/crm-walk-up-history"
import type { OwnerCollectedTransaction } from "@/lib/owner-collected"
import type { CrmServiceHistoryItem, CustomerVehicle } from "@/lib/types"

function tx(
  partial: Partial<OwnerCollectedTransaction> &
    Pick<OwnerCollectedTransaction, "id" | "amount" | "status">
): OwnerCollectedTransaction {
  return {
    paymentMethod: "MANUAL_CARD",
    createdAt: "2026-07-24T22:25:41.721Z",
    jobId: null,
    customerName: "Drius Bell",
    customerPhone: "+18125576793",
    jobLabel: null,
    stripePaymentIntentId: "pi_test",
    tipCents: null,
    hasSignature: false,
    ...partial,
  }
}

const hino: CustomerVehicle = {
  id: "v1",
  customer_id: "c1",
  user_id: "u1",
  year: "2019",
  make: "Hino",
  model: "268",
  vin: "5PVNJ8JV1K4S71043",
  fcc_id: "",
  notes: "",
  created_at: "2026-08-03T15:41:44.424Z",
  updated_at: "2026-08-03T15:41:44.424Z",
}

describe("emailFromCustomerNotes", () => {
  it("reads Email: lines from CRM notes", () => {
    expect(
      emailFromCustomerNotes(
        "Email: dieselrepair93@gmail.com\nVehicle: 2019 Hino 268"
      )
    ).toBe("dieselrepair93@gmail.com")
  })

  it("returns empty when no email", () => {
    expect(emailFromCustomerNotes("Vehicle: 2019 Hino")).toBe("")
  })
})

describe("walkUpHistoryFromPayments", () => {
  it("builds a Paid walk-up AKL card from completed job-less charges", () => {
    const cards = walkUpHistoryFromPayments({
      payments: [tx({ id: "pay1", amount: 371, status: "COMPLETED" })],
      vehicles: [hino],
      notes: "Email: dieselrepair93@gmail.com\nVehicle: 2019 Hino 268\nWalk-up AKL",
    })
    expect(cards).toHaveLength(1)
    expect(isWalkUpHistoryId(cards[0]!.id)).toBe(true)
    expect(cards[0]!.status_label).toBe("Paid walk-up")
    expect(cards[0]!.status_tone).toBe("emerald")
    expect(cards[0]!.amount_cents).toBe(37100)
    expect(cards[0]!.summary).toContain("AKL")
    expect(cards[0]!.summary).toContain("2019 Hino 268")
    expect(cards[0]!.is_open_lead).toBe(false)
  })

  it("skips job-linked and non-completed payments", () => {
    const cards = walkUpHistoryFromPayments({
      payments: [
        tx({ id: "1", amount: 371, status: "COMPLETED", jobId: "lead-1" }),
        tx({ id: "2", amount: 50, status: "PENDING" }),
        tx({ id: "3", amount: 20, status: "FAILED" }),
      ],
      vehicles: [],
      notes: null,
    })
    expect(cards).toHaveLength(0)
  })
})

describe("mergeCrmServiceHistoryWithWalkUps", () => {
  it("appends walk-ups and sorts newest first", () => {
    const real: CrmServiceHistoryItem = {
      id: "lead-old",
      summary: "Lockout — older",
      status_label: "Done",
      status_tone: "emerald",
      assigned_tech_name: null,
      amount_cents: 10000,
      vehicle_label: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      service_quote_type_id: null,
      job_type: null,
      has_job_address: false,
      at: "2026-01-01T12:00:00.000Z",
      scheduled_at: null,
      dispatch_status: "completed",
      is_open_lead: false,
    }
    const merged = mergeCrmServiceHistoryWithWalkUps({
      history: [real],
      payments: [tx({ id: "pay-new", amount: 371, status: "COMPLETED" })],
      vehicles: [hino],
      notes: "AKL",
    })
    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).toBe("walkup:pay-new")
    expect(merged[1]!.id).toBe("lead-old")
  })
})
