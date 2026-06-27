"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { CalendarRange, Clock, Phone, PhoneIncoming, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
import { WORKSPACE_MOBILE_BLEED } from "@/components/dashboard-workspace-ui"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { formatTalkDuration, formatTalkTime } from "@/lib/daily-call-telemetry"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import {
  emptyRoutingTelemetrySnapshot,
  readRoutingTelemetryCache,
  writeRoutingTelemetryCache,
} from "@/lib/routing-telemetry-cache"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { organizationQueryString } from "@/lib/workspace-organizations"
import {
  RoutingCallHistoryDialog,
  type CallHistoryFilter,
} from "@/components/dashboard/routing-call-history-dialog"

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal"
  valueClassName?: string
  /** When set, the pill becomes a clickable button that opens call history. */
  onClick?: () => void
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
  onClick,
}: TelemetryPillProps) {
  const sharedClasses = cn(
    "inline-flex min-w-[10.5rem] shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 md:min-w-0",
    "bg-neutral-950/50 backdrop-blur-sm transition-all duration-200",
    tone === "amber" && "border-amber-500/25 text-amber-100/90",
    tone === "teal" && "border-teal-500/25 text-teal-100/90",
    tone === "default" && "border-white/8 text-foreground/90",
    onClick && "cursor-pointer hover:bg-zinc-900/50"
  )

  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm font-bold tabular-nums text-foreground", valueClassName)}>{value}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          sharedClasses,
          "relative z-10 min-h-11 touch-manipulation",
          "hover:border-cyan-500/30 hover:bg-zinc-900/70 active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
        )}
        aria-label={`${label}: ${value}. Open call history.`}
      >
        {inner}
      </button>
    )
  }

  return <div className={sharedClasses}>{inner}</div>
}

