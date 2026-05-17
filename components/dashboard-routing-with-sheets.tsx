"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DashboardRoutingSurface, type DashboardRoutingSurfaceProps } from "@/components/dashboard-routing-surface"
import { DashboardRoutingSheets, type DashboardRoutingSheetsProps } from "@/components/dashboard-routing-sheets"

type Props = Omit<
  DashboardRoutingSurfaceProps,
  "setWhoAnswersOpen" | "setRingBackupOpen" | "setShowFallbackSettings" | "setDashboardStoryKey"
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
  >

/** Owns drawer open state so toggling sheets does not re-render the call-flow surface. */
export function DashboardRoutingWithSheets(props: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [whoAnswersOpen, setWhoAnswersOpen] = useState(false)
  const [ringBackupOpen, setRingBackupOpen] = useState(false)
  const [showFallbackSettings, setShowFallbackSettings] = useState(false)
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
    setDashboardStoryKey,
    setWhoAnswersOpen,
    setRingBackupOpen,
    setShowFallbackSettings,
  }

  return (
  <>
      <DashboardRoutingSurface {...surfaceProps} />
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
      />
    </>
  )
}
