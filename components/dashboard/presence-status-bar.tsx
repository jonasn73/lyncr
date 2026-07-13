"use client"

// Sticky Presence bar on Lines — Available / On-Job / Closed.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { PresenceStatus } from "@/lib/account-presence"

const OPTIONS: {
  value: PresenceStatus
  label: string
  hint: string
}[] = [
  {
    value: "AVAILABLE",
    label: "Available",
    hint: "Ring your cell first",
  },
  {
    value: "ON_JOB",
    label: "On-Job",
    hint: "Busy IVR + booking text",
  },
  {
    value: "CLOSED",
    label: "Closed",
    hint: "No ring — booking link only",
  },
]

export function PresenceStatusBar({ className }: { className?: string }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<PresenceStatus>("AVAILABLE")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<PresenceStatus | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/presence", { credentials: "include" })
      const json = (await res.json()) as {
        data?: { presence_status?: string }
      }
      const raw = String(json.data?.presence_status || "AVAILABLE").toUpperCase()
      if (raw === "ON_JOB") setStatus("ON_JOB")
      else if (raw === "CLOSED") setStatus("CLOSED")
      else setStatus("AVAILABLE")
    } catch {
      setStatus("AVAILABLE")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function select(next: PresenceStatus) {
    if (next === status && !saving) return
    const prev = status
    setStatus(next)
    setSaving(next)
    try {
      const res = await fetch("/api/routing/presence", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presence_status: next }),
      })
      const json = (await res.json()) as {
        error?: string
        migration?: string
        data?: { presence_status?: string }
      }
      if (!res.ok) {
        setStatus(prev)
        toast({
          title: "Could not update presence",
          description: json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      const saved = String(json.data?.presence_status || next).toUpperCase()
      if (saved === "ON_JOB") setStatus("ON_JOB")
      else if (saved === "CLOSED") setStatus("CLOSED")
      else setStatus("AVAILABLE")
    } catch (e) {
      setStatus(prev)
      toast({
        title: "Could not update presence",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div
      className={cn(
        "w-full border-b border-zinc-800/90 bg-slate-950/95 px-3 py-2.5",
        className
      )}
      aria-label="Presence status"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Presence
        </p>
        {loading || saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-hidden />
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => {
          const active = status === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={loading || saving != null}
              onClick={() => void select(opt.value)}
              className={cn(
                "flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-colors",
                active
                  ? opt.value === "AVAILABLE"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                    : opt.value === "ON_JOB"
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-100"
                      : "border-sky-500/50 bg-sky-500/15 text-sky-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              )}
            >
              <span className="text-sm font-semibold leading-tight">{opt.label}</span>
              <span className="mt-0.5 hidden text-[9px] leading-tight text-zinc-500 sm:block">
                {opt.hint}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