export const RoutingTelemetryStrip = memo(function RoutingTelemetryStrip({
  businessNumbers,
  className,
}: {
  businessNumbers: DashboardBusinessNumber[]
  className?: string
}) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const cachedMetrics = useMemo(
    () => readRoutingTelemetryCache(activeOrganizationId) ?? emptyRoutingTelemetrySnapshot(),
    [activeOrganizationId]
  )
  const [dailyCalls, setDailyCalls] = useState(cachedMetrics.dailyCalls)
  const [missedCalls, setMissedCalls] = useState(cachedMetrics.missedCalls)
  const [dailyTalkSeconds, setDailyTalkSeconds] = useState(cachedMetrics.dailyTalkSeconds)
  const [weeklyTalkSeconds, setWeeklyTalkSeconds] = useState(cachedMetrics.weeklyTalkSeconds)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(cachedMetrics.ownerUserId)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<CallHistoryFilter>("daily")

  const dailyTalkDisplay = formatTalkTime(dailyTalkSeconds)
  const weeklyTalkDisplay = formatTalkDuration(weeklyTalkSeconds)

  const openCallHistory = useCallback((filter: CallHistoryFilter) => {
    setHistoryFilter(filter)
    setHistoryOpen(true)
  }, [])

  const activeLines = businessNumbers.filter(
    (line) => isDashboardVisibleLineStatus(line.status) && line.status === "active"
  ).length

  const workspaceLineSet = useMemo(() => {
    return new Set(
      businessNumbers
        .map((line) => line.number.replace(/\D/g, ""))
        .filter((digits) => digits.length >= 10)
    )
  }, [businessNumbers])

  const refreshCallMetrics = useCallback(async () => {
    const orgQs = organizationQueryString(activeOrganizationId)
    try {
      const res = await fetch(`/api/routing/telemetry${orgQs}`, { credentials: "include", cache: "no-store" })
      if (!res.ok) return
      const json = (await res.json()) as {
        data?: {
          daily_calls?: number
          missed_calls?: number
          daily_talk_seconds?: number
          weekly_talk_seconds?: number
          owner_user_id?: string
        }
      }
      const data = json.data
      if (!data) return
      const nextDaily = Number(data.daily_calls ?? 0)
      const nextMissed = Number(data.missed_calls ?? 0)
      const nextDailyTalkSeconds = Number(data.daily_talk_seconds ?? 0)
      const nextWeeklyTalkSeconds = Number(data.weekly_talk_seconds ?? 0)
      const nextOwnerId = data.owner_user_id ? String(data.owner_user_id) : null
      setDailyCalls(nextDaily)
      setMissedCalls(nextMissed)
      setDailyTalkSeconds(nextDailyTalkSeconds)
      setWeeklyTalkSeconds(nextWeeklyTalkSeconds)
      setOwnerUserId(nextOwnerId)
      writeRoutingTelemetryCache(activeOrganizationId, {
        dailyCalls: nextDaily,
        missedCalls: nextMissed,
        dailyTalkSeconds: nextDailyTalkSeconds,
        weeklyTalkSeconds: nextWeeklyTalkSeconds,
        ownerUserId: nextOwnerId,
      })
    } catch {
      /* Keep last cached values on transient errors — avoids flashing zeros. */
    }
  }, [activeOrganizationId])

  useEffect(() => {
    const snap = readRoutingTelemetryCache(activeOrganizationId) ?? emptyRoutingTelemetrySnapshot()
    setDailyCalls(snap.dailyCalls)
    setMissedCalls(snap.missedCalls)
    setDailyTalkSeconds(snap.dailyTalkSeconds)
    setWeeklyTalkSeconds(snap.weeklyTalkSeconds)
    setOwnerUserId(snap.ownerUserId)
    void refreshCallMetrics()
  }, [activeOrganizationId, refreshCallMetrics])

  useEffect(() => {
    const onChanged = () => void refreshCallMetrics()
    window.addEventListener("zing-porting-orders-changed", onChanged)
    window.addEventListener("lyncr-workspace-data-changed", onChanged)
    return () => {
      window.removeEventListener("zing-porting-orders-changed", onChanged)
      window.removeEventListener("lyncr-workspace-data-changed", onChanged)
    }
  }, [refreshCallMetrics])

  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return

    const channel = pusher.subscribe(`owner-${ownerUserId}`)
    const orgId =
      activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null

    const eventMatchesWorkspace = (payload: {
      organization_id?: string | null
      to_number?: string | null
    }) => {
      if (orgId && payload.organization_id && payload.organization_id !== orgId) return false
      if (payload.to_number) {
        const digits = payload.to_number.replace(/\D/g, "")
        if (workspaceLineSet.size > 0 && !workspaceLineSet.has(digits)) return false
      }
      return true
    }

    const onCallInitiated = (payload: {
      organization_id?: string | null
      to_number?: string | null
    }) => {
      if (!eventMatchesWorkspace(payload)) return
      setDailyCalls((prev) => prev + 1)
      void refreshCallMetrics()
    }

    const onCallCompleted = (payload: {
      organization_id?: string | null
      to_number?: string | null
    }) => {
      if (!eventMatchesWorkspace(payload)) return
      void refreshCallMetrics()
    }

    channel.bind("call-initiated", onCallInitiated)
    channel.bind("call-completed", onCallCompleted)
    return () => {
      channel.unbind("call-initiated", onCallInitiated)
      channel.unbind("call-completed", onCallCompleted)
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, activeOrganizationId, workspaceLineSet, refreshCallMetrics])

  return (
    <>
      <section
        className={cn(
          "flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-3 py-2 backdrop-blur-md [-ms-overflow-style:none] [scrollbar-width:none] sm:px-4 md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden",
          WORKSPACE_MOBILE_BLEED,
          className
        )}
        aria-label="Workspace telemetry"
      >
        <TelemetryPill label="Live lines" value={activeLines} icon={Phone} tone="teal" />
        <TelemetryPill
          label="Daily calls"
          value={dailyCalls}
          icon={PhoneIncoming}
          onClick={() => openCallHistory("daily")}
        />
        <TelemetryPill
          label="Missed calls"
          value={missedCalls}
          icon={PhoneMissed}
          tone={missedCalls > 0 ? "amber" : "default"}
          valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
          onClick={() => openCallHistory("missed")}
        />
        <TelemetryPill
          label="Daily talk"
          value={dailyTalkDisplay}
          icon={Clock}
          tone="teal"
          onClick={() => openCallHistory("daily_talk")}
        />
        <TelemetryPill
          label="Weekly talk"
          value={weeklyTalkDisplay}
          icon={CalendarRange}
          tone="teal"
          onClick={() => openCallHistory("weekly_talk")}
        />
      </section>

      <RoutingCallHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        filter={historyFilter}
        businessNumbers={businessNumbers}
        expectedTalkSeconds={
          historyFilter === "daily_talk"
            ? dailyTalkSeconds
            : historyFilter === "weekly_talk"
              ? weeklyTalkSeconds
              : undefined
        }
      />
    </>
  )
})
