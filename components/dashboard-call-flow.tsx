"use client"

import { Fragment, memo } from "react"
import type { LucideIcon } from "lucide-react"
import {
  PhoneForwarded,
  Loader2,
  ChevronDown,
  ChevronRight,
  Smartphone,
  AudioWaveform,
  Network,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { useIsMobile } from "@/hooks/use-mobile"
import type { RoutingStrategy } from "@/lib/types"
import { LineRoutingStatus } from "@/components/line-routing-status"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { DRAWER_SHEET_GPU } from "@/lib/workspace-sheet-classes"
import { AdminRoutingOverrideNotice } from "@/components/dashboard/admin-routing-override-notice"
import { SmartOverflowFallbackCard } from "@/components/dashboard/smart-overflow-fallback-card"
import {
  CallFlowStepsSkeleton,
} from "@/components/workspace-content-skeletons"
import { CALL_FLOW_STEPS_MIN_H } from "@/components/dashboard-workspace-ui"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useSmartOverflowAutopilot } from "@/hooks/use-smart-overflow-autopilot"

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

function FlowStepMobileRow({
  title,
  icon: Icon,
  value,
  detail,
  onOpen,
  loading,
  accent = "primary",
  valueBadge,
  detailMuted = false,
}: {
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  loading?: boolean
  accent?: "primary" | "network" | "scheduler"
  /** Optional warning / status chip next to the value (e.g. Autopilot). */
  valueBadge?: string
  /** Muted slate detail copy (Autopilot “rings bypassed” line). */
  detailMuted?: boolean
}) {
  // Pick the tint for the left icon tile from the step accent.
  const isNetwork = accent === "network"
  const isScheduler = accent === "scheduler"
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={loading}
      className={cn(
        // Compact routing row — matches workspace glass tokens without tall tap stacks
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors active:bg-slate-900/50",
        isScheduler
          ? "border-emerald-500/30 bg-emerald-950/10"
          : "border-slate-850/60 bg-slate-900/30",
        MOBILE_TAP_TARGET,
        loading && "pointer-events-none opacity-50"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isNetwork
            ? "bg-violet-500/15 text-violet-300"
            : isScheduler
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-primary/12 text-primary"
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{value}</p>
          {valueBadge ? (
            <span className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
              {valueBadge}
            </span>
          ) : null}
        </div>
        {detail ? (
          <p className={cn("truncate text-xs", detailMuted ? "text-slate-500" : "text-zinc-500")}>{detail}</p>
        ) : null}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
    </button>
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
  accent = "primary",
  valueBadge,
  detailMuted = false,
}: {
  step: string
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  loading?: boolean
  // "network" = Lyncr pool (violet); "scheduler" = Sunday Autopilot AI fallback (emerald).
  accent?: "primary" | "network" | "scheduler"
  /** Optional warning / status chip next to the value (e.g. Autopilot). */
  valueBadge?: string
  /** Muted slate detail copy (Autopilot “rings bypassed” line). */
  detailMuted?: boolean
}) {
  // Resolve accent flags once so class lists stay readable.
  const isNetwork = accent === "network"
  const isScheduler = accent === "scheduler"
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={loading}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border p-3 text-left shadow-sm sm:min-h-[12.5rem] sm:p-5",
        "transform-gpu will-change-[opacity,transform] backface-hidden transition-[border-color,box-shadow,opacity] duration-200",
        "focus-visible:outline-none focus-visible:ring-2",
        isNetwork
          ? "border-violet-500/40 bg-gradient-to-b from-violet-500/10 to-background/80 hover:border-violet-500/60 hover:shadow-[0_0_32px_-12px_rgb(139_92_246)] focus-visible:ring-violet-500/50"
          : isScheduler
            ? "border-emerald-500/30 bg-emerald-950/10 hover:border-emerald-500/50 hover:shadow-[0_0_32px_-12px_rgb(16_185_129)] focus-visible:ring-emerald-500/40"
            : "border-border/70 bg-gradient-to-b from-card to-background/80 hover:border-primary/45 hover:shadow-[0_0_32px_-12px_var(--primary)] focus-visible:ring-primary/50",
        loading && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl border",
            isNetwork
              ? "border-violet-500/30 bg-violet-500/15 shadow-[0_0_20px_-6px_rgb(139_92_246)]"
              : isScheduler
                ? "border-emerald-500/30 bg-emerald-500/15 shadow-[0_0_20px_-6px_rgb(16_185_129)]"
                : "border-primary/30 bg-primary/15 shadow-[0_0_20px_-6px_var(--primary)]"
          )}
        >
          <Icon
            className={cn(
              "h-5 w-5",
              isNetwork ? "text-violet-300" : isScheduler ? "text-emerald-300" : "text-primary"
            )}
            aria-hidden
          />
        </div>
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            isNetwork ? "text-violet-300/80" : isScheduler ? "text-emerald-300/80" : "text-primary/80"
          )}
        >
          Step {step}
        </span>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-0.5 sm:mt-4 sm:gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[11px]">{title}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-base font-semibold leading-tight text-foreground line-clamp-2 sm:text-lg md:text-xl">
            {value}
          </p>
          {valueBadge ? (
            <span className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
              {valueBadge}
            </span>
          ) : null}
        </div>
        {detail ? (
          <p className={cn("text-xs line-clamp-2", detailMuted ? "text-slate-500" : "text-zinc-500")}>{detail}</p>
        ) : null}
      </div>
      <span
        className={cn(
          "mt-3 inline-flex w-full items-center justify-center rounded-lg border border-border/70 bg-transparent px-4 text-xs font-semibold text-muted-foreground transition-[border-color,background-color,color] duration-200 sm:mt-5",
          MOBILE_TAP_TARGET,
          isNetwork
            ? "group-hover:border-violet-500/50 group-hover:bg-violet-500/10 group-hover:text-violet-200"
            : isScheduler
              ? "group-hover:border-emerald-500/50 group-hover:bg-emerald-500/10 group-hover:text-emerald-200"
              : "group-hover:border-primary/50 group-hover:bg-primary/10 group-hover:text-primary"
        )}
      >
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
  /** True once phone lines finished loading — controls skeleton vs live call-flow cards. */
  callFlowUiReady: boolean
  routingLineDetailLoading: boolean
  isRoutingToOwner: boolean
  selectedReceptionist: Contact | null
  ownerPhoneDisplay: string
  ringTimeoutSec: number
  activeFallbackLabel: string
  /**
   * Sunday Autopilot — AI answers with owner rings bypassed
   * (`fallback_type === "ai"` + `!ai_ring_owner_first` + routing to your phone).
   */
  autopilotMode: boolean
  // Hybrid-network state (migrations 048/049) — drives the inline "Lyncr Network Pool" step.
  routingStrategy: RoutingStrategy
  allowLyncrNetworkFallback: boolean
  // Opens the routing-strategy dialog (private_only / lyncr_only / hybrid_fallback).
  onConfigureStrategy: () => void
  setDashboardStoryKey: (key: string | null) => void
  setWhoAnswersOpen: (v: boolean) => void
  setRingBackupOpen: (v: boolean) => void
  setShowFallbackSettings: (v: boolean) => void
  /** When set, platform admin has forced inbound calls to this PSTN number (read-only notice). */
  adminRoutingOverridePhone?: string | null
}

