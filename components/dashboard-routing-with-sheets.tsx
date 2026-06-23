"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DashboardRoutingSurface, type DashboardRoutingSurfaceProps } from "@/components/dashboard-routing-surface"
import { DashboardRoutingSheets, type DashboardRoutingSheetsProps } from "@/components/dashboard-routing-sheets"
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

/** Owns drawer open state so toggling sheets does not re-render the call-flow surface. */
export function DashboardRoutingWithSheets(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [whoAnswersOpen, setWhoAnswersOpen] = useState(false)
  const [ringBackupOpen, setRingBackupOpen] = useState(false)
  const [showFallbackSettings, setShowFallbackSettings] = useState(false)
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false)
  const [dashboardStoryKey, setDashboardStoryKey] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get("ai") !== "1") return
    setShowFallbackSettings(true)
    router.replace("/dashboard", { scroll: false })
  }, [searchParams, router])

  const surfaceProps: DashboardRoutingSurfaceProps = {
    quickSetupDecided: props.quickSetupDecided,
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
      {strategyDialogOpen ? (
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
        whoAnswersOpen={whoAnswersOpen}
        setWhoAnswersOpen={setWhoAnswersOpen}
        ringBackupOpen={ringBackupOpen}
        setRingBackupOpen={setRingBackupOpen}
        showFallbackSettings={showFallbackSettings}
        setShowFallbackSettings={setShowFallbackSettings}
        dashboardStoryKey={dashboardStoryKey}
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
      />
    </>
  )
}
