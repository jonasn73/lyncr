"use client"

// Programmatic control of the answered-call intake sheet (manual walk-in / tester calls).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { ActiveCallRow, ManualCallStatus } from "@/lib/hooks/use-active-call-form"

/** Optional seed values when opening the sheet from dispatch operations. */
export type OpenManualCallPanelInput = {
  phoneNumber?: string
  customerName?: string
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  quotedPriceCents?: number
  /** Calculator id for Continue-quote / Book thin-lead handoff (never invent Lockout). */
  serviceQuoteTypeId?: string
  callStatus?: ManualCallStatus
  toNumber?: string
  /** Existing ai_leads id when converting from CRM — intake completes that row. */
  leadId?: string
  /** Existing call_logs.id when completing intake from Activities (binds purpose/outcome to that call). */
  callLogId?: string
  /** ISO answered_at from the call log when known. */
  answeredAt?: string | null
  /**
   * `quick` = missed-call purpose/notes sheet (no YMM / multi-step booking).
   * Default `full` keeps the answered-call wizard.
   */
  intakeMode?: "full" | "quick"
  /**
   * CRM Book on a thin quote — skip Service / chooser and land on Continue-quote step.
   * Aligns with callback chooser “Continue open quote”.
   */
  continueOpenQuote?: boolean
  /** Precomputed Continue-quote step (VEHICLE_INFO | ADDRESS_CONTACT | SCHEDULE_TIME). */
  intakeStartStep?: "VEHICLE_INFO" | "ADDRESS_CONTACT" | "SCHEDULE_TIME"
}

type InboundCallPanelContextValue = {
  /** Synthetic row shown in CallAnsweredModal — null when only webhooks drive the sheet. */
  manualCallRow: ActiveCallRow | null
  /** Force the intake sheet open with editable phone / vehicle / status fields. */
  openManualCallPanel: (input?: OpenManualCallPanelInput) => void
  /** Patch manual-only fields (status, phone) while the sheet stays open. */
  patchManualCallRow: (patch: Partial<ActiveCallRow>) => void
  /** Clear manual override after dismiss or successful booking. */
  clearManualCallRow: () => void
}

const InboundCallPanelContext = createContext<InboundCallPanelContextValue | null>(null)

function buildManualRow(input?: OpenManualCallPanelInput): ActiveCallRow {
  // Ringing vs answered controls whether the sheet looks “live” or post-call.
  const status: ManualCallStatus = input?.callStatus ?? "answered"
  // Prefer the real call’s answered_at; otherwise stamp “now” for answered manuals.
  const answeredAt =
    status === "ringing"
      ? null
      : input?.answeredAt?.trim() || new Date().toISOString()
  // CRM convert may pass an existing lead; Activities may pass the call log id.
  const leadId = input?.leadId?.trim() || ""
  const callLogId = input?.callLogId?.trim() || ""
  // Row id: real call log → CRM lead → fresh synthetic manual id.
  const id = callLogId || leadId || `manual-${crypto.randomUUID()}`
  return {
    id,
    from_number: input?.phoneNumber?.trim() || "",
    to_number: input?.toNumber?.trim() || "",
    caller_name: input?.customerName?.trim() || null,
    answered_at: answeredAt,
    isManual: true,
    manualCallStatus: status,
    vehicleYear: input?.vehicleYear?.trim() || "",
    vehicleMake: input?.vehicleMake?.trim() || "",
    vehicleModel: input?.vehicleModel?.trim() || "",
    quotedPriceCents:
      typeof input?.quotedPriceCents === "number" && input.quotedPriceCents > 0
        ? Math.round(input.quotedPriceCents)
        : undefined,
    // Only set when Activities (or similar) rebound a real call_logs row.
    sourceCallLogId: callLogId || undefined,
    // Only set when CRM handoff targets an existing ai_leads row.
    existingLeadId: leadId || undefined,
    // Missed Activities → quick note; everything else uses the full wizard.
    intakeMode: input?.intakeMode === "quick" ? "quick" : "full",
    serviceQuoteTypeId: input?.serviceQuoteTypeId?.trim() || undefined,
    // Thin CRM Book → same Continue-quote path as the callback chooser.
    continueOpenQuote: input?.continueOpenQuote === true,
    intakeStartStep: input?.intakeStartStep,
  }
}

export function InboundCallPanelProvider({ children }: { children: ReactNode }) {
  const [manualCallRow, setManualCallRow] = useState<ActiveCallRow | null>(null)

  const openManualCallPanel = useCallback((input?: OpenManualCallPanelInput) => {
    setManualCallRow(buildManualRow(input))
  }, [])

  const patchManualCallRow = useCallback((patch: Partial<ActiveCallRow>) => {
    setManualCallRow((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const clearManualCallRow = useCallback(() => {
    setManualCallRow(null)
  }, [])

  const value = useMemo(
    () => ({
      manualCallRow,
      openManualCallPanel,
      patchManualCallRow,
      clearManualCallRow,
    }),
    [manualCallRow, openManualCallPanel, patchManualCallRow, clearManualCallRow]
  )

  return <InboundCallPanelContext.Provider value={value}>{children}</InboundCallPanelContext.Provider>
}

export function useInboundCallPanel(): InboundCallPanelContextValue {
  const ctx = useContext(InboundCallPanelContext)
  if (!ctx) {
    throw new Error("useInboundCallPanel must be used within InboundCallPanelProvider")
  }
  return ctx
}

/** Safe hook for components that may render outside the dashboard shell. */
export function useInboundCallPanelOptional(): InboundCallPanelContextValue | null {
  return useContext(InboundCallPanelContext)
}
