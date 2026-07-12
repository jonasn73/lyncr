"use client"

import { memo } from "react"
import Link from "next/link"
import { Check, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { DashboardCallFlow, ActiveLineSubHeader } from "@/components/dashboard-call-flow"
import { DashboardRoutingSidebar } from "@/components/dashboard-routing-sidebar"
import { RoutingTelemetryStrip } from "@/components/dashboard/routing-telemetry-strip"
import { RealTimeStatsProvider } from "@/components/dashboard/real-time-stats-provider"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useRealTimeStatsContextOptional } from "@/components/dashboard/real-time-stats-provider"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"

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
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  adminRoutingOverridePhone,
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
    <RealTimeStatsProvider businessNumbers={businessNumbers} activeLineE164={activeLineRaw || null}>
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
      ownerPhoneDisplay={ownerPhoneDisplay}
      ringTimeoutSec={ringTimeoutSec}
      activeFallbackLabel={activeFallbackLabel}
      routingStrategy={routingStrategy}
      allowLyncrNetworkFallback={allowLyncrNetworkFallback}
      onConfigureStrategy={onConfigureStrategy}
      setDashboardStoryKey={setDashboardStoryKey}
      setWhoAnswersOpen={setWhoAnswersOpen}
      setRingBackupOpen={setRingBackupOpen}
      setShowFallbackSettings={setShowFallbackSettings}
      adminRoutingOverridePhone={adminRoutingOverridePhone}
      activeLineRaw={activeLineRaw}
      activeLineDisplay={activeLineDisplay}
      subscriptionActive={activation?.subscriptionActive === true}
      lineCarrierLive={activation?.lineCarrierLive === true}
      openBuyModal={openBuyModal}
      openManageModal={openManageModal}
    />
    </RealTimeStatsProvider>
  )
})

/** Inner tree sits under RealTimeStatsProvider so the line sub-header can read live call counts. */
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
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  adminRoutingOverridePhone,
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

  // Sticky tracking line sits under the global team-selector header; canvas body scrolls beneath it.
  const trackingLine = callFlowUiReady ? (
    <div
      className={cn(
        // Cancel DashboardPageView padding so the bar sits flush under the team selector.
        // AppShell scrolls inside <main> (header is a sibling), so top-0 == under the ~56px header.
        "-mx-4 -mt-4 sm:-mx-8 sm:-mt-8",
        "sticky top-0 z-30 w-full bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-4 py-3 flex items-center justify-between"
      )}
    >
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
    </div>
  ) : null

  return (
    <div className="w-full">
      {trackingLine}

      {/* pt-4 keeps metric cards clear of the sticky tracking line on mount / scroll. */}
      <div className="mx-auto w-full max-w-7xl pt-4">
        <div className="flex flex-col gap-6 sm:gap-8 lg:flex-row lg:items-start lg:gap-10">
          <DashboardRoutingSidebar
            activeLineDisplay={activeLineDisplay}
            routingStrategy={routingStrategy}
            className="lg:sticky lg:top-36"
            onConfigureRouting={() => setWhoAnswersOpen(true)}
          />
          <div className="min-w-0 flex-1 space-y-3 sm:space-y-6 lg:space-y-10">
            {quickSetupDecided && !isSetupComplete ? (
              <section className="w-full rounded-2xl border border-border/80 bg-card p-6 shadow-sm ring-1 ring-primary/10 sm:p-7">
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
                        className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
                      />
                    </div>
                    <div className="mt-5 flex flex-col gap-4 sm:gap-5">
                      <div
                        className={cn(
                          "flex flex-col gap-2 rounded-xl border bg-background/60 px-3 py-2.5",
                          hasBusinessNumbers ? "border-border/70" : "border-primary/40 ring-1 ring-primary/15"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">1 · Business number</span>
                          {hasBusinessNumbers ? (
                            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
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
                            className="inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                          >
                            Manage numbers
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </div>

                      <div
                        className={cn(
                          "flex flex-col gap-1.5 rounded-xl border border-border/70 bg-background/60 px-3 py-2",
                          !hasBusinessNumbers && "opacity-55"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">2 · Who answers</span>
                          {hasBusinessNumbers ? (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              Next
                            </span>
                          ) : null}
                        </div>
                        {hasBusinessNumbers ? (
                          <a href="#dash-call-flow" className="w-fit text-[11px] font-semibold text-primary hover:underline">
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
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            Added
                          </span>
                        ) : hasBusinessNumbers ? (
                          <Link href="/dashboard/contacts" className="text-[11px] font-semibold text-primary hover:underline">
                            Team
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <RoutingTelemetryStrip businessNumbers={businessNumbers} />

            <DashboardCallFlow
              businessNumbers={businessNumbers}
              routingBusinessNumber={routingBusinessNumber}
              setRoutingBusinessNumber={setRoutingBusinessNumber}
              quickSetupDecided={quickSetupDecided}
              callFlowUiReady={callFlowUiReady}
              routingLineDetailLoading={routingLineDetailLoading}
              isRoutingToOwner={isRoutingToOwner}
              selectedReceptionist={selectedReceptionist}
              ownerPhoneDisplay={ownerPhoneDisplay}
              ringTimeoutSec={ringTimeoutSec}
              activeFallbackLabel={activeFallbackLabel}
              routingStrategy={routingStrategy}
              allowLyncrNetworkFallback={allowLyncrNetworkFallback}
              onConfigureStrategy={onConfigureStrategy}
              setDashboardStoryKey={setDashboardStoryKey}
              setWhoAnswersOpen={setWhoAnswersOpen}
              setRingBackupOpen={setRingBackupOpen}
              setShowFallbackSettings={setShowFallbackSettings}
              adminRoutingOverridePhone={adminRoutingOverridePhone}
            />
          </div>
        </div>
      </div>
    </div>
  )
})
