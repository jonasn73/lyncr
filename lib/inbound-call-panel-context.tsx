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
  vehicleYear?: string
  vehicleMake?: string
  vehicleModel?: string
  callStatus?: ManualCallStatus
  toNumber?: string
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
  const status: ManualCallStatus = input?.callStatus ?? "answered"
  const answeredAt = status === "ringing" ? null : new Date().toISOString()
  return {
    id: `manual-${crypto.randomUUID()}`,
    from_number: input?.phoneNumber?.trim() || "",
    to_number: input?.toNumber?.trim() || "",
    caller_name: null,
    answered_at: answeredAt,
    isManual: true,
    manualCallStatus: status,
    vehicleYear: input?.vehicleYear?.trim() || "",
    vehicleMake: input?.vehicleMake?.trim() || "",
    vehicleModel: input?.vehicleModel?.trim() || "",
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
