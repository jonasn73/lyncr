"use client"

// Client-only header control for platform admins (is_platform_admin = true).

import { memo, useCallback, useState } from "react"
import { Loader2 } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { MasterToggleMode } from "@/lib/types"

export type MasterProfileToggleProps = {
  /** Starting mode from the server — only passed when the user is a platform admin. */
  initialMode: MasterToggleMode
}

/** Three-way switch: Tech (field alerts), Admin (silent metrics), Passive (exceptions only). */
export const MasterProfileToggle = memo(function MasterProfileToggle({
  initialMode,
}: MasterProfileToggleProps) {
  // Local copy of the mode so the UI updates instantly while saving.
  const [mode, setMode] = useState<MasterToggleMode>(initialMode)
  // True while the PUT request is in flight.
  const [busy, setBusy] = useState(false)

  // Send the chosen mode to the server and roll back on failure.
  const saveMode = useCallback(async (next: MasterToggleMode) => {
    if (next === mode || busy) return
    const previous = mode
    setMode(next)
    setBusy(true)
    try {
      const res = await fetch("/api/admin/toggle-profile", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { master_toggle_mode?: MasterToggleMode }
      }
      if (!res.ok) throw new Error(json.error || "Could not save profile")
      const saved = json.data?.master_toggle_mode ?? next
      setMode(saved)
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("zing-master-toggle-mode-changed", { detail: { mode: saved } })
        )
      }
    } catch {
      setMode(previous)
    } finally {
      setBusy(false)
    }
  }, [mode, busy])

  return (
    <div
      className={cn(
        "flex max-w-[min(100%,20rem)] items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 px-1 py-0.5 shadow-sm",
        busy && "opacity-80"
      )}
      aria-label="Platform owner notification profile"
      title="Platform owner quick-toggle — controls global alerts"
    >
      {busy ? (
        <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : null}
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => {
          if (v === "tech" || v === "admin" || v === "passive") void saveMode(v)
        }}
        variant="outline"
        size="sm"
        className="h-8 w-full border-0 bg-transparent shadow-none"
        disabled={busy}
      >
        <ToggleGroupItem value="tech" className="h-7 px-2 text-[10px] sm:text-xs" aria-label="Tech mode">
          Tech
        </ToggleGroupItem>
        <ToggleGroupItem value="admin" className="h-7 px-2 text-[10px] sm:text-xs" aria-label="Admin mode">
          Admin
        </ToggleGroupItem>
        <ToggleGroupItem value="passive" className="h-7 px-2 text-[10px] sm:text-xs" aria-label="Passive mode">
          Passive
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
})
