"use client"

// Available ↔ Unavailable for the receptionist Home tab.
// Available = eligible to ring IF the owner already chose you under Who answers.
// Unavailable = skip you even when selected; owner backup runs instead.
// This toggle does NOT change Who answers — only the business owner does that.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"

export function ReceptionistAvailabilityToggle({
  isAvailable,
  businessName,
  onChange,
}: {
  isAvailable: boolean
  businessName: string
  onChange: (next: boolean) => void
}) {
  const [current, setCurrent] = useState(isAvailable)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync from server after parent reload — never setState during render (#185).
  useEffect(() => {
    if (!saving) setCurrent(isAvailable)
  }, [isAvailable, saving])

  async function toggle(next: boolean) {
    if (next === current || saving) return
    setSaving(true)
    setError(null)
    const previous = current
    setCurrent(next)
    try {
      const res = await fetch("/api/receptionist/availability", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: next }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not update availability")
      onChange(next)
    } catch (e) {
      setCurrent(previous)
      setError(e instanceof Error ? e.message : "Could not update availability")
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePanel
      className={cn(
        "p-5",
        current ? "border-emerald-500/35 bg-emerald-950/15" : "border-zinc-700/80 bg-zinc-900/40"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Your status</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {current ? "Available" : "Unavailable"}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {current ? (
              <>
                You&apos;re eligible for <span className="font-medium text-zinc-200">{businessName}</span>{" "}
                when the owner has set you under Who answers. This does not choose you by itself.
              </>
            ) : (
              <>
                You won&apos;t get rings for{" "}
                <span className="font-medium text-zinc-200">{businessName}</span> — calls use the
                owner&apos;s backup instead. Who answers is still the owner&apos;s choice.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saving ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden /> : null}
          <Switch
            checked={current}
            disabled={saving}
            onCheckedChange={(checked) => void toggle(checked)}
            aria-label={current ? "Set unavailable" : "Set available"}
          />
        </div>
      </div>
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </WorkspacePanel>
  )
}
