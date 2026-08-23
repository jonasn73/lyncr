import { describe, expect, it } from "vitest"
import {
  isAmberMissedCallsPhrase,
  isAmberNextJobPhrase,
  isAmberRevenuePhrase,
  matchAmberQaTopic,
} from "@/lib/amber-qa"
import { isAmberBriefingPhrase } from "@/lib/amber-commands"

describe("isAmberRevenuePhrase", () => {
  it("catches revenue questions", () => {
    expect(isAmberRevenuePhrase("How much did I make today?")).toBe(true)
    expect(isAmberRevenuePhrase("what did I collect today")).toBe(true)
    expect(isAmberRevenuePhrase("how's revenue today")).toBe(true)
    expect(isAmberRevenuePhrase("revenue today")).toBe(true)
    expect(isAmberRevenuePhrase("how much money today")).toBe(true)
  })

  it("does not catch unrelated text", () => {
    expect(isAmberRevenuePhrase("tell him we can come tomorrow")).toBe(false)
    expect(isAmberRevenuePhrase("skip Noah")).toBe(false)
  })
})

describe("isAmberMissedCallsPhrase", () => {
  it("catches missed-call questions", () => {
    expect(isAmberMissedCallsPhrase("any missed calls?")).toBe(true)
    expect(isAmberMissedCallsPhrase("how many calls today")).toBe(true)
    expect(isAmberMissedCallsPhrase("did I miss any calls")).toBe(true)
  })

  it("does not catch unrelated text", () => {
    expect(isAmberMissedCallsPhrase("what's my status")).toBe(false)
  })
})

describe("isAmberNextJobPhrase", () => {
  it("catches schedule questions", () => {
    expect(isAmberNextJobPhrase("what's my next job")).toBe(true)
    expect(isAmberNextJobPhrase("what's on my schedule")).toBe(true)
    expect(isAmberNextJobPhrase("what do I have today")).toBe(true)
    expect(isAmberNextJobPhrase("schedule today")).toBe(true)
  })

  it("does not catch unrelated text", () => {
    expect(isAmberNextJobPhrase("send it")).toBe(false)
  })
})

describe("matchAmberQaTopic", () => {
  it("resolves the right topic and never collides with the leftover briefing", () => {
    expect(matchAmberQaTopic("How much did I make today?")).toBe("revenue")
    expect(matchAmberQaTopic("any missed calls")).toBe("missed_calls")
    expect(matchAmberQaTopic("what's my next job")).toBe("next_job")
    expect(matchAmberQaTopic("skip Noah")).toBeNull()
    // Q&A phrasing must stay distinct from the existing leftover-briefing vocabulary.
    expect(isAmberBriefingPhrase("How much did I make today?")).toBe(false)
    expect(isAmberBriefingPhrase("any missed calls")).toBe(false)
    expect(isAmberBriefingPhrase("what's my next job")).toBe(false)
  })
})
