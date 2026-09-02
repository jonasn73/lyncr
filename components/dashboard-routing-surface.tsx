"use client"

// Full Lines dashboard (not safe-mode placeholder).
// Anti-#185 (permanent): plain Switch (no Radix bubble/ResizeObserver), Latest Sheet
// mounts only when open, telemetry dialogs lazy-mount, single Latest card, no dock
// indicator, no useClientSnapshot seeds, toast subscribe-once, stats EMPTY fallback.
// Realtime hosts (intake popup) stay enabled in dashboard-shell.tsx.

import { memo, useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { Check, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { DashboardCallFlow, ActiveLineSubHeader } from "@/components/dashboard-call-flow"
import { DashboardRoutingSidebar } from "@/components/dashboard-routing-sidebar"
import { CallerIdUtilitiesCard } from "@/components/dashboard/caller-id-utilities-card"
import { PresenceStatusBar } from "@/components/dashboard/presence-status-bar"
import { RoutingTelemetryStrip } from "@/components/dashboard/routing-telemetry-strip"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useRealTimeStatsContextOptional } from "@/components/dashboard/real-time-stats-provider"
import { useMissedLeadInsights } from "@/lib/hooks/use-missed-lead-insights"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"
import {
  useFlickerBoxMeasure,
  useFlickerDebugLifecycle,
} from "@/lib/debug/flicker-debug"

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
  /** Full team roster for Busy → Available teammate primary. */
  teamReceptionists?: Contact[]
  /**
   * True once bootstrap/API has the authoritative receptionist list (may be empty).
   * False while only paint-seed stubs exist — Busy must not flash IVR LIVE.
   */
  teamRosterReady?: boolean
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
  setHoursSettingsOpen: (open: boolean) => void
  adminRoutingOverridePhone?: string | null
  /** Fires once after sticky chrome + call-flow structure commit layout (handoff, not data). */
  onLinesHandoffReady?: () => void
}

/** Call flow + setup checklist — isolated from sheet open state so drawers do not re-render this tree. */
export const DashboardRoutingSurface = memo(function DashboardRoutingSurface({
  quickSetupDecided,
  callFlowUiReady,
  isSetupComplete,
  hasBusinessNumbers,
  hasReceptionists,
  businessNumbers,
  routingBusinessNumber,
  setRoutingBusinessNumber,
  routingLineDetailLoading,
  isRoutingToOwner,
  selectedReceptionist,
  teamReceptionists = [],
  teamRosterReady = false,
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  autopilotMode,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  setHoursSettingsOpen,
  adminRoutingOverridePhone,
  onLinesHandoffReady,
}: DashboardRoutingSurfaceProps) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const activation = useDashboardActivationOptional()

  // Resolve the currently-selected line the same way the call-flow header does, so the sidebar's
  // active-line card always mirrors what the chart on the right is configuring.
  const activeLineRaw =
    routingBusinessNumber && businessNumbers.some((b) => businessNumbersMatch(b.number, routingBusinessNumber))
      ? routingBusinessNumber
      : businessNumbers[0]?.number ?? ""
  const activeLineDisplay = activeLineRaw ? formatPhoneDisplay(activeLineRaw) : null

  return (
    <DashboardRoutingSurfaceInner
      quickSetupDecided={quickSetupDecided}
      callFlowUiReady={callFlowUiReady}
      isSetupComplete={isSetupComplete}
      hasBusinessNumbers={hasBusinessNumbers}
      hasReceptionists={hasReceptionists}
      businessNumbers={businessNumbers}
      routingBusinessNumber={routingBusinessNumber}
      setRoutingBusinessNumber={setRoutingBusinessNumber}
      routingLineDetailLoading={routingLineDetailLoading}
      isRoutingToOwner={isRoutingToOwner}
      selectedReceptionist={selectedReceptionist}
      teamReceptionists={teamReceptionists}
      teamRosterReady={teamRosterReady}
      ownerPhoneDisplay={ownerPhoneDisplay}
      ringTimeoutSec={ringTimeoutSec}
      activeFallbackLabel={activeFallbackLabel}
      autopilotMode={autopilotMode}
      routingStrategy={routingStrategy}
      allowLyncrNetworkFallback={allowLyncrNetworkFallback}
      onConfigureStrategy={onConfigureStrategy}
      setDashboardStoryKey={setDashboardStoryKey}
      setWhoAnswersOpen={setWhoAnswersOpen}
      setRingBackupOpen={setRingBackupOpen}
      setShowFallbackSettings={setShowFallbackSettings}
      setHoursSettingsOpen={setHoursSettingsOpen}
      adminRoutingOverridePhone={adminRoutingOverridePhone}
      onLinesHandoffReady={onLinesHandoffReady}
      activeLineRaw={activeLineRaw}
      activeLineDisplay={activeLineDisplay}
      subscriptionActive={activation?.subscriptionActive === true}
      lineCarrierLive={activation?.lineCarrierLive === true}
      openBuyModal={openBuyModal}
      openManageModal={openManageModal}
    />
  )
})

