"use client"

import { memo } from "react"
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
import {
  CallFlowLinePickerSkeleton,
  CallFlowStepsSkeleton,
} from "@/components/workspace-content-skeletons"
import { CALL_FLOW_STEPS_MIN_H } from "@/components/dashboard-workspace-ui"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"

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
        <div className="h-[2px] w-full rounded-full bg-gradient-to-r from-primary/15 via-primary to-primary/15 shadow-[var(--electric-glow)]" />
        <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-primary shadow-[0_0_10px_var(--primary)]" />
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
  detail?: string
  onOpen: () => void
  loading?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={loading}
      className={cn(
        "group relative flex min-h-[12.5rem] min-w-0 flex-1 flex-col rounded-2xl border border-border/70 bg-gradient-to-b from-card to-background/80 p-5 text-left shadow-sm",
        "transform-gpu will-change-[opacity,transform] backface-hidden transition-[border-color,box-shadow,opacity] duration-200",
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
        {detail ? <p className="text-xs tabular-nums text-zinc-500">{detail}</p> : null}
      </div>
      <span className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-border/70 bg-transparent px-4 py-2.5 text-xs font-semibold text-muted-foreground transition-[border-color,background-color,color] duration-200 group-hover:border-primary/50 group-hover:bg-primary/10 group-hover:text-primary">
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

export const DashboardCallFlow = memo(function DashboardCallFlow({
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
  const { openBuyModal } = useDashboardNumbersModal()
  const activation = useDashboardActivationOptional()
  const subscriptionActive = activation?.subscriptionActive === true
  const activeLine =
    routingBusinessNumber && businessNumbers.some((b) => businessNumbersMatch(b.number, routingBusinessNumber))
      ? routingBusinessNumber
      : businessNumbers[0]?.number ?? ""

  return (
    <section
      id="dash-call-flow"
      className="scroll-mt-24 min-h-[22rem] overflow-hidden rounded-3xl border border-border/60 bg-card/90 shadow-lg ring-1 ring-border/40"
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
            ) : null}
          </div>

          {!quickSetupDecided ? (
            <CallFlowLinePickerSkeleton />
          ) : businessNumbers.length > 0 ? (
            <ActiveLinePicker
              businessNumbers={businessNumbers}
              activeLine={activeLine}
              onSelect={setRoutingBusinessNumber}
              subscriptionActive={subscriptionActive}
            />
          ) : quickSetupDecided ? (
            <button
              type="button"
              onClick={openBuyModal}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              + Add business number
            </button>
          ) : null}
        </div>
      </header>

      <div className={cn("px-4 py-6 sm:px-8 sm:py-8", CALL_FLOW_STEPS_MIN_H)}>
        {!quickSetupDecided ? (
          <CallFlowStepsSkeleton />
        ) : businessNumbers.length === 0 ? (
          <div className="flex min-h-[14.5rem] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/10 px-6 py-12 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">No business line yet</p>
              <button
                type="button"
                onClick={openBuyModal}
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                + Add business number
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "sigo-bloom-in-stagger flex flex-col gap-4 lg:flex-row lg:items-stretch",
              CALL_FLOW_STEPS_MIN_H,
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
              detail={activeFallbackLabel}
              onOpen={() => setRingBackupOpen(true)}
              loading={routingLineDetailLoading}
            />
            <FlowConnector />
            <FlowStepCard
              step="4"
              title="Voice & AI"
              icon={AudioWaveform}
              value="Greetings"
              onOpen={() => setShowFallbackSettings(true)}
              loading={routingLineDetailLoading}
            />
          </div>
        )}
      </div>
    </section>
  )
})

function LineConnectionState({ subscriptionActive }: { subscriptionActive: boolean }) {
  if (subscriptionActive) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300/95">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
          aria-hidden
        />
        • Live & Connected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#71717a]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97706]" aria-hidden />
      • Inactive (Pending Payment)
    </span>
  )
}

function LineStatusIndicator({ subscriptionActive }: { subscriptionActive: boolean }) {
  return <LineConnectionState subscriptionActive={subscriptionActive} />
}

const ActiveLinePicker = memo(function ActiveLinePicker({
  businessNumbers,
  activeLine,
  onSelect,
  subscriptionActive,
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLine: string
  onSelect: (n: string) => void
  subscriptionActive: boolean
}) {
  const display = formatPhoneDisplay(activeLine)
  const multi = businessNumbers.length > 1
  const activeLineFieldClass =
    "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm font-semibold text-foreground transition-colors duration-200 hover:border-primary/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

  if (!multi) {
    return (
      <div
        className={cn(
          "flex w-full max-w-md flex-col items-center justify-center gap-1 px-4 py-3",
          activeLineFieldClass
        )}
      >
        <span className="text-xs font-medium text-zinc-400">Active line</span>
        <span className="text-base text-foreground">{display}</span>
        <LineStatusIndicator subscriptionActive={subscriptionActive} />
      </div>
    )
  }

  return (
    <label className={cn("relative block w-full max-w-md", activeLineFieldClass)}>
      <span className="sr-only">Active business line</span>
      <div className="pointer-events-none flex flex-col items-center gap-1 px-4 py-3 pr-10">
        <span className="text-xs font-medium text-zinc-400">Active line</span>
        <span className="text-base font-semibold text-foreground">{display}</span>
        <LineStatusIndicator subscriptionActive={subscriptionActive} />
      </div>
      <select
        value={activeLine}
        onChange={(e) => onSelect(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Select active business line"
      >
        {businessNumbers.map((bn) => {
          const link = subscriptionActive ? "Live & Connected" : "Inactive (Pending Payment)"
          return (
            <option key={bn.number} value={bn.number}>
              {formatPhoneDisplay(bn.number)} — {link}
            </option>
          )
        })}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
        aria-hidden
      />
    </label>
  )
})
