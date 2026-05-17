"use client"

import { memo } from "react"
import Link from "next/link"
import {
  Sheet,
  SheetContent,
  SheetFooter,
} from "@/components/ui/sheet"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { SITE_NAME } from "@/lib/brand"
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
      <section id="routing-tips" className="rounded-2xl border border-border/60 bg-muted/15 px-6 py-6 sm:px-7 sm:py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">After your flow · Optional</p>
            <h2 className="mt-1.5 text-sm font-semibold text-foreground sm:text-base">Caller ID and spam labels</h2>
          </div>
          <SheetInfoTrigger
            onPress={() => setDashboardStoryKey("dashboard-caller-id-tips")}
            label="About caller ID and spam labels"
            className="h-8 w-8 shrink-0"
          />
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-zinc-500 sm:text-[13px]">
          Forwarded legs use your {SITE_NAME} business number. We also send your line label as the outbound display name when
          your carrier supports it, so the person answering may see a name instead of only digits. Labels like spam
          risk are added by the receiving carrier from their own analytics; improving reputation usually means setting
          CNAM on the number in Telnyx, registering it with services such as the Free Caller Registry, then carrying
          normal traffic for a few days.
        </p>
        <p className="mt-3 max-w-3xl text-xs text-zinc-400 sm:text-[13px]">
          Give each number a clear line label in{" "}
          <Link href="/dashboard/settings#business-numbers" className="font-semibold text-primary underline underline-offset-2">
            Settings
          </Link>{" "}
          — that label is what your team hears in the whisper (not your account business name).
        </p>
      </section>

      <Sheet open={whoAnswersOpen} onOpenChange={setWhoAnswersOpen} modal>
        <SheetContent side="right" className={VOICE_AI_DRAWER_SHEET_CLASS}>
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
        <SheetContent side="right" className={VOICE_AI_DRAWER_SHEET_CLASS}>
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
        <SheetContent side="right" className={VOICE_AI_DRAWER_SHEET_CLASS}>
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
        <SheetContent side="right" className={VOICE_AI_DRAWER_SHEET_CLASS}>
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
                  <div className="border-t border-border/60 px-4 py-3">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Change routing on the cards above, or open{" "}
                      <Link href="/dashboard/settings" className="font-medium text-primary underline-offset-4 hover:underline">
                        Settings
                      </Link>{" "}
                      for numbers and whispers.
                    </p>
                  </div>
                  <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                    <p className="text-[11px] text-muted-foreground">
                      (i) inside open panels opens a compact popover so you can read help without closing your place in the flow.
                    </p>
                  </SheetFooter>
                </>
              )
            })()
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
})
