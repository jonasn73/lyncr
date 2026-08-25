import { describe, expect, it } from "vitest"
import {
  agreementBodyMatches,
  hashAgreementBody,
  renderAgreement,
} from "@/lib/agreements/render"
import { templateKindForEmployment } from "@/lib/agreements/templates"
import type { PayComponent } from "@/lib/compensation/plan-schema"

const PER_SECOND: PayComponent = {
  kind: "TIME",
  unit: "SECOND",
  basis: "TALK",
  rate_micros: 4167,
  min_billable_seconds: 0,
}

const COMMISSION: PayComponent = {
  kind: "COMMISSION",
  rate_bps: 500,
  basis: "SUBTOTAL_EXCL_TAX",
  require: ["BOOKED", "COMPLETED", "PAID"],
}

const WAGE_FLOOR: PayComponent = { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: 7_250_000 }

function render(overrides: Partial<Parameters<typeof renderAgreement>[0]> = {}) {
  return renderAgreement({
    businessName: "Key Squad 502",
    workerName: "Jordan Pierce",
    workerRole: "receptionist",
    employmentType: "CONTRACTOR_1099",
    components: [PER_SECOND, COMMISSION],
    startDateIso: "2026-09-01T00:00:00.000Z",
    ...overrides,
  })
}

describe("which agreement someone signs", () => {
  it("gives an employee employment terms and a contractor an agreement", () => {
    expect(templateKindForEmployment("W2_EMPLOYEE")).toBe("W2_OFFER")
    expect(templateKindForEmployment("CONTRACTOR_1099")).toBe("CONTRACTOR_AGREEMENT")
  })

  it("refuses to render without an employment type", () => {
    // Lyncr must not classify anyone. An unclassified worker gets no contract at all
    // rather than one that guesses.
    expect(() => render({ employmentType: "UNSPECIFIED" })).toThrow(/employment type/i)
  })

  it("refuses to render without pay terms", () => {
    expect(() => render({ components: [] })).toThrow(/pay/i)
  })
})

describe("what the agreement actually says", () => {
  it("states the real rate, not a rounded one", () => {
    // "$0.00 per talk second" would be a lie somebody signs.
    expect(render().body).toContain("$0.004167 per talk second")
  })

  it("names the business, the worker, and the start date", () => {
    const body = render().body
    expect(body).toContain("Key Squad 502")
    expect(body).toContain("Jordan Pierce")
    expect(body).toContain("September 1, 2026")
  })

  it("tells a contractor they are responsible for their own tax", () => {
    const body = render().body
    expect(body).toContain("self-employment tax")
    expect(body).toContain("1099-NEC")
  })

  it("tells an employee tax will be withheld", () => {
    const body = render({ employmentType: "W2_EMPLOYEE", components: [PER_SECOND] }).body
    expect(body).toContain("W-2")
    expect(body).toMatch(/withhold/i)
  })

  it("leaves no placeholder unfilled", () => {
    expect(render().body).not.toMatch(/\{\{\w+\}\}/)
    expect(render({ employmentType: "W2_EMPLOYEE", components: [PER_SECOND] }).body).not.toMatch(
      /\{\{\w+\}\}/
    )
  })
})

describe("the wage floor clause", () => {
  it("promises the top-up only when the plan actually carries one", () => {
    const withFloor = render({
      employmentType: "W2_EMPLOYEE",
      components: [PER_SECOND, WAGE_FLOOR],
    }).body
    expect(withFloor).toContain("$7.25 per hour")
    expect(withFloor).toContain("each workweek")
  })

  it("says nothing about a floor when there is none to keep", () => {
    const withoutFloor = render({ employmentType: "W2_EMPLOYEE", components: [PER_SECOND] }).body
    expect(withoutFloor).not.toMatch(/per hour for the hours you worked/)
  })

  it("never promises a contractor a floor", () => {
    // Minimum wage is an employee protection; offering it here would describe a term
    // the system does not implement for contractors.
    expect(render().body).not.toMatch(/pay you the difference/)
  })
})

describe("freezing what was signed", () => {
  it("fingerprints the rendered text", () => {
    const rendered = render()
    expect(rendered.sha256).toBe(hashAgreementBody(rendered.body))
    expect(agreementBodyMatches(rendered.body, rendered.sha256)).toBe(true)
  })

  it("notices a body that no longer matches its fingerprint", () => {
    const rendered = render()
    const tampered = rendered.body.replace("5% of", "50% of")
    expect(agreementBodyMatches(tampered, rendered.sha256)).toBe(false)
  })

  it("produces a different fingerprint for different pay", () => {
    const cheaper = render({ components: [{ ...COMMISSION, rate_bps: 300 }, PER_SECOND] })
    expect(cheaper.sha256).not.toBe(render().sha256)
  })

  it("is stable for identical input", () => {
    expect(render().sha256).toBe(render().sha256)
  })
})
