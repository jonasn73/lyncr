"use client"

import { memo, useCallback, useRef } from "react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { VOICE_AI_DRAWER_SHEET_CLASS } from "@/components/dashboard-call-flow"
import { DashboardCallFlowConfigureDrawer } from "@/components/dashboard-call-flow-configure-drawer"
import { DashboardRingBackupDrawer } from "@/components/dashboard-ring-backup-drawer"
import type { Contact, DashboardBusinessNumber, FallbackOption } from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"

export type DashboardRoutingSheetsProps = {
  whoAnswersOpen: boolean
  setWhoAnswersOpen: (open: boolean) => void
  ringBackupOpen: boolean
  setRingBackupOpen: (open: boolean) => void
  showFallbackSettings: boolean
  setShowFallbackSettings: (open: boolean) => void
  hoursSettingsOpen: boolean
  setHoursSettingsOpen: (open: boolean) => void
  dashboardStoryKey: string | null
  setDashboardStoryKey: (key: string | null) => void
  receptionists: Contact[]
  selectedReceptionistId: string | null
  isRoutingToOwner: boolean
  ownerPhoneDisplay: string
  selectedReceptionist: Contact | null
  clearReceptionist: () => void
  selectReceptionist: (id: string) => void
  routingLineDetailLoading: boolean
  ringTimeoutSec: number
  setRingTimeoutSec: (n: number) => void
  inboundCallerGreetingEnabled: boolean
  setInboundCallerGreetingEnabled: (v: boolean) => void
  forwardOriginalCallerId: boolean
  setForwardOriginalCallerId: (v: boolean) => void
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  fallback: FallbackOption
  setFallback: (f: FallbackOption) => void
  aiRingOwnerFirst: boolean
  setAiRingOwnerFirst: (v: boolean) => void
  hasTelnyxAiAssistant: boolean
  setHasTelnyxAiAssistant: (v: boolean) => void
  businessNumbers: DashboardBusinessNumber[]
  routingBusinessNumber: string | null
  onChangeRoutingStrategy: () => void
  routingStrategy: RoutingStrategy
  setRoutingStrategy: (s: RoutingStrategy) => void
}

export const DashboardRoutingSheets = memo(function DashboardRoutingSheets({
  whoAnswersOpen,
  setWhoAnswersOpen,
  ringBackupOpen,
  setRingBackupOpen,
  showFallbackSettings,
  setShowFallbackSettings,
  hoursSettingsOpen,
  setHoursSettingsOpen,
  dashboardStoryKey,
  setDashboardStoryKey,
  ownerPhoneDisplay,
  routingLineDetailLoading,
  ringTimeoutSec,
  setRingTimeoutSec,
  inboundCallerGreetingEnabled,
  setInboundCallerGreetingEnabled,
  forwardOriginalCallerId,
  setForwardOriginalCallerId,
  saveRouting,
  fallback,
  setFallback,
  routingBusinessNumber,
  setRoutingStrategy,
}: DashboardRoutingSheetsProps) {
  const configureDiscardRef = useRef<() => void>(() => {})
  const ringBackupDiscardRef = useRef<() => void>(() => {})

  // Who Answers + Voice AI + Hours cards all open the same tabbed configure drawer.
  const configureOpen = whoAnswersOpen || showFallbackSettings || hoursSettingsOpen
  const configureInitialTab = hoursSettingsOpen
    ? ("hours" as const)
    : showFallbackSettings && !whoAnswersOpen
      ? ("greetings" as const)
      : ("routing" as const)

  const closeConfigure = useCallback(() => {
    setWhoAnswersOpen(false)
    setShowFallbackSettings(false)
    setHoursSettingsOpen(false)
  }, [setWhoAnswersOpen, setShowFallbackSettings, setHoursSettingsOpen])

  const handleConfigureOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        configureDiscardRef.current()
        closeConfigure()
      }
    },
    [closeConfigure]
  )

  const handleRingBackupOpenChange = useCallback(
    (open: boolean) => {
      if (!open) ringBackupDiscardRef.current()
      setRingBackupOpen(open)
    },
    [setRingBackupOpen]
  )

  return (
    <>
      {configureOpen ? (
        <Sheet open={configureOpen} onOpenChange={handleConfigureOpenChange} modal>
          <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
            {/* Visible heading lives in the child drawer — name the sheet for screen readers. */}
            <SheetTitle className="sr-only">Call flow settings</SheetTitle>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DashboardCallFlowConfigureDrawer
                ownerPhoneDisplay={ownerPhoneDisplay}
                routingBusinessNumber={routingBusinessNumber}
                routingLineDetailLoading={routingLineDetailLoading}
                initialTab={configureInitialTab}
                setRoutingStrategy={setRoutingStrategy}
                setFallback={setFallback}
                setRingTimeoutSec={setRingTimeoutSec}
                onClose={closeConfigure}
                onRegisterDiscard={(fn) => {
                  configureDiscardRef.current = fn
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {ringBackupOpen ? (
        <Sheet open={ringBackupOpen} onOpenChange={handleRingBackupOpenChange} modal>
          <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
            {/* Visible heading lives in the child drawer — name the sheet for screen readers. */}
            <SheetTitle className="sr-only">Ring and backup settings</SheetTitle>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DashboardRingBackupDrawer
                ringTimeoutSec={ringTimeoutSec}
                setRingTimeoutSec={setRingTimeoutSec}
                inboundCallerGreetingEnabled={inboundCallerGreetingEnabled}
                setInboundCallerGreetingEnabled={setInboundCallerGreetingEnabled}
                forwardOriginalCallerId={forwardOriginalCallerId}
                setForwardOriginalCallerId={setForwardOriginalCallerId}
                fallback={fallback}
                setFallback={setFallback}
                saveRouting={saveRouting}
                onClose={() => setRingBackupOpen(false)}
                onRegisterDiscard={(fn) => {
                  ringBackupDiscardRef.current = fn
                }}
                onOpenVoiceAi={() => {
                  setRingBackupOpen(false)
                  setShowFallbackSettings(true)
                }}
                routingBusinessNumber={routingBusinessNumber}
                routingLineDetailLoading={routingLineDetailLoading}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {dashboardStoryKey != null ? (
        <Sheet open onOpenChange={(open) => !open && setDashboardStoryKey(null)} modal>
          <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
            {/* Visible heading lives in the child drawer — name the sheet for screen readers. */}
            <SheetTitle className="sr-only">How this control works</SheetTitle>
            {dashboardStoryKey ? (
              (() => {
                const story = getAppSheetStory(dashboardStoryKey)
                if (!story) {
                  return (
                    <div className="p-6 text-sm text-muted-foreground">
                      No story is defined for this control yet.
                    </div>
                  )
                }
                return <StorySheetHeader {...story} />
              })()
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
})
