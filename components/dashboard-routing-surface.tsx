"use client"

// Lines surface — SAFE MODE (React #185 / Maximum update depth).
// Full call-flow + telemetry + missed-lead + JustFinished was restored in 70abbf3
// and brought the phone crash back (deploy dpl_AKruDnPUDFX8jt9W2iPRp7t5vMDC /
// commit 247900d). Strip heavy children again; Presence still routes calls.
// Re-add pieces one at a time after we have a component stack for the loop.

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

/** Minimal Lines shell — Presence only. Props kept so the parent API stays stable. */
export const DashboardRoutingSurface = memo(function DashboardRoutingSurface({
  businessNumbers,
  routingBusinessNumber,
}: DashboardRoutingSurfaceProps) {
  // Selected line (or first owned number) as static text — no pickers / effects.
  const line =
    routingBusinessNumber ||
    businessNumbers[0]?.number ||
    null
  const lineDisplay = line ? formatPhoneDisplay(line) : null

  return (
    <AccountPresenceProvider>
      <div className="flex w-full flex-col">
        {/* Sticky presence — Available / Busy still controls real call routing. */}
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
              Safe mode is on — the full Lines screen was crashing phones (React #185).
              Calls still route from Presence above: Available rings you first; Busy
              skips to booking text. Your In account balance chip in the header still
              works.
            </p>
          </div>
        </div>
      </div>
    </AccountPresenceProvider>
  )
})
