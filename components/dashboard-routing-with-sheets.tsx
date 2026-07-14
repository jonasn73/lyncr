"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { DashboardRoutingSurface, type DashboardRoutingSurfaceProps } from "@/components/dashboard-routing-surface"
import { DashboardRoutingSheets, type DashboardRoutingSheetsProps } from "@/components/dashboard-routing-sheets"
import { isSundayAutopilotActive } from "@/components/dashboard-call-flow"
import dynamic from "next/dynamic"
import type { RoutingStrategy } from "@/lib/types"

const RoutingStrategyDialog = dynamic(
  () => import("@/components/routing-strategy-dialog").then((m) => ({ default: m.RoutingStrategyDialog })),
  { ssr: false }
)

type Props = Omit<
  DashboardRoutingSurfaceProps,
  | "setWhoAnswersOpen"
  | "setRingBackupOpen"
  | "setShowFallbackSettings"
  | "setDashboardStoryKey"
  | "onConfigureStrategy"
> &
  Omit<
    DashboardRoutingSheetsProps,
    | "whoAnswersOpen"
    | "setWhoAnswersOpen"
    | "ringBackupOpen"
    | "setRingBackupOpen"
    | "showFallbackSettings"
    | "setShowFallbackSettings"
    | "dashboardStoryKey"
    | "setDashboardStoryKey"
    | "onChangeRoutingStrategy"
  > & {
    // Setters so the strategy dialog can push fresh values back into the dashboard canvas.
    setRoutingStrategy: (s: RoutingStrategy) => void
    setAllowLyncrNetworkFallback: (v: boolean) => void
  }

/** True only on the Routing tab URL (presence host keeps this tree mounted on other tabs). */
function isRoutingDashboardPath(pathname: string | null): boolean {
  if (!pathname) return false
  return pathname === "/dashboard" || pathname === "/dashboard/"
}

