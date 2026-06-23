"use client"

import { memo, useCallback, useRef } from "react"
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { VOICE_AI_DRAWER_SHEET_CLASS } from "@/components/dashboard-call-flow"
import { DashboardVoiceAiDrawer } from "@/components/dashboard-voice-ai-drawer"
import { DashboardWhoAnswersDrawer } from "@/components/dashboard-who-answers-drawer"
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
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  fallback: FallbackOption
  setFallback: (f: FallbackOption) => void
  aiRingOwnerFirst: boolean
  setAiRingOwnerFirst: (v: boolean) => void
  hasTelnyxAiAssistant: boolean
  setHasTelnyxAiAssistant: (v: boolean) => void
  businessNumbers: DashboardBusinessNumber[]
  routingBusinessNumber: string | null
  // Opens the hybrid routing-strategy dialog from inside the Who answers drawer.
  onChangeRoutingStrategy: () => void
  // Current hybrid-network strategy + setter so the Who answers drawer can offer the operator pool.
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
  dashboardStoryKey,
  setDashboardStoryKey,
  receptionists,
  selectedReceptionistId,
  isRoutingToOwner,
  ownerPhoneDisplay,
  selectedReceptionist,
  clearReceptionist: _clearReceptionist,
  selectReceptionist: _selectReceptionist,
  routingLineDetailLoading,
  ringTimeoutSec,
  setRingTimeoutSec,
  saveRouting,
  fallback,
  setFallback,
  aiRingOwnerFirst,
  setAiRingOwnerFirst,
  hasTelnyxAiAssistant,
  setHasTelnyxAiAssistant,
  businessNumbers,
  routingBusinessNumber,
  onChangeRoutingStrategy,
  routingStrategy,
  setRoutingStrategy,
}: DashboardRoutingSheetsProps) {
  const whoAnswersDiscardRef = useRef<() => void>(() => {})
  const ringBackupDiscardRef = useRef<() => void>(() => {})
  const voiceAiDiscardRef = useRef<() => void>(() => {})

  const handleWhoAnswersOpenChange = useCallback(
    (open: boolean) => {
      if (!open) whoAnswersDiscardRef.current()
      setWhoAnswersOpen(open)
    },
    [setWhoAnswersOpen]
  )

  const handleRingBackupOpenChange = useCallback(
    (open: boolean) => {
      if (!open) ringBackupDiscardRef.current()
      setRingBackupOpen(open)
    },
    [setRingBackupOpen]
  )

  const handleVoiceAiOpenChange = useCallback(
    (open: boolean) => {
      if (!open) voiceAiDiscardRef.current()
      setShowFallbackSettings(open)
    },
    [setShowFallbackSettings]
  )

  return (
    <>
      <section
        id="routing-tips"
        className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-muted/15 px-6 py-5 sm:px-7"
      >
        <h2 className="text-sm font-semibold text-foreground sm:text-base">Caller ID</h2>
        <SheetInfoTrigger
          onPress={() => setDashboardStoryKey("dashboard-caller-id-tips")}
          label="Caller ID"
          className="h-8 w-8 shrink-0"
        />
      </section>

      {whoAnswersOpen ? (
      <Sheet open={whoAnswersOpen} onOpenChange={handleWhoAnswersOpenChange} modal>
        <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardWhoAnswersDrawer
              receptionists={receptionists}
              selectedReceptionistId={selectedReceptionistId}
              ownerPhoneDisplay={ownerPhoneDisplay}
              saveRouting={saveRouting}
              onClose={() => setWhoAnswersOpen(false)}
              onRegisterDiscard={(fn) => {
                whoAnswersDiscardRef.current = fn
              }}
              routingBusinessNumber={routingBusinessNumber}
              routingLineDetailLoading={routingLineDetailLoading}
              onChangeRoutingStrategy={onChangeRoutingStrategy}
              routingStrategy={routingStrategy}
              setRoutingStrategy={setRoutingStrategy}
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

      {showFallbackSettings ? (
      <Sheet open={showFallbackSettings} onOpenChange={handleVoiceAiOpenChange} modal>
        <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardVoiceAiDrawer
              fallback={fallback}
              setFallback={setFallback}
              aiRingOwnerFirst={aiRingOwnerFirst}
              setAiRingOwnerFirst={setAiRingOwnerFirst}
              saveRouting={saveRouting}
              onClose={() => setShowFallbackSettings(false)}
              onRegisterDiscard={(fn) => {
                voiceAiDiscardRef.current = fn
              }}
              onHasAssistantChange={(active) => setHasTelnyxAiAssistant(active)}
              isRoutingToOwner={isRoutingToOwner}
              selectedReceptionist={selectedReceptionist}
              routingBusinessNumber={routingBusinessNumber}
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
              return (
                <>
                  <StorySheetHeader {...story} />
                </>
              )
            })()
          ) : null}
        </SheetContent>
      </Sheet>
      ) : null}
    </>
  )
})
