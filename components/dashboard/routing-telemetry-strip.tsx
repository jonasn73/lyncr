"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { CalendarRange, Clock, Phone, PhoneIncoming, PhoneMissed } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { formatTalkDuration } from "@/lib/daily-call-telemetry"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import {
  emptyRoutingTelemetrySnapshot,
  readRoutingTelemetryCache,
  writeRoutingTelemetryCache,
} from "@/lib/routing-telemetry-cache"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { organizationQueryString } from "@/lib/workspace-organizations"

type TelemetryPillProps = {
  label: string
  value: string | number
  icon: typeof Phone
  tone?: "default" | "amber" | "teal"
  valueClassName?: string
}

function TelemetryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  valueClassName,
}: TelemetryPillProps) {
  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5",
        "bg-neutral-950/50 backdrop-blur-sm transition-colors duration-200",
        tone === "amber" && "border-amber-500/25 text-amber-100/90",
        tone === "teal" && "border-teal-500/25 text-teal-100/90",
        tone === "default" && "border-white/8 text-foreground/90"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm font-bold tabular-nums text-foreground", valueClassName)}>{value}</span>
    </div>
  )
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
  const [dailyTalkDisplay, setDailyTalkDisplay] = useState(cachedMetrics.dailyTalkDisplay)
  const [weeklyTalkDisplay, setWeeklyTalkDisplay] = useState(cachedMetrics.weeklyTalkDisplay)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(cachedMetrics.ownerUserId)

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
          daily_talk_time_display?: string
          weekly_talk_time_display?: string
          owner_user_id?: string
        }
      }
      const data = json.data
      if (!data) return
      const nextDaily = Number(data.daily_calls ?? 0)
      const nextMissed = Number(data.missed_calls ?? 0)
      const nextDailyTalk = data.daily_talk_time_display ?? formatTalkDuration(0)
      const nextWeeklyTalk = data.weekly_talk_time_display ?? formatTalkDuration(0)
      const nextOwnerId = data.owner_user_id ? String(data.owner_user_id) : null
      setDailyCalls(nextDaily)
      setMissedCalls(nextMissed)
      setDailyTalkDisplay(nextDailyTalk)
      setWeeklyTalkDisplay(nextWeeklyTalk)
      setOwnerUserId(nextOwnerId)
      writeRoutingTelemetryCache(activeOrganizationId, {
        dailyCalls: nextDaily,
        missedCalls: nextMissed,
        dailyTalkDisplay: nextDailyTalk,
        weeklyTalkDisplay: nextWeeklyTalk,
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
    setDailyTalkDisplay(snap.dailyTalkDisplay)
    setWeeklyTalkDisplay(snap.weeklyTalkDisplay)
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
    <section
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-3 py-2.5 backdrop-blur-md",
        className
      )}
      aria-label="Workspace telemetry"
    >
      <TelemetryPill label="Live lines" value={activeLines} icon={Phone} tone="teal" />
      <TelemetryPill label="Daily calls" value={dailyCalls} icon={PhoneIncoming} />
      <TelemetryPill
        label="Missed calls"
        value={missedCalls}
        icon={PhoneMissed}
        tone={missedCalls > 0 ? "amber" : "default"}
        valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
      />
      <TelemetryPill label="Daily talk" value={dailyTalkDisplay} icon={Clock} tone="teal" />
      <TelemetryPill label="Weekly talk" value={weeklyTalkDisplay} icon={CalendarRange} />
    </section>
  )
})
