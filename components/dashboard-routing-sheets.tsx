"use client"

import { memo, useCallback, useRef } from "react"
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { VOICE_AI_DRAWER_SHEET_CLASS } from "@/components/dashboard-call-flow"
import { DashboardCallFlowConfigureDrawer } from "@/components/dashboard-call-flow-configure-drawer"
import { DashboardRingBackupDrawer } from "@/components/dashboard-ring-backup-drawer"
import { CallerIdUtilitiesCard } from "@/components/dashboard/caller-id-utilities-card"
import type { Contact, DashboardBusinessNumber, FallbackOption } from "@/lib/dashboard-routing-utils"
import type { RoutingStrategy } from "@/lib/types"

export type DashboardRoutingSheetsProps = {
  whoAnswersOpen: boolean
  setWhoAnswersOpen: (open: boolean) => void
  ringBackupOpen: boolean
  setRingBackupOpen: (open: boolean) => void
  showFallbackSettings: boolean
  setShowFallbackSettings: (open: boolean) => void
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
  organizationId?: string | null
}

export const DashboardRoutingSheets = memo(function DashboardRoutingSheets({
  whoAnswersOpen,
  setWhoAnswersOpen,
  ringBackupOpen,
  setRingBackupOpen,
  showFallbackSettings,
  setShowFallbackSettings,
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
  organizationId,
}: DashboardRoutingSheetsProps) {
  const configureDiscardRef = useRef<() => void>(() => {})
  const ringBackupDiscardRef = useRef<() => void>(() => {})

  // Who Answers + Voice AI cards both open the same tabbed configure drawer.
  const configureOpen = whoAnswersOpen || showFallbackSettings
  const configureInitialTab =
    showFallbackSettings && !whoAnswersOpen ? ("greetings" as const) : ("routing" as const)

  const closeConfigure = useCallback(() => {
    setWhoAnswersOpen(false)
    setShowFallbackSettings(false)
  }, [setWhoAnswersOpen, setShowFallbackSettings])

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
      <CallerIdUtilitiesCard
        organizationId={organizationId}
        onOpenTips={() => setDashboardStoryKey("dashboard-caller-id-tips")}
      />

      {configureOpen ? (
        <Sheet open={configureOpen} onOpenChange={handleConfigureOpenChange} modal>
          <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
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
