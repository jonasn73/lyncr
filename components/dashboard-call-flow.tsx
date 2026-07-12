"use client"

import { Fragment, memo } from "react"
import type { LucideIcon } from "lucide-react"
import {
  PhoneForwarded,
  Loader2,
  ChevronDown,
  ChevronRight,
  Smartphone,
  Hourglass,
  AudioWaveform,
  Settings2,
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
import {
  CallFlowLinePickerSkeleton,
  CallFlowStepsSkeleton,
} from "@/components/workspace-content-skeletons"
import { CALL_FLOW_STEPS_MIN_H } from "@/components/dashboard-workspace-ui"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { useDashboardActivationOptional } from "@/components/dashboard-activation-context"
import { useRealTimeStatsContextOptional } from "@/components/dashboard/real-time-stats-provider"

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
}: {
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  loading?: boolean
  accent?: "primary" | "network"
}) {
  const isNetwork = accent === "network"
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={loading}
      className={cn(
        // Compact routing row — matches workspace glass tokens without tall tap stacks
        "flex w-full items-center gap-3 rounded-xl border border-slate-850/60 bg-slate-900/30 px-3 py-2.5 text-left transition-colors active:bg-slate-900/50",
        MOBILE_TAP_TARGET,
        loading && "pointer-events-none opacity-50"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isNetwork ? "bg-violet-500/15 text-violet-300" : "bg-primary/12 text-primary"
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
        {detail ? <p className="truncate text-xs text-zinc-500">{detail}</p> : null}
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
}: {
  step: string
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  loading?: boolean
  // "network" paints the shared Lyncr pool card violet to set it apart from the primary flow.
  accent?: "primary" | "network"
}) {
  const isNetwork = accent === "network"
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
              : "border-primary/30 bg-primary/15 shadow-[0_0_20px_-6px_var(--primary)]"
          )}
        >
          <Icon className={cn("h-5 w-5", isNetwork ? "text-violet-300" : "text-primary")} aria-hidden />
        </div>
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            isNetwork ? "text-violet-300/80" : "text-primary/80"
          )}
        >
          Step {step}
        </span>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-0.5 sm:mt-4 sm:gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-[11px]">{title}</p>
        <p className="text-base font-semibold leading-tight text-foreground line-clamp-2 sm:text-lg md:text-xl">{value}</p>
        {detail ? <p className="text-xs text-zinc-500 line-clamp-2">{detail}</p> : null}
      </div>
      <span
        className={cn(
          "mt-3 inline-flex w-full items-center justify-center rounded-lg border border-border/70 bg-transparent px-4 text-xs font-semibold text-muted-foreground transition-[border-color,background-color,color] duration-200 sm:mt-5",
          MOBILE_TAP_TARGET,
          isNetwork
            ? "group-hover:border-violet-500/50 group-hover:bg-violet-500/10 group-hover:text-violet-200"
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

/** One node in the visual call-flow waterfall — rendered left→right in the exact order Telnyx executes. */
type CallFlowNode = {
  key: string
  title: string
  icon: LucideIcon
  value: string
  detail?: string
  onOpen: () => void
  accent: "primary" | "network"
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

  // Node 3 — Fallback: the configured no-answer destination (your cell / AI / voicemail).
  nodes.push({
    key: "fallback",
    title: "Fallback · If no one answers",
    icon: Hourglass,
    value: params.activeFallbackLabel,
    detail: `After ringing ${params.ringTimeoutSec}s`,
    onOpen: params.openRingBackup,
    accent: "primary",
  })

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
  setRoutingBusinessNumber,
  quickSetupDecided,
  callFlowUiReady,
  routingLineDetailLoading,
  isRoutingToOwner,
  selectedReceptionist,
  ownerPhoneDisplay,
  ringTimeoutSec,
  activeFallbackLabel,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen,
  setShowFallbackSettings,
  adminRoutingOverridePhone,
}: DashboardCallFlowProps) {
  const { openBuyModal, openManageModal } = useDashboardNumbersModal()
  const activation = useDashboardActivationOptional()
  const realtimeStats = useRealTimeStatsContextOptional()
  const isMobile = useIsMobile()
  const subscriptionActive = activation?.subscriptionActive === true
  const lineCarrierLive = activation?.lineCarrierLive === true
  const activeLine =
    routingBusinessNumber && businessNumbers.some((b) => businessNumbersMatch(b.number, routingBusinessNumber))
      ? routingBusinessNumber
      : businessNumbers[0]?.number ?? ""

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
    openWhoAnswers: () => setWhoAnswersOpen(true),
    openRingBackup: () => setRingBackupOpen(true),
    openVoiceAi: () => setShowFallbackSettings(true),
    configureStrategy: onConfigureStrategy,
  })

  const adminOverrideActive = Boolean(adminRoutingOverridePhone?.trim())

  return (
    <section
      id="dash-call-flow"
      className={cn(
        "scroll-mt-28 min-h-0 overflow-x-clip md:min-h-[22rem] md:scroll-mt-24",
        isMobile
          ? "rounded-2xl border border-border/35 bg-card/40 p-3"
          : "rounded-3xl border border-border/60 bg-card/90 shadow-lg ring-1 ring-border/40"
      )}
    >
      <header
        className={cn(
          "border-b border-border/40",
          isMobile
            ? "px-0 pb-3 pt-0"
            : "border-border/50 bg-gradient-to-b from-muted/20 to-transparent px-5 py-5 sm:px-8 sm:py-6"
        )}
      >
        <div className={cn("flex flex-col", isMobile ? "gap-2" : "items-center gap-4")}>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {!isMobile ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                  <PhoneForwarded className="h-5 w-5 text-primary" aria-hidden />
                </div>
              ) : null}
              <h2 className={cn("font-semibold tracking-tight text-foreground", isMobile ? "text-base" : "text-lg sm:text-xl")}>
                Call flow
              </h2>
              <SheetInfoTrigger
                onPress={() => setDashboardStoryKey("dashboard-call-flow")}
                label="About call flow"
              />
            </div>
            <div className="flex items-center gap-1">
              {isMobile ? (
                <button
                  type="button"
                  onClick={openManageModal}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10",
                    MOBILE_TAP_TARGET
                  )}
                >
                  Lines
                </button>
              ) : null}
              {routingLineDetailLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading line" />
              ) : null}
            </div>
          </div>

          {!callFlowUiReady ? (
            <CallFlowLinePickerSkeleton />
          ) : businessNumbers.length > 0 ? (
            <ActiveLinePicker
              businessNumbers={businessNumbers}
              activeLine={activeLine}
              onSelect={setRoutingBusinessNumber}
              subscriptionActive={subscriptionActive}
              lineCarrierLive={lineCarrierLive}
              routingStrategy={routingStrategy}
              activeCallCount={realtimeStats?.activeCallsOnSelectedLine ?? 0}
              compact={isMobile}
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

      <div className={cn(isMobile ? "px-0 pt-3" : "px-4 py-6 sm:px-8 sm:py-8", !isMobile && CALL_FLOW_STEPS_MIN_H)}>
        {!callFlowUiReady ? (
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
          <div className={isMobile ? "" : "space-y-4"}>
            <AdminRoutingOverrideNotice
              active={adminOverrideActive}
              phone={adminRoutingOverridePhone?.trim() ?? ""}
            />
            {isMobile ? (
              <div
                className={cn("flex flex-col gap-2", routingLineDetailLoading && "opacity-60")}
                aria-label="Call handling steps"
              >
                {flowNodes.map((node) => (
                  <FlowStepMobileRow
                    key={node.key}
                    title={node.title}
                    icon={node.icon}
                    value={node.value}
                    detail={node.detail}
                    onOpen={node.onOpen}
                    loading={routingLineDetailLoading}
                    accent={node.accent}
                  />
                ))}
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
                {flowNodes.map((node, i) => (
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
                    />
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
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
}: {
  businessNumbers: DashboardBusinessNumber[]
  activeLine: string
  onSelect: (n: string) => void
  subscriptionActive: boolean
  lineCarrierLive: boolean
  routingStrategy: RoutingStrategy
  activeCallCount: number
  compact?: boolean
}) {
  const activeRow = businessNumbers.find((b) => businessNumbersMatch(b.number, activeLine))
  const display = formatPhoneDisplay(activeLine)
  const label = activeRow?.label?.trim() || "Business Line"
  const multi = businessNumbers.length > 1

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
