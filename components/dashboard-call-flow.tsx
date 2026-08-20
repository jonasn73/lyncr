"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Loader2, ChevronDown, Smartphone, Network } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import type { RoutingStrategy } from "@/lib/types"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { LineRoutingStatus } from "@/components/line-routing-status"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  type Contact,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import { DRAWER_SHEET_GPU } from "@/lib/workspace-sheet-classes"
import { AdminRoutingOverrideNotice } from "@/components/dashboard/admin-routing-override-notice"
import { WhoRingsConsole } from "@/components/dashboard/who-rings-console"
import { HoldQueueWaitingCard } from "@/components/dashboard/hold-queue-waiting-card"
import { JustFinishedReviewCard } from "@/components/dashboard/just-finished-review-card"
import { useDashboardNumbersModal } from "@/components/dashboard-numbers-modal-context"
import { customerFacingPhoneLines } from "@/lib/amber-control-line"
import {
  LYNCR_ROUTING_MODE_CHANGED,
  normalizeActiveRoutingMode,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"
import { deriveRingsNowStrip } from "@/lib/inbound-dial-plan-core"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"
import { useRealTimeStatsContextOptional } from "@/components/dashboard/real-time-stats-provider"

export const ROUTING_DRAWER_SHEET_CLASS =
  "gap-0 flex h-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl [&>button]:top-5 [&>button]:right-5 " +
  DRAWER_SHEET_GPU

export const VOICE_AI_DRAWER_SHEET_CLASS =
  "gap-0 flex h-full flex-col p-0 sm:max-w-lg md:max-w-xl lg:max-w-2xl [&>button]:top-5 [&>button]:right-5 " +
  DRAWER_SHEET_GPU

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
  /** Full team roster — when Busy, an Available teammate is shown before IVR. */
  teamReceptionists?: Contact[]
  /**
   * True once bootstrap/API settled the receptionist list (may be empty).
   * While false, Busy must not paint IVR LIVE (avoids orange flash before Alex loads).
   */
  teamRosterReady?: boolean
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
  faded?: boolean
  badgeTone?: "amber" | "emerald"
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
  /** When true, Primary/Fallback cards show Sunday Autopilot scheduler copy. */
  autopilotMode: boolean
  /** Off-duty IVR Menu is answering — fade Your phone and badge Forwarding to IVR. */
  ivrMenuLive?: boolean
  /** Presence Busy — cell is bypassed for automation. */
  presenceBypass?: boolean
  presenceStatus?: "AVAILABLE" | "ON_JOB" | "CLOSED"
  /**
   * When Busy, an Available teammate rings before IVR — show her as the live primary
   * instead of advertising automation first.
   */
  busyBackupReceptionistName?: string | null
  busyBackupReceptionistPhone?: string | null
  openWhoAnswers: () => void
  configureStrategy: () => void
}): CallFlowNode[] {
  const poolIsPrimary = params.routingStrategy === "lyncr_only"
  const nodes: CallFlowNode[] = []
  const ivrLive = params.ivrMenuLive === true
  const presenceBypass = params.presenceBypass === true
  const busyBackupName = params.busyBackupReceptionistName?.trim() || ""
  // Busy + Available teammate → she owns first ring (not IVR).
  const busyBackupLive = presenceBypass && Boolean(busyBackupName)
  const cellBypassed = (ivrLive || presenceBypass) && !busyBackupLive
  const presenceBadge = presenceBypass && !busyBackupLive ? "[ BUSY ]" : undefined
  const bypassDetail =
    "Presence Busy — calls go to booking automation. Your phone will not ring."
  const busyBackupDetail =
    params.busyBackupReceptionistPhone?.trim()
      ? `${params.busyBackupReceptionistPhone.trim()} · rings first while you're Busy`
      : "Rings first while you're Busy"

  // Node 1 — Primary: whoever the webhook dials first on this line.
  if (poolIsPrimary) {
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Network,
      value: "Lyncr Network Pool",
      detail: presenceBypass
        ? bypassDetail
        : ivrLive
          ? "Certified shared agents answer in-browser · IVR live"
          : "Certified shared agents answer in-browser",
      onOpen: params.openWhoAnswers,
      accent: "network",
      faded: cellBypassed,
      valueBadge: presenceBadge || (ivrLive ? "[ Forwarding to IVR ]" : undefined),
      badgeTone: presenceBypass ? "amber" : ivrLive ? "emerald" : "amber",
      detailMuted: cellBypassed,
    })
  } else if (busyBackupLive) {
    // Owner Busy + Available receptionist — she is the live first hop (matches inbound TeXML).
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: busyBackupName,
      detail: busyBackupDetail,
      valueBadge: "[ LIVE ]",
      badgeTone: "emerald",
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  } else if (params.isRoutingToOwner && params.autopilotMode && !cellBypassed) {
    // Sunday Autopilot: Your phone stays listed, but rings are bypassed for the AI scheduler.
    const phoneBit = params.ownerPhoneDisplay.trim()
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: "Your phone",
      // Muted slate number + bypass notice so operators see Autopilot at a glance.
      detail: phoneBit ? `${phoneBit} ⏸️ Rings bypassed` : "⏸️ Rings bypassed",
      valueBadge: "AUTOPILOT",
      detailMuted: true,
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  } else if (params.isRoutingToOwner && presenceBypass) {
    const phoneBit = params.ownerPhoneDisplay.trim()
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: "Your phone",
      detail: phoneBit ? `${phoneBit} · ${bypassDetail}` : bypassDetail,
      valueBadge: presenceBadge,
      badgeTone: "amber",
      detailMuted: true,
      faded: true,
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  } else if (params.isRoutingToOwner && ivrLive) {
    // Off-duty IVR Menu owns the first answer — cell is no longer the initial hit.
    const phoneBit = params.ownerPhoneDisplay.trim()
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: "Your phone",
      detail: phoneBit
        ? `${phoneBit} · cell bypassed while IVR is live`
        : "Cell bypassed while IVR is live",
      valueBadge: "[ Forwarding to IVR ]",
      badgeTone: "emerald",
      detailMuted: true,
      faded: true,
      onOpen: params.openWhoAnswers,
      accent: "primary",
    })
  } else {
    nodes.push({
      key: "primary",
      title: "Primary · Who answers",
      icon: Smartphone,
      value: params.isRoutingToOwner ? "Your phone" : params.selectedReceptionistName ?? "—",
      detail: presenceBypass
        ? bypassDetail
        : params.isRoutingToOwner
          ? params.ownerPhoneDisplay || undefined
          : params.selectedReceptionistPhone ?? undefined,
      onOpen: params.openWhoAnswers,
      accent: "primary",
      faded: cellBypassed,
      valueBadge: presenceBadge || (ivrLive ? "[ Forwarding to IVR ]" : undefined),
      badgeTone: presenceBypass ? "amber" : ivrLive ? "emerald" : "amber",
      detailMuted: cellBypassed,
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
      faded: cellBypassed,
    })
  }

  // Fallback IVR + Missed Call Rescue are rendered as dedicated cards outside this list.
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
  teamReceptionists = [],
  teamRosterReady = false,
  ownerPhoneDisplay,
  ringTimeoutSec: _ringTimeoutSec,
  activeFallbackLabel: _activeFallbackLabel,
  autopilotMode,
  routingStrategy,
  allowLyncrNetworkFallback,
  onConfigureStrategy: _onConfigureStrategy,
  setDashboardStoryKey,
  setWhoAnswersOpen,
  setRingBackupOpen: _setRingBackupOpen,
  setShowFallbackSettings,
  adminRoutingOverridePhone,
}: DashboardCallFlowProps) {
  const { openBuyModal } = useDashboardNumbersModal()
  const { presenceBypass, presenceReady } = useAccountPresence()
  // Live answered legs — Available + on a call should not claim “Your phone”.
  const realtime = useRealTimeStatsContextOptional()
  const ownerOnLiveCall = Boolean(
    !presenceBypass && realtime?.activeCallSessions?.some((s) => Boolean(s.answeredAt))
  )
  // Who Answers primary mode — gates the entire IVR configuration deck.
  const routingModeCacheKey = persistedCacheKey(
    "active-routing-mode",
    routingBusinessNumber?.trim() || "none"
  )
  const [activeRoutingMode, setActiveRoutingMode] = useState<ActiveRoutingMode>("your_phone")

  // Re-seed from session after hydrate + when the active line changes (SSR-safe).
  useLayoutEffect(() => {
    if (!routingBusinessNumber?.trim()) return
    const cached = readPersistedCache<{ mode: string }>(routingModeCacheKey)
    if (cached?.mode) {
      setActiveRoutingMode(normalizeActiveRoutingMode(cached.mode))
    }
  }, [routingBusinessNumber, routingModeCacheKey])

  const loadActiveRoutingMode = useCallback(async () => {
    if (!routingBusinessNumber?.trim()) {
      setActiveRoutingMode("your_phone")
      return
    }
    try {
      const res = await fetch(
        `/api/routing/mode?number=${encodeURIComponent(routingBusinessNumber)}`,
        { credentials: "include", cache: "no-store" }
      )
      if (!res.ok) return
      const json = (await res.json()) as { data?: { activeRoutingMode?: string } }
      const next = normalizeActiveRoutingMode(json.data?.activeRoutingMode)
      setActiveRoutingMode(next)
      writePersistedCache(routingModeCacheKey, { mode: next })
    } catch {
      // Keep last known mode on transient network errors.
    }
  }, [routingBusinessNumber, routingModeCacheKey])

  useEffect(() => {
    void loadActiveRoutingMode()
  }, [loadActiveRoutingMode])

  useEffect(() => {
    const onModeChanged = () => {
      void loadActiveRoutingMode()
    }
    window.addEventListener(LYNCR_ROUTING_MODE_CHANGED, onModeChanged)
    return () => window.removeEventListener(LYNCR_ROUTING_MODE_CHANGED, onModeChanged)
  }, [loadActiveRoutingMode])

  // Lines chrome paint seed — name only, no phone yet (see dashboard-page).
  const PAINT_SEED_RECEPTIONIST_ID = "__paint-seed-receptionist__"
  // When Busy, prefer an Available teammate (same order as inbound TeXML).
  const busyBackupReceptionist = (() => {
    if (!presenceBypass) return null
    const dialable = teamReceptionists.filter((r) => {
      if (r.is_active === false) return false
      // Paint-seed stub still means "team answers first" — don't flash IVR LIVE waiting for phone.
      if (r.id === PAINT_SEED_RECEPTIONIST_ID) return Boolean(r.name?.trim())
      return Boolean(r.phone?.trim())
    })
    if (dialable.length === 0) return null
    if (
      selectedReceptionist &&
      selectedReceptionist.is_active !== false &&
      (Boolean(selectedReceptionist.phone?.trim()) ||
        selectedReceptionist.id === PAINT_SEED_RECEPTIONIST_ID)
    ) {
      return selectedReceptionist
    }
    return dialable[0] ?? null
  })()
  const adminOverrideActive = Boolean(adminRoutingOverridePhone?.trim())

  // Same planner rules as voice — Busy waits for teamRosterReady so IVR never flashes early.
  const ringsNowStrip = deriveRingsNowStrip({
    presenceBypass,
    presenceReady,
    teamRosterReady,
    busyBackupName: busyBackupReceptionist?.name ?? null,
    ownerLabel: ownerPhoneDisplay?.trim() ? "Your phone" : "Owner",
    activeRoutingMode,
    teamReceptionistName:
      activeRoutingMode === "team_receptionist"
        ? selectedReceptionist?.name ?? null
        : null,
    teamReceptionistActive:
      activeRoutingMode === "team_receptionist"
        ? selectedReceptionist?.is_active !== false &&
          Boolean(selectedReceptionist?.name?.trim() || selectedReceptionist?.phone?.trim())
        : false,
    ownerOnLiveCall,
  })

  const openWhoAnswers = useCallback(() => setWhoAnswersOpen(true), [setWhoAnswersOpen])
  const openScriptEditor = useCallback(() => setShowFallbackSettings(true), [setShowFallbackSettings])

  // Desktop-only muted hint — never competes with the three-row story on phones.
  const detailHint =
    routingStrategy === "lyncr_only"
      ? "Shared Lyncr pool answers these calls in-browser."
      : ownerOnLiveCall
        ? "You're on a live call — new callers go to team or hold instead of interrupting."
        : autopilotMode && !presenceBypass
          ? "Sunday Autopilot — AI answers first; your phone is on standby."
          : allowLyncrNetworkFallback && routingStrategy === "hybrid_fallback"
            ? "If your team misses, the Lyncr network can pick up."
            : null

  return (
    <section id="dash-call-flow" className="scroll-mt-28 min-h-0 overflow-x-clip md:scroll-mt-24">
      {!callFlowUiReady && businessNumbers.length === 0 ? (
        <WhoRingsConsole
          ringsNow="…"
          ifNoAnswer="…"
          statusLabel="…"
          onOpenWhoAnswers={openWhoAnswers}
          onOpenGreetings={openScriptEditor}
          onOpenAbout={() => setDashboardStoryKey("dashboard-call-flow")}
          loading
        />
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
        <div className="space-y-3">
          <AdminRoutingOverrideNotice
            active={adminOverrideActive}
            phone={adminRoutingOverridePhone?.trim() ?? ""}
          />
          {/* Live queue first glance when Busy — collapses to null/quiet when empty. */}
          <HoldQueueWaitingCard showEmptyHint={presenceBypass} />
          <WhoRingsConsole
            ringsNow={ringsNowStrip.ringsNow}
            ifNoAnswer={ringsNowStrip.ifNoAnswer}
            statusLabel={ringsNowStrip.statusLabel}
            detailHint={detailHint}
            onOpenWhoAnswers={openWhoAnswers}
            onOpenGreetings={openScriptEditor}
            onOpenAbout={() => setDashboardStoryKey("dashboard-call-flow")}
            loading={routingLineDetailLoading}
          />
        </div>
      )}

      {/*
        Alerts — component returns null when empty (no spacer div).
        Do NOT wrap with always-on mt-3: an empty wrapper sat between Who rings and Available.
        When alerts render, the card adds its own top margin (see JustFinishedReviewCard).
      */}
      <JustFinishedReviewCard compact />
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
  // Amber is Settings-only — never list it in the sticky shop-line picker.
  const shopLines = customerFacingPhoneLines(businessNumbers)

  // Shared row layout; bare mode lets the sticky nav wrapper supply padding/border.
  const rowClass = bare
    ? "flex w-full min-w-0 items-center gap-2 sm:gap-3"
    : "flex w-full items-center gap-2 border-b border-slate-900/80 px-2 py-2.5 sm:gap-3"

  if (shopLines.length === 0) {
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
          businessNumbers={shopLines}
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
      {/* Fixed-size spinner slot so Live & Connected row doesn’t jump when loading flips. */}
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden={!loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading line" />
        ) : null}
      </span>
      {/* CSS hide on desktop — avoids useIsMobile SSR flash that pops “Lines” in after refresh. */}
      <button
        type="button"
        onClick={openManageModal}
        className={cn(
          "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 md:hidden",
          MOBILE_TAP_TARGET
        )}
      >
        Lines
      </button>
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
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 max-w-full flex-1 basis-[min(100%,12rem)]">
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {label}
            </p>
            <p className="break-all text-base font-semibold tabular-nums text-slate-100 sm:truncate">
              {/* Never paint "" — empty vs phone digits is React #418 on hydrate. */}
              {display || "\u00A0"}
            </p>
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
            <p className="truncate text-base font-semibold tabular-nums text-slate-100">{display || "\u00A0"}</p>
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
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-slate-850/60 bg-slate-900/30 px-3 py-2.5">
        <div className="min-w-0 max-w-full flex-1 basis-[min(100%,11rem)]">
          <p className="truncate text-[10px] font-medium text-zinc-500">{label}</p>
          <p className="break-all text-sm font-semibold text-foreground sm:truncate">{display || "\u00A0"}</p>
        </div>
        <LineRoutingStatus
          routingStrategy={routingStrategy}
          subscriptionActive={subscriptionActive}
          lineCarrierLive={lineCarrierLive}
          activeCallCount={activeCallCount}
          className="max-w-full shrink min-w-0"
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
        <span className="text-base text-foreground">{display || "\u00A0"}</span>
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
              <p className="truncate text-sm font-semibold text-foreground">{display || "\u00A0"}</p>
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
            <span className="text-base font-semibold text-foreground">{display || "\u00A0"}</span>
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
