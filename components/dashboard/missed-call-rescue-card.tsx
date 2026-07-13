"use client"

// Lines Call Flow — Missed Call Rescue toggle (replaces Voice & AI Greetings row).

import { memo, useCallback, useEffect, useState } from "react"
import { MessageSquareText } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

export const MissedCallRescueCard = memo(function MissedCallRescueCard({
  compact = false,
  loading: parentLoading = false,
}: {
  compact?: boolean
  loading?: boolean
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/missed-call-rescue", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: { missed_call_textback_enabled?: boolean }
      }
      setEnabled(json.data?.missed_call_textback_enabled !== false)
    } catch {
      // Keep default on.
    } finally {
      setLoading(false)
    }
  }, [])

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

  const busy = loading || parentLoading || saving

  if (compact) {
    return (
      <div
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left",
          enabled
            ? "border-emerald-500/30 bg-emerald-950/10"
            : "border-slate-850/60 bg-slate-900/30",
          busy && "opacity-60"
        )}
      >
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
            Instantly sends a text message with your secure booking link to any customer whose phone
            call goes unanswered.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(v) => void handleToggle(v)}
          aria-label="Missed Call Rescue textback"
          className="shrink-0 data-[state=checked]:bg-emerald-500"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative flex min-h-[9.5rem] w-full flex-1 flex-col rounded-2xl border p-4 text-left transition-colors sm:p-5",
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
    </div>
  )
})
