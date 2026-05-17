"use client"

import { memo } from "react"
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
}: DashboardRoutingSheetsProps) {
  return (
    <>
      {/* In-page follow-up after the call-flow cards (parent renders this block right under that section). */}
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

      <Sheet open={whoAnswersOpen} onOpenChange={setWhoAnswersOpen} modal>
        <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardWhoAnswersDrawer
              receptionists={receptionists}
              selectedReceptionistId={selectedReceptionistId}
              ownerPhoneDisplay={ownerPhoneDisplay}
              saveRouting={saveRouting}
              onClose={() => setWhoAnswersOpen(false)}
              routingBusinessNumber={routingBusinessNumber}
              routingLineDetailLoading={routingLineDetailLoading}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={ringBackupOpen} onOpenChange={setRingBackupOpen} modal>
        <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardRingBackupDrawer
              ringTimeoutSec={ringTimeoutSec}
              setRingTimeoutSec={setRingTimeoutSec}
              fallback={fallback}
              setFallback={setFallback}
              saveRouting={saveRouting}
              onClose={() => setRingBackupOpen(false)}
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

      <Sheet open={showFallbackSettings} onOpenChange={setShowFallbackSettings} modal>
        <SheetContent side="right" variant="drawer" className={VOICE_AI_DRAWER_SHEET_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardVoiceAiDrawer
              fallback={fallback}
              setFallback={setFallback}
              aiRingOwnerFirst={aiRingOwnerFirst}
              setAiRingOwnerFirst={setAiRingOwnerFirst}
              saveRouting={saveRouting}
              onClose={() => setShowFallbackSettings(false)}
              onHasAssistantChange={(active) => setHasTelnyxAiAssistant(active)}
              isRoutingToOwner={isRoutingToOwner}
              selectedReceptionist={selectedReceptionist}
              routingBusinessNumber={routingBusinessNumber}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={dashboardStoryKey != null} onOpenChange={(open) => !open && setDashboardStoryKey(null)} modal>
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
    </>
  )
})
