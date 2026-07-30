"use client"

// Lines surface — SAFE MODE (React #185).
// Heavy children (call flow, telemetry, missed-lead, JustFinished) stripped until
// production loads without Maximum update depth. Re-add pieces one at a time.

import { memo } from "react"
import { PresenceStatusBar } from "@/components/dashboard/presence-status-bar"
import { AccountPresenceProvider } from "@/components/dashboard/account-presence-context"
import { formatPhoneDisplay, type Contact, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"
import { LINES_MOBILE_CARD, LINES_MOBILE_PAGE_X } from "@/lib/mobile-shell"

export type DashboardRoutingSurfaceProps = {
  quickSetupDecided: boolean
  callFlowUiReady: boolean
  isSetupComplete: boolean
  hasBusinessNumbers: boolean
  hasReceptionists: boolean
  businessNumbers: DashboardBusinessNumber[]
  routingBusinessNumber: string | null
  setRoutingBusinessNumber: (n: string | null) => void
  routingLineDetailLoading: boolean
  isRoutingToOwner: boolean
  selectedReceptionist: Contact | null
  ownerPhoneDisplay: string
  ringTimeoutSec: number
  activeFallbackLabel: string
  /** Sunday Autopilot — AI answers with owner rings bypassed. */
  autopilotMode: boolean
  routingStrategy: RoutingStrategy
  allowLyncrNetworkFallback: boolean
  onConfigureStrategy: () => void
  setDashboardStoryKey: (key: string | null) => void
  setWhoAnswersOpen: (open: boolean) => void
  setRingBackupOpen: (open: boolean) => void
  setShowFallbackSettings: (open: boolean) => void
  adminRoutingOverridePhone?: string | null
}

/** Call flow + setup checklist — isolated from sheet open state so drawers do not re-render this tree. */
export const DashboardRoutingSurface = memo(function DashboardRoutingSurface({
  businessNumbers,
  routingBusinessNumber,
}: DashboardRoutingSurfaceProps) {
  // Show the selected (or first) line as static text — no pickers / effects.
  const line =
    routingBusinessNumber ||
    businessNumbers[0]?.number ||
    null
  const lineDisplay = line ? formatPhoneDisplay(line) : null

  return (
    <AccountPresenceProvider>
      <div className="flex w-full flex-col">
        <div className="sticky top-0 z-50 w-full bg-slate-950">
          <PresenceStatusBar />
        </div>

        <div className={`min-h-0 w-full pb-24 md:pb-8 ${LINES_MOBILE_PAGE_X} pt-4`}>
          <div className={`mx-auto w-full max-w-lg space-y-3 ${LINES_MOBILE_CARD} px-4 py-4`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Lines
            </p>
            <p className="text-base font-semibold text-foreground">
              {lineDisplay ?? "No business line yet"}
            </p>
            <p className="text-xs leading-snug text-zinc-500">
              Safe mode is on while we finish fixing a phone crash. Presence above still
              works — Available rings your phone first; Busy skips to booking text.
            </p>
          </div>
        </div>
      </div>
    </AccountPresenceProvider>
  )
})
