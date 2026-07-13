"use client"

// Caller ID card — spam shield + CNAM utilities (compact settings rows).

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { Switch } from "@/components/ui/switch"
import { routingTelemetryQueryString } from "@/lib/telemetry-timezone"
import { cn } from "@/lib/utils"

type CallerIdUtilityPrefs = {
  spamShieldEnabled: boolean
  enhancedCnamEnabled: boolean
}

const DEFAULT_PREFS: CallerIdUtilityPrefs = {
  spamShieldEnabled: true,
  enhancedCnamEnabled: true,
}

function prefsStorageKey(organizationId: string | null | undefined): string {
  return `lyncr:caller-id-utilities:${organizationId ?? "default"}`
}

function readPrefs(organizationId: string | null | undefined): CallerIdUtilityPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS }
  try {
    const raw = window.localStorage.getItem(prefsStorageKey(organizationId))
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<CallerIdUtilityPrefs>
    return {
      spamShieldEnabled: parsed.spamShieldEnabled !== false,
      enhancedCnamEnabled: parsed.enhancedCnamEnabled !== false,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(organizationId: string | null | undefined, prefs: CallerIdUtilityPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(prefsStorageKey(organizationId), JSON.stringify(prefs))
  } catch {
    /* private mode / quota */
  }
}

function UtilityRow({
  title,
  description,
  enabled,
  onEnabledChange,
  id,
  belowDescription,
}: {
  title: string
  description: string
  enabled: boolean
  onEnabledChange: (next: boolean) => void
  id: string
  /** Optional muted metric line under the description (e.g. spam blocks this week). */
  belowDescription?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-900 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-xs font-semibold text-slate-200">
          {title}
        </label>
        <p className="mt-0.5 text-[11px] font-normal text-slate-500">{description}</p>
        {belowDescription}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {enabled ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Active</span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Off</span>
        )}
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={title}
        />
      </div>
    </div>
  )
}

/** Compact Caller ID utilities card for the Lines dashboard. */
export function CallerIdUtilitiesCard({
  organizationId,
  onOpenTips,
  className,
}: {
  organizationId?: string | null
  onOpenTips: () => void
  className?: string
}) {
  const [prefs, setPrefs] = useState<CallerIdUtilityPrefs>(DEFAULT_PREFS)
  // High-risk spam rings blocked this calendar week (status = blocked_spam).
  const [spamCount, setSpamCount] = useState<number | null>(null)

  useEffect(() => {
    setPrefs(readPrefs(organizationId))
  }, [organizationId])

  useEffect(() => {
    let cancelled = false
    const qs = routingTelemetryQueryString(organizationId)
    void fetch(`/api/routing/tracking-metrics${qs}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("metrics")
        const json = (await r.json()) as { data?: { spam_blocked_this_week?: number } }
        if (!cancelled) {
          setSpamCount(Number(json.data?.spam_blocked_this_week ?? 0))
        }
      })
      .catch(() => {
        if (!cancelled) setSpamCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [organizationId])

  const updatePref = useCallback(
    (patch: Partial<CallerIdUtilityPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch }
        writePrefs(organizationId, next)
        return next
      })
    },
    [organizationId]
  )

  return (
    <section
      id="routing-tips"
      className={cn(
        "rounded-2xl border border-border/60 bg-muted/15 px-4 py-3 sm:px-6 sm:py-4",
        className
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Caller ID</h2>
        <SheetInfoTrigger
          onPress={onOpenTips}
          label="Caller ID"
          className="h-8 w-8 shrink-0"
        />
      </div>

      <div className="mt-1">
        <UtilityRow
          id="caller-id-spam-shield"
          title="Spam & Robocall Shield"
          description="Auto-reject verified high-risk spam"
          enabled={prefs.spamShieldEnabled}
          onEnabledChange={(next) => updatePref({ spamShieldEnabled: next })}
          belowDescription={
            spamCount != null ? (
              <p className="mt-1 text-[10px] font-normal leading-snug text-slate-500">
                🛡️ {spamCount} high-risk calls blocked this week.
              </p>
            ) : null
          }
        />
        <UtilityRow
          id="caller-id-enhanced-cnam"
          title="Enhanced CNAM Lookup"
          description="Identify business names on incoming rings"
          enabled={prefs.enhancedCnamEnabled}
          onEnabledChange={(next) => updatePref({ enhancedCnamEnabled: next })}
        />
      </div>
    </section>
  )
}
