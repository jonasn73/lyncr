"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Clock, Phone, PhoneIncoming, PhoneMissed, Truck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { formatAvgTalkTime } from "@/lib/daily-call-telemetry"
import { isDashboardVisibleLineStatus, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { isActivePortingOrder } from "@/lib/porting-lifecycle"
import { useJobPoolQuery } from "@/lib/hooks/use-job-pool-query"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { PortingOrder } from "@/lib/types"

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
  const { jobs: poolJobs, mutate: mutatePool } = useJobPoolQuery(activeOrganizationId)
  const [metricsReady, setMetricsReady] = useState(false)
  const [pendingPorts, setPendingPorts] = useState(0)
  const [dailyCalls, setDailyCalls] = useState(0)
  const [missedCalls, setMissedCalls] = useState(0)
  const [avgTalkDisplay, setAvgTalkDisplay] = useState("0:00")
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)

  const activeLines = businessNumbers.filter(
    (line) => isDashboardVisibleLineStatus(line.status) && line.status === "active"
  ).length

  const queueVolume = poolJobs.length

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
          avg_talk_time_display?: string
          owner_user_id?: string
        }
      }
      const data = json.data
      if (!data) return
      setDailyCalls(Number(data.daily_calls ?? 0))
      setMissedCalls(Number(data.missed_calls ?? 0))
      setAvgTalkDisplay(data.avg_talk_time_display ?? formatAvgTalkTime(0))
      if (data.owner_user_id) setOwnerUserId(String(data.owner_user_id))
    } catch {
      setDailyCalls(0)
      setMissedCalls(0)
      setAvgTalkDisplay("0:00")
    }
  }, [activeOrganizationId])

  const refreshMetrics = useCallback(async () => {
    const orgQs = organizationQueryString(activeOrganizationId)
    try {
      const [portsRes] = await Promise.all([
        fetch(`/api/porting/orders${orgQs}${orgQs ? "&" : "?"}active=1`, { credentials: "include" }),
        refreshCallMetrics(),
        mutatePool(),
      ])
      const portsJson = portsRes.ok
        ? ((await portsRes.json()) as { data?: { orders?: PortingOrder[] } })
        : null
      const orders = Array.isArray(portsJson?.data?.orders) ? portsJson.data.orders : []
      setPendingPorts(orders.filter(isActivePortingOrder).length)
    } catch {
      setPendingPorts(0)
    } finally {
      setMetricsReady(true)
    }
  }, [activeOrganizationId, refreshCallMetrics, mutatePool])

  useEffect(() => {
    void refreshMetrics()
  }, [refreshMetrics])

  useEffect(() => {
    const onChanged = () => void refreshMetrics()
    window.addEventListener("zing-porting-orders-changed", onChanged)
    window.addEventListener("lyncr-workspace-data-changed", onChanged)
    return () => {
      window.removeEventListener("zing-porting-orders-changed", onChanged)
      window.removeEventListener("lyncr-workspace-data-changed", onChanged)
    }
  }, [refreshMetrics])

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
        "flex flex-wrap items-center gap-2 rounded-2xl border border-white/5 bg-neutral-950/40 px-3 py-2.5 backdrop-blur-md transition-opacity duration-200",
        metricsReady ? "opacity-100" : "opacity-0",
        className
      )}
      aria-label="Workspace telemetry"
      aria-busy={!metricsReady}
    >
      <TelemetryPill label="Active lines" value={activeLines} icon={Phone} tone="teal" />
      <TelemetryPill label="Daily calls" value={dailyCalls} icon={PhoneIncoming} />
      <TelemetryPill
        label="Missed calls"
        value={missedCalls}
        icon={PhoneMissed}
        tone={missedCalls > 0 ? "amber" : "default"}
        valueClassName={missedCalls > 0 ? "text-amber-400" : undefined}
      />
      <TelemetryPill label="Avg talk time" value={avgTalkDisplay} icon={Clock} />
      <TelemetryPill
        label="Pending ports"
        value={pendingPorts}
        icon={Truck}
        tone={pendingPorts > 0 ? "amber" : "default"}
      />
      <TelemetryPill label="Queue volume" value={queueVolume} icon={Activity} />
    </section>
  )
})