/** True when the shared Lyncr network participates in this line's call flow. */
export function isLyncrNetworkStepActive(
  routingStrategy: RoutingStrategy,
  allowLyncrNetworkFallback: boolean
): boolean {
  return (
    routingStrategy === "hybrid_fallback" ||
    routingStrategy === "lyncr_only" ||
    (routingStrategy === "private_only" && allowLyncrNetworkFallback)
  )
}

/**
 * Sunday Autopilot is active when Voice AI is the fallback, the owner’s phone is not rung first,
 * and this line is set to “Your phone” — matching the direct-AI inbound path.
 */
export function isSundayAutopilotActive(opts: {
  fallback: string
  aiRingOwnerFirst: boolean
  isRoutingToOwner: boolean
}): boolean {
  // AI receptionist must be the configured fallback destination.
  if (opts.fallback !== "ai") return false
  // “Ring my phone first” must be off so inbound skips the PSTN ring.
  if (opts.aiRingOwnerFirst) return false
  // Autopilot UI only applies when the primary destination is the owner’s cell.
  return opts.isRoutingToOwner
}

/** One node in the visual call-flow waterfall — rendered left→right in the exact order Telnyx executes. */
type CallFlowNode = {
  key: string
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  accent: "primary" | "network" | "scheduler"
  valueBadge?: string
  detailMuted?: boolean
}

