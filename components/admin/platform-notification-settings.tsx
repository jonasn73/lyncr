"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { AdminNotificationPreferences } from "@/lib/types"
import { DEFAULT_ADMIN_NOTIFICATION_PREFERENCES } from "@/lib/admin-notification-preferences"

type PreferenceRow = {
  key: keyof AdminNotificationPreferences
  label: string
  description: string
}

const SECTIONS: { title: string; rows: PreferenceRow[] }[] = [
  {
    title: "SMS Alerts",
    rows: [
      {
        key: "sms_local_job_assignments",
        label: "Local Job Assignments",
        description: "Text alerts when a nearby job is assigned or dispatched to your roster.",
      },
      {
        key: "sms_global_out_of_state_bookings",
        label: "Global Out-of-State Bookings",
        description: "Text alerts for bookings outside your home service state.",
      },
    ],
  },
  {
    title: "App Push Notifications",
    rows: [
      {
        key: "push_live_inbound_ringing",
        label: "Live Inbound Ringing",
        description: "In-app buzz and sounds when a new call hits your business lines.",
      },
      {
        key: "push_operator_dispositions",
        label: "Operator Dispositions",
        description: "Toasts and pings when receptionists log booked jobs or dispositions.",
      },
    ],
  },
  {
    title: "Email Reports",
    rows: [
      {
        key: "email_daily_revenue_digest",
        label: "Daily Revenue / Talk-Time Digest",
        description: "Morning summary of revenue, talk time, and agent utilization.",
      },
      {
        key: "email_system_fallback_alerts",
        label: "System Fallback Alerts",
        description: "Email when routing fails over to AI, voicemail, or a carrier rejects a port.",
      },
    ],
  },
]

export const PlatformNotificationSettings = memo(function PlatformNotificationSettings({
  variant = "admin",
  className,
}: {
  variant?: "admin" | "dashboard"
  className?: string
}) {
  const { toast } = useToast()
  const [prefs, setPrefs] = useState<AdminNotificationPreferences>(DEFAULT_ADMIN_NOTIFICATION_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [savingKey, setSavingKey] = useState<keyof AdminNotificationPreferences | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/admin/notification-preferences", { credentials: "include" })
        if (res.status === 403) {
          if (!cancelled) setAllowed(false)
          return
        }
        const json = (await res.json().catch(() => ({}))) as {
          data?: { preferences?: AdminNotificationPreferences }
        }
        if (!res.ok) throw new Error((json as { error?: string }).error || "Could not load settings")
        if (!cancelled) {
          setAllowed(true)
          if (json.data?.preferences) setPrefs(json.data.preferences)
        }
      } catch {
        if (!cancelled) setAllowed(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveToggle = useCallback(
    async (key: keyof AdminNotificationPreferences, enabled: boolean) => {
      const previous = prefs[key]
      setPrefs((current) => ({ ...current, [key]: enabled }))
      setSavingKey(key)
      try {
        const res = await fetch("/api/admin/notification-preferences", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, enabled }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: { preferences?: AdminNotificationPreferences }
        }
        if (!res.ok) throw new Error(json.error || "Could not save setting")
        if (json.data?.preferences) setPrefs(json.data.preferences)
        toast({ title: "Setting saved" })
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("zing-admin-notification-preferences-changed", {
              detail: { preferences: json.data?.preferences ?? { ...prefs, [key]: enabled } },
            })
          )
        }
      } catch (e) {
        setPrefs((current) => ({ ...current, [key]: previous }))
        toast({
          title: "Could not save setting",
          description: e instanceof Error ? e.message : "Try again in a moment.",
          variant: "destructive",
        })
      } finally {
        setSavingKey(null)
      }
    },
    [prefs, toast]
  )

  const isAdminChrome = variant === "admin"

  if (!loading && !allowed) return null

  return (
    <Card
      className={cn(
        isAdminChrome ? "border-slate-800 bg-slate-900/40 text-slate-100" : "border-border bg-card",
        className
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className={cn("text-base", isAdminChrome && "text-slate-100")}>
          Notification Settings
        </CardTitle>
        <CardDescription className={cn(isAdminChrome && "text-slate-400")}>
          Platform-owner channels only — receptionists and field techs never see this panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading notification settings…
          </div>
        ) : (
          SECTIONS.map((section) => (
            <div key={section.title} className="space-y-3">
              <h3
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  isAdminChrome ? "text-slate-400" : "text-muted-foreground"
                )}
              >
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.rows.map((row) => {
                  const busy = savingKey === row.key
                  return (
                    <div
                      key={row.key}
                      className={cn(
                        "flex items-start justify-between gap-4 rounded-lg border px-3 py-3",
                        isAdminChrome ? "border-slate-800 bg-slate-950/40" : "border-border/70 bg-muted/20"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", isAdminChrome && "text-slate-100")}>
                          {row.label}
                        </p>
                        <p className={cn("mt-0.5 text-xs leading-snug", isAdminChrome ? "text-slate-400" : "text-muted-foreground")}>
                          {row.description}
                        </p>
                      </div>
                      <Switch
                        checked={prefs[row.key]}
                        disabled={busy}
                        aria-label={row.label}
                        onCheckedChange={(checked) => void saveToggle(row.key, checked)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
})
