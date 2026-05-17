"use client"

import { memo, type ReactNode } from "react"
import Link from "next/link"
import { User, Check, ChevronRight, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { StoryPopoverInfo } from "@/components/story-popover-info"
import {
  DASHBOARD_RING_TIMEOUT_CHOICES,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
  type FallbackOption,
} from "@/lib/dashboard-routing-utils"
import { fallbackOptions } from "@/components/dashboard-routing-fallback-options"
import { SITE_NAME } from "@/lib/brand"
import { ROUTING_DRAWER_SHEET_CLASS, VOICE_AI_DRAWER_SHEET_CLASS } from "@/components/dashboard-call-flow"
import { DashboardVoiceAiDrawer } from "@/components/dashboard-voice-ai-drawer"

const RoutingCallPathSheetHeader = memo(function RoutingCallPathSheetHeader({
  step,
  title,
  description,
}: {
  step: 1 | 2 | 3
  title: string
  description: ReactNode
}) {
  return (
    <SheetHeader className="relative shrink-0 space-y-0 border-b border-primary/25 bg-gradient-to-br from-primary/[0.14] via-card to-card px-6 pb-5 pt-6 text-left">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Step {step} of 3</p>
      <div className="mt-3 flex gap-1" aria-hidden>
        {([1, 2, 3] as const).map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-[background-color,box-shadow] duration-200",
              n <= step ? "bg-primary shadow-[0_0_10px_-2px_var(--primary)]" : "bg-muted/70"
            )}
          />
        ))}
      </div>
      <SheetTitle className="mt-4 text-left text-xl font-semibold tracking-tight text-foreground">{title}</SheetTitle>
      <SheetDescription className="mt-2 text-left text-sm leading-relaxed text-muted-foreground">
        {description}
      </SheetDescription>
    </SheetHeader>
  )
})

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
  clearReceptionist,
  selectReceptionist,
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
        <SheetContent side="right" className={ROUTING_DRAWER_SHEET_CLASS}>
          <RoutingCallPathSheetHeader
            step={1}
            title="Who answers first?"
            description={
              <>
                Choose where this business line rings. Add people on{" "}
                <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                  Team
                </Link>
                , then pick them here (per line if you have more than one number).
              </>
            }
          />
          <div className="flex justify-end border-b border-border/60 px-3 py-1">
            <StoryPopoverInfo storyKey="dashboard-sheet-who-answers" label="More about who answers first" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 pt-2">
              <div
                className={cn(
                  "flex w-full flex-col gap-2",
                  routingLineDetailLoading && "pointer-events-none opacity-50"
                )}
                role="radiogroup"
                aria-label="Who answers calls to this business line"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={isRoutingToOwner}
                  onClick={() => {
                    clearReceptionist()
                    setWhoAnswersOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    isRoutingToOwner
                      ? "border-primary bg-primary/8 ring-2 ring-primary/35"
                      : "border-border bg-card hover:bg-secondary"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isRoutingToOwner ? "bg-foreground/15" : "bg-muted-foreground/15"
                    )}
                  >
                    <User className="h-5 w-5 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Your phone</p>
                    <p className="text-[11px] text-muted-foreground">{ownerPhoneDisplay}</p>
                  </div>
                  {isRoutingToOwner ? (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3.5 w-3.5 text-primary-foreground" />
                    </div>
                  ) : null}
                </button>

                {receptionists.map((contact) => {
                  const picked = contact.id === selectedReceptionistId
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => {
                        selectReceptionist(contact.id)
                        setWhoAnswersOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                        picked
                          ? "border-primary bg-primary/8 ring-2 ring-primary/35"
                          : "border-border bg-card hover:bg-secondary"
                      )}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className={cn(contact.color, "text-primary-foreground text-xs font-semibold")}>
                          {contact.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-semibold", picked ? "text-primary" : "text-foreground")}>
                          {contact.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(contact.phone)}</p>
                      </div>
                      {picked ? (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3.5 w-3.5 text-primary-foreground" />
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {receptionists.length === 0 ? (
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  No team members yet — open{" "}
                  <Link href="/dashboard/contacts" className="font-semibold text-primary underline underline-offset-2">
                    Team
                  </Link>{" "}
                  to add someone you can route calls to.
                </p>
              ) : null}
            </div>
            <SheetFooter className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border/70 bg-gradient-to-t from-secondary/30 to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] font-medium text-muted-foreground">Part 1 of 3 · same call story</p>
              <button
                type="button"
                onClick={() => {
                  setWhoAnswersOpen(false)
                  setRingBackupOpen(true)
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
              >
                Next: ring time &amp; backup
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={ringBackupOpen} onOpenChange={setRingBackupOpen} modal>
        <SheetContent side="right" className={ROUTING_DRAWER_SHEET_CLASS}>
          <RoutingCallPathSheetHeader
            step={2}
            title="Ring time & backup"
            description="How long the first target rings, then what happens if nobody answers — so callers are never left hanging."
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-2 pt-3",
                routingLineDetailLoading && "pointer-events-none opacity-50"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="sigo-dash-ring-sec" className="text-[11px] text-muted-foreground">
                    Max ring time (first target)
                  </label>
                  <StoryPopoverInfo storyKey="dashboard-ring-timeout-deep" label="Explain max ring time" triggerClassName="h-7 w-7" />
                </div>
                <select
                  id="sigo-dash-ring-sec"
                  className="mt-1.5 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  value={ringTimeoutSec}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!Number.isFinite(v)) return
                    setRingTimeoutSec(v)
                    void saveRouting({ ring_timeout_seconds: v })
                  }}
                >
                  {[...DASHBOARD_RING_TIMEOUT_CHOICES].map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                  This does <span className="font-medium text-foreground">not</span> add a delay before ringing starts — Telnyx rings your team (or you) right away. It is only how many seconds to wait for someone to{" "}
                  <span className="font-medium text-foreground">answer</span> before {SITE_NAME} runs your backup (voicemail, AI, or second number). Lower = faster switch to backup if nobody picks up.
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-foreground">If no answer</p>
                  <StoryPopoverInfo storyKey="dashboard-no-answer-backup" label="Explain if no answer options" triggerClassName="h-7 w-7" />
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="No-answer backup">
                  {fallbackOptions.map((opt) => {
                    const active = fallback === opt.id
                    const storyKey =
                      opt.id === "owner"
                        ? "dashboard-fallback-owner"
                        : opt.id === "ai"
                          ? "dashboard-fallback-ai"
                          : "dashboard-fallback-voicemail"
                    return (
                      <div key={opt.id} className="flex items-stretch gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFallback(opt.id)
                            void saveRouting({ fallback_type: opt.id })
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                            active
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border/80 bg-card text-foreground hover:bg-secondary"
                          )}
                        >
                          {opt.label}
                        </button>
                        <StoryPopoverInfo storyKey={storyKey} label={`About ${opt.label}`} triggerClassName="h-8 w-8 rounded-full" />
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRingBackupOpen(false)
                    setShowFallbackSettings(true)
                  }}
                  className="mt-4 w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 py-2.5 text-center text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
                >
                  Open full voice &amp; AI settings (part 3) →
                </button>
              </div>
            </div>
            <SheetFooter className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border/70 bg-gradient-to-t from-secondary/30 to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setRingBackupOpen(false)
                  setWhoAnswersOpen(true)
                }}
                className="text-left text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                ← Back to who answers
              </button>
              <button
                type="button"
                onClick={() => {
                  setRingBackupOpen(false)
                  setShowFallbackSettings(true)
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
              >
                Next: voice &amp; greetings
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </SheetFooter>
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
        <SheetContent side="right" className={ROUTING_DRAWER_SHEET_CLASS}>
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