/**
 * Build the ordered waterfall the inbound webhook actually runs, so Step 2/3/… map to who really
 * rings first. The shared Lyncr pool is shown as the *primary* node for `lyncr_only` (never beside
 * "Your phone"), and only as an intermediate "if no answer" node for hybrid / private-with-fallback.
 */
export function buildCallFlowNodes(params: {
  routingStrategy: RoutingStrategy
  allowLyncrNetworkFallback: boolean
  isRoutingToOwner: boolean
  selectedReceptionistName: string | null
  selectedReceptionistPhone: string | null
  ownerPhoneDisplay: string
  ringTimeoutSec: number
  activeFallbackLabel: string
  /** When true, Primary/Fallback cards show Sunday Autopilot scheduler copy. */
  autopilotMode: boolean
  openWhoAnswers: () => void
  openRingBackup: () => void
  openVoiceAi: () => void
  configureStrategy: () => void
}): CallFlowNode[] {
  const poolIsPrimary = params.routingStrategy === "lyncr_only"
  const nodes: CallFlowNode[] = []

  // Node 1 — Primary: whoever the webhook dials first on this line.
  if (poolIsPrimary) {
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Network,
      value: "Lyncr Network Pool",
      detail: "Certified shared agents answer in-browser",
      onOpen: params.openWhoAnswers,
      accent: "network",
    })
  } else if (params.isRoutingToOwner && params.autopilotMode) {
    // Sunday Autopilot: Your phone stays listed, but rings are bypassed for the AI scheduler.
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: "Your phone",
      // Muted slate number + bypass notice so operators see Autopilot at a glance.
      detail: `${params.ownerPhoneDisplay} ⏸️ Rings bypassed`,
      valueBadge: "AUTOPILOT",
      detailMuted: true,
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  } else {
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: params.isRoutingToOwner ? "Your phone" : params.selectedReceptionistName ?? "—",
      detail: params.isRoutingToOwner ? params.ownerPhoneDisplay : params.selectedReceptionistPhone ?? undefined,
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  }

  // Node 2 — Intermediate Lyncr network (hybrid / private+fallback only; for lyncr_only the pool is already primary).
  if (!poolIsPrimary && isLyncrNetworkStepActive(params.routingStrategy, params.allowLyncrNetworkFallback)) {
    nodes.push({
      key: "network",
      title: "If no answer · Lyncr Network",
      icon: Network,
      value: "Lyncr Network Pool",
      detail: "Shared agents try next",
      onOpen: params.configureStrategy,
      accent: "network",
    })
  }

  // Node 3 — Fallback is owned by the Smart Overflow Autopilot card (rendered separately).
  // (Kept out of the generic node list so mode controls + live badges can sit on the card.)

  // Node 4 — Voice & AI greetings (final voicemail / AI script).
  nodes.push({
    key: "voice",
    title: "Voice & AI",
    icon: AudioWaveform,
    value: "Greetings",
    onOpen: params.openVoiceAi,
    accent: "primary",
  })

  return nodes
}