/** Inner tree — live metrics come from shell-level RealTimeStatsProvider / LyncEngine. */
const DashboardRoutingSurfaceInner = memo(function DashboardRoutingSurfaceInner({
  quickSetupDecided,
  callFlowUiReady,
  isSetupComplete,
  hasBusinessNumbers,
  hasReceptionists,
  businessNumbers,
  routingBusinessNumber,
  setRoutingBusinessNumber,
  routingLineDetailLoading,
  isRoutingToOwner,
  selectedReceptionist,
  teamReceptionists = [],
  teamRosterReady = false,
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  autopilotMode,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  setHoursSettingsOpen,
  adminRoutingOverridePhone,
  onLinesHandoffReady,
  activeLineRaw,
  activeLineDisplay,
  subscriptionActive,
  lineCarrierLive,
  openBuyModal,
  openManageModal,
}: DashboardRoutingSurfaceProps & {
  activeLineRaw: string
  activeLineDisplay: string | null
  subscriptionActive: boolean
  lineCarrierLive: boolean
  openBuyModal: () => void
  openManageModal: () => void
}) {
  const realtimeStats = useRealTimeStatsContextOptional()
  const { activeOrganizationId } = useDashboardWorkspace()
  // Only hit /api/calls while Lines is the active tab — Activity owns the full log elsewhere.
  const linesActive = useDashboardActivePage() === "dashboard"
  const missedLeadInsights = useMissedLeadInsights(businessNumbers, linesActive)

  const stickyHeaderMode =
    businessNumbers.length > 0
      ? "active-line-subheader"
      : quickSetupDecided
        ? "active-line-subheader"
        : "blank-reserved"
  const stickyMeasureRef = useFlickerBoxMeasure("LinesStickyChrome", "lines-sticky-chrome")
  const handoffReadyFiredRef = useRef(false)

  // Children layout effects run first — sticky + DashboardCallFlow are committed before this.
  useLayoutEffect(() => {
    if (!onLinesHandoffReady || handoffReadyFiredRef.current) return
    handoffReadyFiredRef.current = true
    onLinesHandoffReady()
  }, [onLinesHandoffReady])

  useFlickerDebugLifecycle("DashboardRoutingSurface", {
    callFlowUiReady,
    quickSetupDecided,
    hasBusinessNumbers,
    businessNumberCount: businessNumbers.length,
    hasActiveLine: Boolean(activeLineRaw?.trim()),
    routingLineDetailLoading,
    stickyHeaderMode,
    stickyHeaderPresent: true,
    realSurfaceVisible: true,
    fallbackVisible: false,
    setupChecklistVisible: Boolean(quickSetupDecided && !isSetupComplete),
  })

  // Sticky Main Line status only — Available/Busy lives at the bottom with Caller ID.
  // Prefer real ActiveLineSubHeader once numbers exist OR setup decided (never opacity-0 blank when ready).
  const stickyChrome = (
    <div
      ref={stickyMeasureRef}
      data-flicker-probe="lines-sticky-chrome"
      className="sticky top-0 z-50 w-full bg-background"
    >
      {/* eslint-disable-next-line no-restricted-syntax -- min-h-[3.25rem] sticky chrome — py-2.5 is part of that fixed 52px geometry */}
      <div className="flex min-h-[3.25rem] w-full items-center justify-between border-b border-border/90 py-2.5">
        {businessNumbers.length > 0 || quickSetupDecided ? (
          <ActiveLineSubHeader
            bare
            businessNumbers={businessNumbers}
            activeLine={activeLineRaw}
            onSelect={(n) => setRoutingBusinessNumber(n)}
            subscriptionActive={subscriptionActive}
            lineCarrierLive={lineCarrierLive}
            routingStrategy={routingStrategy}
            activeCallCount={realtimeStats?.activeCallsOnSelectedLine ?? 0}
            loading={routingLineDetailLoading}
          />
        ) : (
          // Opaque chrome reserve — same geometry as Live & Connected, no opacity-0 pop-in.
          <div
            className="flex w-full min-w-0 items-center justify-between gap-3"
            aria-busy="true"
            aria-label="Loading line status"
            data-flicker-probe="lines-sticky-blank"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
                Main line
              </p>
              <p className="truncate text-sm font-semibold text-muted-foreground/80">—</p>
            </div>
            <p className="shrink-0 text-xs font-medium text-muted-foreground/70">Live &amp; Connected</p>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex w-full flex-col" data-flicker-probe="lines-routing-surface">
      {stickyChrome}

      {/* No pb-24 spacer — Available/Caller ID follow Alerts with normal gap (Messages left Lines). */}
      <div className="min-h-0 w-full overflow-x-clip overflow-y-visible pb-3 md:pb-4">
        <div className="mx-auto w-full max-w-workspace pt-3 sm:pt-4">
          <div className="flex flex-col gap-3 sm:gap-8 lg:flex-row lg:items-start lg:gap-10">
            <DashboardRoutingSidebar
              activeLineDisplay={activeLineDisplay}
              routingStrategy={routingStrategy}
              className="lg:sticky lg:top-4"
              onConfigureRouting={() => setWhoAnswersOpen(true)}
            />
            {/* Main column: setup / telemetry / (Who answers + Available stack). */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
              {quickSetupDecided && !isSetupComplete ? (
                <section className="w-full rounded-2xl border border-border/80 bg-card p-6 shadow-resting ring-1 ring-primary/10 sm:p-7">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12">
                      <Check className="h-4 w-4 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">Finish setup first</p>
                        <SheetInfoTrigger
                          onPress={() => setDashboardStoryKey("dashboard-quick-setup")}
                          label="About setup checklist"
                          className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
                        />
                      </div>
                      <div className="mt-5 flex flex-col gap-4 sm:gap-6">
                        <div
                          className={cn(
                            "flex flex-col gap-2 rounded-xl border bg-background/60 px-3 py-3",
                            hasBusinessNumbers ? "border-border/70" : "border-primary/40 ring-1 ring-primary/15"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">1 · Business number</span>
                            {hasBusinessNumbers ? (
                              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-semibold text-primary">
                                Done
                              </span>
                            ) : null}
                          </div>
                          {!hasBusinessNumbers ? (
                            <button
                              type="button"
                              onClick={openBuyModal}
                              className="inline-flex w-fit min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              + Add business number
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={openManageModal}
                              className="inline-flex w-fit items-center gap-1 text-2xs font-semibold text-primary hover:underline"
                            >
                              Manage numbers
                              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                        </div>

                        <div
                          className={cn(
                            "flex flex-col gap-2 rounded-xl border border-border/70 bg-background/60 px-3 py-2",
                            !hasBusinessNumbers && "opacity-55"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground">2 · Who answers</span>
                            {hasBusinessNumbers ? (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary">
                                Next
                              </span>
                            ) : null}
                          </div>
                          {hasBusinessNumbers ? (
                            <a href="#dash-call-flow" className="w-fit text-2xs font-semibold text-primary hover:underline">
                              Call flow
                            </a>
                          ) : null}
                        </div>

                        <div
                          className={cn(
                            "flex items-center justify-between rounded-xl border border-border/70 bg-background/60 px-3 py-2",
                            !hasBusinessNumbers && "opacity-55"
                          )}
                        >
                          <span className="text-xs font-medium text-foreground">3 · Team</span>
                          {hasReceptionists ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-semibold text-primary">
                              Added
                            </span>
                          ) : hasBusinessNumbers ? (
                            <Link href="/dashboard/contacts" className="text-2xs font-semibold text-primary hover:underline">
                              Team
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <RoutingTelemetryStrip
                businessNumbers={businessNumbers}
                uniqueMissedLeads={missedLeadInsights.uniqueLeadsToday}
                uniqueMissedLeadsReady={missedLeadInsights.ready}
              />

              {/*
                Who answers + Available must be direct flex siblings with gap-4 (~16px).
                Parent gap alone was easy to miss: CallFlow’s empty Alerts wrapper (mt-3 +
                :empty hide) sat between the cards in the box model, so Primary and Available
                looked flush. This inner column owns only that pair — no min-height / pb-24.
              */}
              <div className="flex flex-col gap-4">
                <DashboardCallFlow
                  businessNumbers={businessNumbers}
                  routingBusinessNumber={routingBusinessNumber}
                  setRoutingBusinessNumber={setRoutingBusinessNumber}
                  quickSetupDecided={quickSetupDecided}
                  callFlowUiReady={callFlowUiReady}
                  routingLineDetailLoading={routingLineDetailLoading}
                  isRoutingToOwner={isRoutingToOwner}
                  selectedReceptionist={selectedReceptionist}
                  teamReceptionists={teamReceptionists}
                  teamRosterReady={teamRosterReady}
                  ownerPhoneDisplay={ownerPhoneDisplay}
                  ringTimeoutSec={ringTimeoutSec}
                  activeFallbackLabel={activeFallbackLabel}
                  autopilotMode={autopilotMode}
                  routingStrategy={routingStrategy}
                  allowLyncrNetworkFallback={allowLyncrNetworkFallback}
                  onConfigureStrategy={onConfigureStrategy}
                  setDashboardStoryKey={setDashboardStoryKey}
                  setWhoAnswersOpen={setWhoAnswersOpen}
                  setRingBackupOpen={setRingBackupOpen}
                  setShowFallbackSettings={setShowFallbackSettings}
                  adminRoutingOverridePhone={adminRoutingOverridePhone}
                />

                {/* Available + Caller ID — sibling of CallFlow; gap-4 above is the visible space. */}
                <div className="flex flex-col gap-3 pb-2 xl:grid xl:grid-cols-2 xl:items-start">
                  <PresenceStatusBar onOpenHours={() => setHoursSettingsOpen(true)} />
                  <CallerIdUtilitiesCard
                    organizationId={activeOrganizationId}
                    onOpenTips={() => setDashboardStoryKey("dashboard-caller-id-tips")}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