/** Owns drawer open state so toggling sheets does not re-render the call-flow surface. */
export function DashboardRoutingWithSheets(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [whoAnswersOpen, setWhoAnswersOpen] = useState(false)
  const [ringBackupOpen, setRingBackupOpen] = useState(false)
  const [showFallbackSettings, setShowFallbackSettings] = useState(false)
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false)
  const [dashboardStoryKey, setDashboardStoryKey] = useState<string | null>(null)

  // Presence host keeps Routing mounted with `hidden` — portaled sheets would linger unless we close them.
  useEffect(() => {
    if (isRoutingDashboardPath(pathname)) return
    setWhoAnswersOpen(false)
    setRingBackupOpen(false)
    setShowFallbackSettings(false)
    setStrategyDialogOpen(false)
    setDashboardStoryKey(null)
  }, [pathname])

  // Workspace switch should also dismiss configure drawers so overlays never block the header pill.
  useEffect(() => {
    const closeDrawers = () => {
      setWhoAnswersOpen(false)
      setRingBackupOpen(false)
      setShowFallbackSettings(false)
      setStrategyDialogOpen(false)
      setDashboardStoryKey(null)
    }
    window.addEventListener("lyncr-organization-changed", closeDrawers)
    return () => window.removeEventListener("lyncr-organization-changed", closeDrawers)
  }, [])

  // Also clear on unmount (e.g. leaving the dashboard shell entirely).
  useEffect(() => {
    return () => {
      setWhoAnswersOpen(false)
      setRingBackupOpen(false)
      setShowFallbackSettings(false)
      setStrategyDialogOpen(false)
      setDashboardStoryKey(null)
    }
  }, [])

  useEffect(() => {
    if (searchParams.get("ai") !== "1") return
    if (!isRoutingDashboardPath(pathname)) return
    setShowFallbackSettings(true)
    router.replace("/dashboard", { scroll: false })
  }, [searchParams, router, pathname])

  // Derive Sunday Autopilot from Voice AI fallback + rings-bypassed + Your phone primary.
  const autopilotMode = isSundayAutopilotActive({
    fallback: props.fallback,
    aiRingOwnerFirst: props.aiRingOwnerFirst,
    isRoutingToOwner: props.isRoutingToOwner,
  })

  const onRoutingTab = isRoutingDashboardPath(pathname)

  const surfaceProps: DashboardRoutingSurfaceProps = {
    quickSetupDecided: props.quickSetupDecided,
    callFlowUiReady: props.callFlowUiReady,
    isSetupComplete: props.isSetupComplete,
    hasBusinessNumbers: props.hasBusinessNumbers,
    hasReceptionists: props.hasReceptionists,
    businessNumbers: props.businessNumbers,
    routingBusinessNumber: props.routingBusinessNumber,
    setRoutingBusinessNumber: props.setRoutingBusinessNumber,
    routingLineDetailLoading: props.routingLineDetailLoading,
    isRoutingToOwner: props.isRoutingToOwner,
    selectedReceptionist: props.selectedReceptionist,
    ownerPhoneDisplay: props.ownerPhoneDisplay,
    ringTimeoutSec: props.ringTimeoutSec,
    activeFallbackLabel: props.activeFallbackLabel,
    autopilotMode,
    routingStrategy: props.routingStrategy,
    allowLyncrNetworkFallback: props.allowLyncrNetworkFallback,
    onConfigureStrategy: () => setStrategyDialogOpen(true),
    setDashboardStoryKey,
    setWhoAnswersOpen,
    setRingBackupOpen,
    setShowFallbackSettings,
    adminRoutingOverridePhone: props.adminRoutingOverridePhone,
  }

  return (
    <>
      <DashboardRoutingSurface {...surfaceProps} />
      {strategyDialogOpen && onRoutingTab ? (
        <RoutingStrategyDialog
          open={strategyDialogOpen}
          onOpenChange={setStrategyDialogOpen}
          businessNumber={props.routingBusinessNumber}
          initialStrategy={props.routingStrategy}
          initialAllowFallback={props.allowLyncrNetworkFallback}
          onSaved={(data) => {
            props.setRoutingStrategy(data.routing_strategy)
            props.setAllowLyncrNetworkFallback(data.allow_lyncr_network_fallback)
          }}
        />
      ) : null}
      <DashboardRoutingSheets
        whoAnswersOpen={whoAnswersOpen && onRoutingTab}
        setWhoAnswersOpen={setWhoAnswersOpen}
        ringBackupOpen={ringBackupOpen && onRoutingTab}
        setRingBackupOpen={setRingBackupOpen}
        showFallbackSettings={showFallbackSettings && onRoutingTab}
        setShowFallbackSettings={setShowFallbackSettings}
        dashboardStoryKey={onRoutingTab ? dashboardStoryKey : null}
        setDashboardStoryKey={setDashboardStoryKey}
        receptionists={props.receptionists}
        selectedReceptionistId={props.selectedReceptionistId}
        isRoutingToOwner={props.isRoutingToOwner}
        ownerPhoneDisplay={props.ownerPhoneDisplay}
        selectedReceptionist={props.selectedReceptionist}
        clearReceptionist={props.clearReceptionist}
        selectReceptionist={props.selectReceptionist}
        routingLineDetailLoading={props.routingLineDetailLoading}
        ringTimeoutSec={props.ringTimeoutSec}
        setRingTimeoutSec={props.setRingTimeoutSec}
        inboundCallerGreetingEnabled={props.inboundCallerGreetingEnabled}
        setInboundCallerGreetingEnabled={props.setInboundCallerGreetingEnabled}
        forwardOriginalCallerId={props.forwardOriginalCallerId}
        setForwardOriginalCallerId={props.setForwardOriginalCallerId}
        saveRouting={props.saveRouting}
        fallback={props.fallback}
        setFallback={props.setFallback}
        aiRingOwnerFirst={props.aiRingOwnerFirst}
        setAiRingOwnerFirst={props.setAiRingOwnerFirst}
        hasTelnyxAiAssistant={props.hasTelnyxAiAssistant}
        setHasTelnyxAiAssistant={props.setHasTelnyxAiAssistant}
        businessNumbers={props.businessNumbers}
        routingBusinessNumber={props.routingBusinessNumber}
        onChangeRoutingStrategy={() => setStrategyDialogOpen(true)}
        routingStrategy={props.routingStrategy}
        setRoutingStrategy={props.setRoutingStrategy}
        organizationId={props.organizationId}
      />
    </>
  )
}