export const DashboardCallFlow = memo(function DashboardCallFlow({
  businessNumbers,
  routingBusinessNumber,
  quickSetupDecided,
  callFlowUiReady,
  routingLineDetailLoading,
  isRoutingToOwner,
  selectedReceptionist,
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  autopilotMode,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  adminRoutingOverridePhone,
}: DashboardCallFlowProps) {
  const { openBuyModal } = useDashboardNumbersModal()
  const isMobile = useIsMobile()
  // Live calendar capacity + next open 1-hour block for Smart Overflow IVR Menu.
  const smartOverflow = useSmartOverflowAutopilot(routingBusinessNumber)
  // Manual / Auto-On capacity trips OR classic Sunday Autopilot (AI + rings bypassed).
  const effectiveAutopilot = autopilotMode || smartOverflow.overflowActive

  // The ordered waterfall mirrors exactly what the inbound webhook executes for this strategy.
  const flowNodes = buildCallFlowNodes({
    routingStrategy,
    allowLyncrNetworkFallback,
    isRoutingToOwner,
    selectedReceptionistName: selectedReceptionist?.name ?? null,
    selectedReceptionistPhone: selectedReceptionist?.phone ? formatPhoneDisplay(selectedReceptionist.phone) : null,
    ownerPhoneDisplay,
    ringTimeoutSec,
    activeFallbackLabel,
    autopilotMode: effectiveAutopilot,
    openWhoAnswers: () => setWhoAnswersOpen(true),
    openRingBackup: () => setRingBackupOpen(true),
    openVoiceAi: () => setShowFallbackSettings(true),
    configureStrategy: onConfigureStrategy,
  })

  // Voice & AI is always last; Smart Overflow owns the fallback slot before it.
  const primaryAndNetworkNodes = flowNodes.filter((n) => n.key !== "voice")
  const voiceNode = flowNodes.find((n) => n.key === "voice")

  const adminOverrideActive = Boolean(adminRoutingOverridePhone?.trim())

  const overflowCard = (
    <SmartOverflowFallbackCard
      compact={isMobile}
      step={String(primaryAndNetworkNodes.length + 2)}
      overflowActive={smartOverflow.overflowActive || autopilotMode}
      nextAvailableSlotText={smartOverflow.nextAvailableSlotText}
      confirmedJobsToday={smartOverflow.confirmedJobsToday}
      config={smartOverflow.config}
      onConfigChange={smartOverflow.setConfig}
      onOpenScriptEditor={() => setShowFallbackSettings(true)}
      loading={routingLineDetailLoading || smartOverflow.loading}
      retellConnected={smartOverflow.retellConnected}
    />
  )

  // Flattened shell — no outer card; step rows/cards sit on the page background.
  return (
    <section id="dash-call-flow" className="scroll-mt-28 min-h-0 overflow-x-clip md:min-h-[22rem] md:scroll-mt-24">
      {/* Title + info only on md+ — non-actionable on mobile per UI standards. */}
      <div className="mb-3 hidden items-center justify-between gap-2 md:flex">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
            <PhoneForwarded className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Call flow</h2>
          <SheetInfoTrigger
            onPress={() => setDashboardStoryKey("dashboard-call-flow")}
            label="About call flow"
          />
        </div>
        {routingLineDetailLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading line" />
        ) : null}
      </div>

      {!callFlowUiReady ? (
        <CallFlowStepsSkeleton />
      ) : businessNumbers.length === 0 ? (
        <div className="flex min-h-[14.5rem] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/10 px-6 py-12 text-center">
          <div>
            <p className="text-sm font-medium text-foreground">No business line yet</p>
            {quickSetupDecided ? (
              <button
                type="button"
                onClick={openBuyModal}
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                + Add business number
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={cn(!isMobile && CALL_FLOW_STEPS_MIN_H, !isMobile && "space-y-4")}>
          <AdminRoutingOverrideNotice
            active={adminOverrideActive}
            phone={adminRoutingOverridePhone?.trim() ?? ""}
          />
          {isMobile ? (
            <div
              className={cn("flex flex-col gap-2", routingLineDetailLoading && "opacity-60")}
              aria-label="Call handling steps"
            >
              {primaryAndNetworkNodes.map((node) => (
                <FlowStepMobileRow
                  key={node.key}
                  title={node.title}
                  icon={node.icon}
                  value={node.value}
                  detail={node.detail}
                  onOpen={node.onOpen}
                  loading={routingLineDetailLoading}
                  accent={node.accent}
                  valueBadge={node.valueBadge}
                  detailMuted={node.detailMuted}
                />
              ))}
              {overflowCard}
              {voiceNode ? (
                <FlowStepMobileRow
                  key={voiceNode.key}
                  title={voiceNode.title}
                  icon={voiceNode.icon}
                  value={voiceNode.value}
                  detail={voiceNode.detail}
                  onOpen={voiceNode.onOpen}
                  loading={routingLineDetailLoading}
                  accent={voiceNode.accent}
                />
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "flex flex-col gap-4 lg:flex-row lg:items-stretch",
                CALL_FLOW_STEPS_MIN_H,
                routingLineDetailLoading && "opacity-60"
              )}
              aria-label="Call handling steps"
            >
              {primaryAndNetworkNodes.map((node, i) => (
                <Fragment key={node.key}>
                  {i > 0 ? <FlowConnector /> : null}
                  <FlowStepCard
                    step={String(i + 2)}
                    title={node.title}
                    icon={node.icon}
                    value={node.value}
                    detail={node.detail}
                    onOpen={node.onOpen}
                    loading={routingLineDetailLoading}
                    accent={node.accent}
                    valueBadge={node.valueBadge}
                    detailMuted={node.detailMuted}
                  />
                </Fragment>
              ))}
              <FlowConnector />
              {overflowCard}
              {voiceNode ? (
                <>
                  <FlowConnector />
                  <FlowStepCard
                    step={String(primaryAndNetworkNodes.length + 3)}
                    title={voiceNode.title}
                    icon={voiceNode.icon}
                    value={voiceNode.value}
                    detail={voiceNode.detail}
                    onOpen={voiceNode.onOpen}
                    loading={routingLineDetailLoading}
                    accent={voiceNode.accent}
                  />
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  )
})

export const ActiveLineSubHeader = memo(function ActiveLineSubHeader({
  businessNumbers,
  activeLine,
  onSelect,
  subscriptionActive,
  lineCarrierLive,
  routingStrategy,
  activeCallCount,
  loading = false,
  /** When true, skip local border/padding — parent sticky chrome owns the frame. */
  bare = false,
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLine: string
  onSelect: (n: string) => void
  subscriptionActive: boolean
  lineCarrierLive: boolean
  routingStrategy: RoutingStrategy
  activeCallCount: number
  loading?: boolean
  bare?: boolean
}) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const isMobile = useIsMobile()

  // Shared row layout; bare mode lets the sticky nav wrapper supply padding/border.
  const rowClass = bare
    ? "flex w-full min-w-0 items-center gap-2 sm:gap-3"
    : "flex w-full items-center gap-2 border-b border-slate-900/80 px-2 py-2.5 sm:gap-3"

  if (businessNumbers.length === 0) {
    return (
      <div
        className={
          bare
            ? "flex w-full min-w-0 items-center justify-between gap-3"
            : "flex w-full items-center justify-between gap-3 border-b border-slate-900/80 px-2 py-2.5"
        }
      >
        <p className="text-sm text-slate-500">No business line yet</p>
        <button
          type="button"
          onClick={openBuyModal}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10",
            MOBILE_TAP_TARGET
          )}
        >
          + Add number
        </button>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      <div className="min-w-0 flex-1">
        <ActiveLinePicker
          businessNumbers={businessNumbers}
          activeLine={activeLine}
          onSelect={onSelect}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          routingStrategy={routingStrategy}
          activeCallCount={activeCallCount}
          compact
          wide
        />
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading line" />
      ) : null}
      {isMobile ? (
        <button
          type="button"
          onClick={openManageModal}
          className={cn(
            "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10",
            MOBILE_TAP_TARGET
          )}
        >
          Lines
        </button>
      ) : null}
    </div>
  )
})

const ActiveLinePicker = memo(function ActiveLinePicker({
  businessNumbers,
  activeLine,
  onSelect,
  subscriptionActive,
  lineCarrierLive,
  routingStrategy,
  activeCallCount,
  compact = false,
  wide = false,
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLine: string
  onSelect: (n: string) => void
  subscriptionActive: boolean
  lineCarrierLive: boolean
  routingStrategy: RoutingStrategy
  activeCallCount: number
  compact?: boolean
  /** Full-width sub-header for the sticky tracking-line nav — no nested card chrome. */
  wide?: boolean
}) {
  const activeRow = businessNumbers.find((b) => businessNumbersMatch(b.number, activeLine))
  const display = formatPhoneDisplay(activeLine)
  const label = activeRow?.label?.trim() || "Business Line"
  const multi = businessNumbers.length > 1

  // Wide sub-header: phone + live badge on one sleek row (no card-in-card).
  if (wide) {
    const status = (
      <LineRoutingStatus
        routingStrategy={routingStrategy}
        subscriptionActive={subscriptionActive}
        lineCarrierLive={lineCarrierLive}
        activeCallCount={activeCallCount}
        className="shrink-0"
      />
    )
    if (!multi) {
      return (
        <div className="flex w-full min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {label}
            </p>
            <p className="truncate text-base font-semibold tabular-nums text-slate-100">{display}</p>
          </div>
          {status}
        </div>
      )
    }
    return (
      <label className="relative block w-full min-w-0">
        <span className="sr-only">Active business line</span>
        <div className="pointer-events-none flex items-center justify-between gap-3 pr-7">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {label}
            </p>
            <p className="truncate text-base font-semibold tabular-nums text-slate-100">{display}</p>
          </div>
          {status}
        </div>
        <select
          value={activeLine}
          onChange={(e) => onSelect(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Select active business line"
        >
          {businessNumbers.map((bn) => {
            const link = lineCarrierLive
              ? "Live & Connected"
              : subscriptionActive
                ? "Activating line"
                : "Inactive (Pending Payment)"
            const lineLabel = bn.label?.trim() || "Business Line"
            return (
              <option key={bn.number} value={bn.number}>
                {lineLabel} · {formatPhoneDisplay(bn.number)} — {link}
              </option>
            )
          })}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          aria-hidden
        />
      </label>
    )
  }

  // Compact mobile: phone left, status pill right — no tall stacked box
  if (compact && !multi) {
    return (
      <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-850/60 bg-slate-900/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-medium text-zinc-500">{label}</p>
          <p className="truncate text-sm font-semibold text-foreground">{display}</p>
        </div>
        <LineRoutingStatus
          routingStrategy={routingStrategy}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          activeCallCount={activeCallCount}
          className="shrink-0"
        />
      </div>
    )
  }

  const activeLineFieldClass = compact
    ? "w-full rounded-xl border border-slate-850/60 bg-slate-900/30 px-3 py-2.5 text-left"
    : "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm font-semibold text-foreground transition-colors duration-200 hover:border-primary/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

  if (!multi) {
    return (
      <div className={cn("flex w-full max-w-md flex-col items-center justify-center gap-1 px-4 py-3", activeLineFieldClass)}>
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className="text-base text-foreground">{display}</span>
        <LineRoutingStatus
          routingStrategy={routingStrategy}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          activeCallCount={activeCallCount}
        />
      </div>
    )
  }

  return (
    <label className={cn("relative block w-full max-w-md", activeLineFieldClass)}>
        <span className="sr-only">Active business line</span>
        {compact ? (
          <div className="pointer-events-none flex items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-medium text-zinc-500">{label}</p>
              <p className="truncate text-sm font-semibold text-foreground">{display}</p>
            </div>
            <LineRoutingStatus
              routingStrategy={routingStrategy}
              subscriptionActive={subscriptionActive}
              lineCarrierLive={lineCarrierLive}
              activeCallCount={activeCallCount}
              className="shrink-0"
            />
          </div>
        ) : (
          <div className="pointer-events-none flex flex-col items-center gap-1 px-4 py-3 pr-10">
            <span className="text-xs font-medium text-zinc-400">{label}</span>
            <span className="text-base font-semibold text-foreground">{display}</span>
            <LineRoutingStatus
              routingStrategy={routingStrategy}
              subscriptionActive={subscriptionActive}
              lineCarrierLive={lineCarrierLive}
              activeCallCount={activeCallCount}
            />
          </div>
        )}
        <select
          value={activeLine}
          onChange={(e) => onSelect(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Select active business line"
        >
          {businessNumbers.map((bn) => {
            const link = lineCarrierLive
              ? "Live & Connected"
              : subscriptionActive
                ? "Activating line"
                : "Inactive (Pending Payment)"
            const lineLabel = bn.label?.trim() || "Business Line"
            return (
              <option key={bn.number} value={bn.number}>
                {lineLabel} · {formatPhoneDisplay(bn.number)} — {link}
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
