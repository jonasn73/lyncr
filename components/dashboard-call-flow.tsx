"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import {
  PhoneForwarded,
  Loader2,
  ChevronDown,
  Smartphone,
  Hourglass,
  AudioWaveform,
  Settings2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { DRAWER_SHEET_GPU } from "@/lib/workspace-sheet-classes"

export const ROUTING_DRAWER_SHEET_CLASS =
  "gap-0 flex h-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl [&>button]:top-5 [&>button]:right-5 " +
  DRAWER_SHEET_GPU

export const VOICE_AI_DRAWER_SHEET_CLASS =
  "gap-0 flex h-full flex-col p-0 sm:max-w-lg md:max-w-xl lg:max-w-2xl [&>button]:top-5 [&>button]:right-5 " +
  DRAWER_SHEET_GPU

function FlowConnector() {
  return (
    <div
      className="hidden min-w-[2.5rem] shrink-0 items-center justify-center px-1 sm:flex md:min-w-[3.5rem]"
      aria-hidden
    >
      <div className="relative flex w-full max-w-[4rem] items-center">
        <div className="h-[2px] w-full rounded-full bg-gradient-to-r from-primary/20 via-primary to-primary/20 shadow-[0_0_12px_-2px_var(--primary)]" />
        <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-primary" />
      </div>
    </div>
  )
}

function FlowStepCard({
  step,
  title,
  icon: Icon,
  value,
  detail,
  onOpen,
  loading,
}: {
  step: string
  title: string
  icon: LucideIcon
  value: string
  detail: string
  onOpen: () => void
  loading?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={loading}
      className={cn(
        "group relative flex min-h-[12.5rem] min-w-0 flex-1 flex-col rounded-2xl border border-border/70 bg-gradient-to-b from-card to-background/80 p-5 text-left shadow-sm transition-all duration-200",
        "hover:border-primary/45 hover:shadow-[0_0_32px_-12px_var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        loading && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 shadow-[0_0_20px_-6px_var(--primary)]">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary/80">Step {step}</span>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-lg font-semibold leading-tight text-foreground sm:text-xl">{value}</p>
        <p className="text-xs leading-snug text-muted-foreground">{detail}</p>
      </div>
      <span className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-border/70 bg-transparent px-4 py-2.5 text-xs font-semibold text-muted-foreground transition-all duration-200 group-hover:border-primary/50 group-hover:bg-primary/10 group-hover:text-primary">
        Configure
      </span>
    </button>
  )
}

export type DashboardCallFlowProps = {
  businessNumbers: DashboardBusinessNumber[]
  routingBusinessNumber: string | null
  setRoutingBusinessNumber: (n: string) => void
  quickSetupDecided: boolean
  routingLineDetailLoading: boolean
  isRoutingToOwner: boolean
  selectedReceptionist: Contact | null
  ownerPhoneDisplay: string
  ringTimeoutSec: number
  activeFallbackLabel: string
  setDashboardStoryKey: (key: string | null) => void
  setWhoAnswersOpen: (v: boolean) => void
  setRingBackupOpen: (v: boolean) => void
  setShowFallbackSettings: (v: boolean) => void
}

export function DashboardCallFlow({
  businessNumbers,
  routingBusinessNumber,
  setRoutingBusinessNumber,
  quickSetupDecided,
  routingLineDetailLoading,
  isRoutingToOwner,
  selectedReceptionist,
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
}: DashboardCallFlowProps) {
  const activeLine =
    routingBusinessNumber && businessNumbers.some((b) => businessNumbersMatch(b.number, routingBusinessNumber))
      ? routingBusinessNumber
      : businessNumbers[0]?.number ?? ""

  return (
    <section
      id="dash-call-flow"
      className="scroll-mt-24 overflow-hidden rounded-3xl border border-border/60 bg-card/90 shadow-lg ring-1 ring-border/40"
    >
      <header className="border-b border-border/50 bg-gradient-to-b from-muted/20 to-transparent px-5 py-5 sm:px-8 sm:py-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <PhoneForwarded className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Call flow</h2>
              <SheetInfoTrigger
                onPress={() => setDashboardStoryKey("dashboard-call-flow")}
                label="About call flow"
                className="h-8 w-8"
              />
            </div>
            {routingLineDetailLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading line" />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" aria-hidden />
                Live
              </span>
            )}
          </div>

          {businessNumbers.length > 0 ? (
            <ActiveLinePicker
              businessNumbers={businessNumbers}
              activeLine={activeLine}
              onSelect={setRoutingBusinessNumber}
            />
          ) : quickSetupDecided ? (
            <Link
              href="/dashboard#dash-call-flow"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              Add a business line
            </Link>
          ) : null}
        </div>
      </header>

      <div className="px-4 py-6 sm:px-8 sm:py-8">
        {businessNumbers.length === 0 && quickSetupDecided ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No business line yet</p>
            <Link
              href="/dashboard#dash-call-flow"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Add number in Settings
            </Link>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-4 lg:flex-row lg:items-stretch",
              routingLineDetailLoading && "opacity-60"
            )}
            aria-label="Call handling steps"
          >
            <FlowStepCard
              step="2"
              title="Who answers"
              icon={Smartphone}
              value={isRoutingToOwner ? "Your phone" : selectedReceptionist?.name ?? "—"}
              detail={isRoutingToOwner ? ownerPhoneDisplay : formatPhoneDisplay(selectedReceptionist?.phone)}
              onOpen={() => setWhoAnswersOpen(true)}
              loading={routingLineDetailLoading}
            />
            <FlowConnector />
            <FlowStepCard
              step="3"
              title="Ring & backup"
              icon={Hourglass}
              value={`${ringTimeoutSec}s`}
              detail={`Then ${activeFallbackLabel}`}
              onOpen={() => setRingBackupOpen(true)}
              loading={routingLineDetailLoading}
            />
            <FlowConnector />
            <FlowStepCard
              step="4"
              title="Voice & AI"
              icon={AudioWaveform}
              value="Greetings"
              detail="AI script · voicemail · opening line"
              onOpen={() => setShowFallbackSettings(true)}
              loading={routingLineDetailLoading}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function ActiveLinePicker({
  businessNumbers,
  activeLine,
  onSelect,
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLine: string
  onSelect: (n: string) => void
}) {
  const display = formatPhoneDisplay(activeLine)
  const multi = businessNumbers.length > 1
  const activeLineFieldClass =
    "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-2.5 text-sm font-semibold text-foreground transition-colors duration-200 hover:border-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"

  if (!multi) {
    return (
      <div
        className={cn(
          "flex w-full max-w-md items-center justify-center gap-2 px-4",
          activeLineFieldClass
        )}
      >
        <span className="text-xs font-medium text-zinc-400">Active line:</span>
        <span className="text-foreground">{display}</span>
      </div>
    )
  }

  return (
    <label className="relative w-full max-w-md">
      <span className="sr-only">Active business line</span>
      <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-xs font-medium text-zinc-400">
        Active line:
      </span>
      <select
        value={activeLine}
        onChange={(e) => onSelect(e.target.value)}
        className={cn(activeLineFieldClass, "appearance-none pl-[5.5rem] pr-10 text-center")}
      >
        {businessNumbers.map((bn) => (
          <option key={bn.number} value={bn.number}>
            {formatPhoneDisplay(bn.number)}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
        aria-hidden
      />
    </label>
  )
}
