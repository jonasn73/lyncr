import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearOperationsDataCache,
  initialOperationsLoading,
  peekOperationsCache,
  shouldShowOperationsSkeleton,
} from "@/lib/hooks/use-operations-data"

describe("operations activity paint", () => {
  beforeEach(() => {
    // Vitest node env has no window/sessionStorage — stub both (#185-safe client APIs).
    const store = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    })
    vi.stubGlobal("window", globalThis)
  })

  afterEach(() => {
    // Drop in-memory + session cache between cases.
    clearOperationsDataCache()
    vi.unstubAllGlobals()
  })

  it("never shows the full table skeleton when call rows already exist", () => {
    // Tab click / refetch with rows on screen must keep the real table.
    expect(shouldShowOperationsSkeleton(true, 12)).toBe(false)
    expect(shouldShowOperationsSkeleton(false, 12)).toBe(false)
  })

  it("shows the skeleton only on a true cold load (loading + zero rows)", () => {
    expect(shouldShowOperationsSkeleton(true, 0)).toBe(true)
    expect(shouldShowOperationsSkeleton(false, 0)).toBe(false)
  })

  it("does not start loading when a seed object exists (including empty calls)", () => {
    // Empty successful cache still counts as painted — no gray bars wipe.
    expect(initialOperationsLoading({ calls: [] })).toBe(false)
    expect(initialOperationsLoading({ calls: [{ id: "1" }] })).toBe(false)
  })

  it("starts loading only when memory + session seed are both missing", () => {
    expect(initialOperationsLoading(null)).toBe(true)
    expect(initialOperationsLoading(undefined)).toBe(true)
  })

  it("peeks sessionStorage seed without requiring the Activity tab to mount", () => {
    const payload = {
      organizationId: null as string | null,
      calls: [
        {
          id: "seed-1",
          type: "incoming",
          callerName: "Unknown Caller",
          callerNumber: "(502) 555-0100",
          targetLineE164: "+15025550100",
          routedTo: "",
          routedToReceptionistId: null,
          routedInitials: "NA",
          routedColor: "bg-primary",
          date: "Today",
          time: "10:42 AM",
          createdAt: "2026-08-13T14:42:00.000Z",
          rawCallType: "incoming",
          callStatus: "hold_queue",
          answeredAt: null,
          endedAt: null,
          durationSeconds: 49,
          hasRecording: false,
          recordingUrl: null,
          activity: {
            intakeAction: "No intake recorded",
            intakeDetail: null,
            scheduleLabel: null,
            scheduleAt: null,
            leadId: null,
            callerScheduleHint: null,
            callerPoolCount: 0,
          },
        },
      ],
      quality: null,
      insights: null,
      fetchedAt: Date.now(),
    }
    sessionStorage.setItem("zing_operations_v2", JSON.stringify(payload))
    const peeked = peekOperationsCache()
    expect(peeked?.calls).toHaveLength(1)
    expect(peeked?.calls[0]?.id).toBe("seed-1")
    expect(initialOperationsLoading(peeked)).toBe(false)
    expect(shouldShowOperationsSkeleton(initialOperationsLoading(peeked), peeked?.calls.length ?? 0)).toBe(
      false
    )
  })
})
