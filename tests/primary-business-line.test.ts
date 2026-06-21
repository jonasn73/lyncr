import { describe, expect, it, vi } from "vitest"
import {
  resolveActiveLineFor10DlcAssignment,
  resolvePrimaryBusinessLineForOrganization,
} from "@/lib/primary-business-line"
import * as db from "@/lib/db"
import type { PhoneNumber, PortingOrder } from "@/lib/types"

const USER = "user-1"
const ORG = "org-key-squad"

function mockPhone(overrides: Partial<PhoneNumber>): PhoneNumber {
  return {
    id: "pn-1",
    user_id: USER,
    organization_id: ORG,
    provider_number_sid: "sid-1",
    number: "+15022602716",
    friendly_name: "(502) 260-2716",
    label: "Temp line",
    type: "local",
    status: "active",
    source_provider: "telnyx",
    external_verified: true,
    industry_tag: null,
    routing_pool_mode: "sequential",
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function mockPort(overrides: Partial<PortingOrder>): PortingOrder {
  return {
    id: "port-1",
    owner_user_id: USER,
    organization_id: ORG,
    phone_number: "+15025571219",
    current_carrier: "ONVOY",
    account_number: "",
    status: "processing",
    telnyx_order_id: "tx-1",
    telnyx_status: "in-process",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as PortingOrder
}

describe("resolvePrimaryBusinessLineForOrganization", () => {
  it("prefers an in-flight port over another active business line", async () => {
    vi.spyOn(db, "getPhoneNumbers").mockResolvedValue([
      mockPhone({ number: "+15022602716", status: "active", label: "Cell temp" }),
      mockPhone({
        id: "pn-2",
        number: "+15025571219",
        status: "porting",
        label: "Key Squad main",
      }),
    ])
    vi.spyOn(db, "listPortingOrdersForOwner").mockResolvedValue([mockPort({})])

    const result = await resolvePrimaryBusinessLineForOrganization(USER, ORG)

    expect(result.number).toBe("+15025571219")
    expect(result.awaiting_port).toBe(true)
  })
})

describe("resolveActiveLineFor10DlcAssignment", () => {
  it("returns null while the primary port target is still porting", async () => {
    vi.spyOn(db, "getPhoneNumbers").mockResolvedValue([
      mockPhone({ number: "+15022602716", status: "active" }),
      mockPhone({
        id: "pn-2",
        number: "+15025571219",
        status: "porting",
        provider_number_sid: "port-order",
      }),
    ])
    vi.spyOn(db, "listPortingOrdersForOwner").mockResolvedValue([mockPort({})])

    const line = await resolveActiveLineFor10DlcAssignment(USER, ORG)

    expect(line).toBeNull()
  })

  it("assigns SMS to the port line once it is active", async () => {
    vi.spyOn(db, "getPhoneNumbers").mockResolvedValue([
      mockPhone({ number: "+15022602716", status: "active" }),
      mockPhone({
        id: "pn-2",
        number: "+15025571219",
        status: "active",
        provider_number_sid: "live-sid",
        label: "Key Squad main",
      }),
    ])
    vi.spyOn(db, "listPortingOrdersForOwner").mockResolvedValue([mockPort({ status: "processing" })])

    const line = await resolveActiveLineFor10DlcAssignment(USER, ORG)

    expect(line).toBe("+15025571219")
  })
})
