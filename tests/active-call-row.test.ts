import { describe, expect, it } from "vitest"
import { sameCallRow } from "@/lib/active-call-row"
import type { ActiveCallRow } from "@/lib/hooks/use-active-call-form"

const BASE: ActiveCallRow = {
  id: "call-1",
  from_number: "+15025550147",
  to_number: "+15025571219",
  caller_name: null,
  answered_at: "2026-08-23T20:00:00.000Z",
  recording_url: null,
  routed_to_name: null,
  call_type: "inbound",
  status: "answered",
}

describe("sameCallRow", () => {
  it("treats an unchanged poll payload as the same row", () => {
    expect(sameCallRow(BASE, { ...BASE })).toBe(true)
  })

  it("treats a missing optional key and an explicit undefined as equal", () => {
    expect(sameCallRow(BASE, { ...BASE, ended_at: undefined })).toBe(true)
  })

  it("notices a field that actually changed", () => {
    expect(sameCallRow(BASE, { ...BASE, status: "completed" })).toBe(false)
    expect(sameCallRow(BASE, { ...BASE, ended_at: "2026-08-23T20:05:00.000Z" })).toBe(false)
    expect(sameCallRow(BASE, { ...BASE, caller_name: "Alex" })).toBe(false)
  })

  it("notices a different call", () => {
    expect(sameCallRow(BASE, { ...BASE, id: "call-2" })).toBe(false)
  })

  it("does not confuse null with undefined", () => {
    // Deliberately off-type: caller_name is string | null, and the point of the
    // case is that an undefined slipping in is not treated as the null.
    const withUndefined = { ...BASE, caller_name: undefined } as unknown as ActiveCallRow
    expect(sameCallRow(BASE, withUndefined)).toBe(false)
  })
})
