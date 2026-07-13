"use client"

// Lines Call Flow — Missed Call Rescue toggle + IVR capacity auto-bypass threshold.

import { memo, useCallback, useEffect, useState } from "react"
import { MessageSquareText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD } from "@/lib/smart-overflow-autopilot"
import { formatRescueRevenueDollars } from "@/lib/dispatch-performance-formatters"
import { routingTelemetryQueryString } from "@/lib/telemetry-timezone"

export const MissedCallRescueCard = memo(function MissedCallRescueCard({
  compact = false,
  loading: parentLoading = false,
  capacityThreshold,
  confirmedJobsToday = 0,
  onCapacityThresholdChange,
  capacitySaving = false,
}: {
  compact?: boolean
  loading?: boolean
  /** Confirmed-jobs threshold for auto IVR bypass (account_settings). */
  capacityThreshold?: number
  confirmedJobsToday?: number
  onCapacityThresholdChange?: (next: number) => void
  capacitySaving?: boolean
}) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(true)
  // Dollars booked via public /book textback links (ai_leads quoted totals).
  const [rescueTotalCents, setRescueTotalCents] = useState(0)
  const [localCapacity, setLocalCapacity] = useState(
    capacityThreshold ?? SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD
  )

  useEffect(() => {
    if (typeof capacityThreshold === "number") {
      setLocalCapacity(capacityThreshold)
    }
  }, [capacityThreshold])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = routingTelemetryQueryString(activeOrganizationId)
      const [toggleRes, metricsRes] = await Promise.all([
        fetch("/api/routing/missed-call-rescue", {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`/api/routing/tracking-metrics${qs}`, {
          credentials: "include",
          cache: "no-store",
        }),
      ])
      const toggleJson = (await toggleRes.json()) as {
        data?: { missed_call_textback_enabled?: boolean }
      }
      setEnabled(toggleJson.data?.missed_call_textback_enabled !== false)
      if (metricsRes.ok) {
        const metricsJson = (await metricsRes.json()) as {
          data?: { textback_rescue_revenue_cents?: number }
        }
        setRescueTotalCents(Number(metricsJson.data?.textback_rescue_revenue_cents ?? 0))
      }
    } catch {
      // Keep default on.
    } finally {
      setLoading(false)
    }
  }, [activeOrganizationId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleToggle(next: boolean) {
    setEnabled(next)
    setSaving(true)
    try {
      const res = await fetch("/api/routing/missed-call-rescue", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missed_call_textback_enabled: next }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string; migration?: string }
        setEnabled(!next)
        toast({
          title: "Could not update Missed Call Rescue",
          description: json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      toast({
        title: next ? "Missed Call Rescue on" : "Missed Call Rescue off",
        description: next
          ? "Unanswered callers get your booking link by text."
          : "No automatic textback after missed calls.",
      })
    } catch (e) {
      setEnabled(!next)
      toast({
        title: "Could not update Missed Call Rescue",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  function commitCapacity(raw: number) {
    const next = Math.max(1, Math.min(40, Math.floor(raw) || 1))
    setLocalCapacity(next)
    onCapacityThresholdChange?.(next)
  }

  const busy = loading || parentLoading || saving
  const showCapacity = typeof onCapacityThresholdChange === "function"
  const rescueBadge = (
    <p className="mt-1.5 text-[10px] font-medium leading-snug text-amber-200/85">
      ✨ Rescued Revenue: {formatRescueRevenueDollars(rescueTotalCents)} generated via automated
      textback links.
    </p>
  )

  const capacityField = showCapacity ? (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
      <label
        htmlFor="ivr-capacity-threshold"
        className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] leading-snug text-zinc-300"
      >
        <span className="min-w-0 flex-1 font-medium">
          Auto-Bypass to IVR when confirmed daily jobs reach:
        </span>
        <input
          id="ivr-capacity-threshold"
          type="number"
          min={1}
          max={40}
          disabled={busy || capacitySaving}
          value={localCapacity}
          onChange={(e) => setLocalCapacity(Number(e.target.value) || 1)}
          onBlur={() => commitCapacity(localCapacity)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur()
            }
          }}
          className="h-9 w-14 shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-center text-sm font-semibold tabular-nums text-foreground focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
        />
      </label>
      <p className="mt-1.5 text-[10px] text-zinc-500">
        Today: {confirmedJobsToday} confirmed
        {capacitySaving ? " · Saving…" : ""}
      </p>
    </div>
  ) : null

  if (compact) {
    return (
      <div
        className={cn(
          "w-full rounded-xl border px-3 py-2.5 text-left",
          enabled
            ? "border-emerald-500/30 bg-emerald-950/10"
            : "border-slate-850/60 bg-slate-900/30",
          busy && "opacity-60"
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-primary/12 text-primary"
            )}
          >
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Automation · Missed Call Rescue
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {enabled ? "Textback on" : "Textback off"}
            </p>
            <p className="text-xs leading-snug text-zinc-500">
              Instantly texts a booking link when a call goes unanswered.
            </p>
            {rescueBadge}
          </div>
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={(v) => void handleToggle(v)}
            aria-label="Missed Call Rescue textback"
            className="shrink-0 data-[state=checked]:bg-emerald-500"
          />
        </div>
        {capacityField}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative flex w-full flex-1 flex-col rounded-2xl border p-4 text-left transition-colors sm:p-5",
        enabled
          ? "border-emerald-500/30 bg-emerald-950/10"
          : "border-border/70 bg-card/80 hover:border-border",
        busy && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
              enabled
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                : "border-primary/25 bg-primary/10 text-primary"
            )}
          >
            <MessageSquareText className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Automation · Missed Call Rescue
            </p>
            <p className="mt-0.5 text-base font-semibold text-foreground">
              {enabled ? "Textback on" : "Textback off"}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(v) => void handleToggle(v)}
          aria-label="Missed Call Rescue textback"
          className="shrink-0 data-[state=checked]:bg-emerald-500"
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">
        Instantly sends a text message with your secure booking link to any customer whose phone call
        goes unanswered.
      </p>
      {rescueBadge}
      {capacityField}
    </div>
  )
})
