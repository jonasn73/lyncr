"use client"

// Rapid license plate lookup — fills Y/M/M and hidden VIN/trim on the intake vehicle step.

import { useState } from "react"
import { Loader2, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { US_PLATE_STATES } from "@/lib/vehicle-plate-lookup"
import type { PlateLookupResult } from "@/lib/vehicle-plate-lookup"

type VehiclePlateLookupFieldProps = {
  plateNumber: string
  plateState: string
  onPlateNumberChange: (value: string) => void
  onPlateStateChange: (value: string) => void
  onLookupSuccess: (result: PlateLookupResult) => void
  disabled?: boolean
}

export function VehiclePlateLookupField({
  plateNumber,
  plateState,
  onPlateNumberChange,
  onPlateStateChange,
  onLookupSuccess,
  disabled,
}: VehiclePlateLookupFieldProps) {
  const [expanded, setExpanded] = useState(Boolean(plateNumber.trim() || plateState.trim()))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runLookup = async () => {
    const plate = plateNumber.trim()
    const state = plateState.trim()
    if (!plate || !state) {
      setError("Enter the plate number and state.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ plate, state })
      const res = await fetch(`/api/vehicle/plate-lookup?${q}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { data?: PlateLookupResult; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Plate lookup failed")
      if (!json.data?.vehicle_make) throw new Error(json.error ?? "No vehicle found for this plate.")
      onLookupSuccess(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plate lookup failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border/50 bg-background/50 p-2.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          "flex w-full items-center justify-between gap-2 text-left text-[11px] font-semibold text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <span>Lookup by license plate</span>
        <span className="text-[10px] font-medium text-muted-foreground">{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded ? (
        <div className="grid gap-2">
          <p className="text-[10px] text-muted-foreground">
            Faster than a 17-digit VIN — pulls year, make, model, and trim when registration data is available.
          </p>
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            <label className="grid gap-1 text-[11px]">
              <span className="font-medium text-foreground">Plate number</span>
              <input
                className="h-9 rounded-lg border border-border/70 bg-background px-2 font-mono text-sm uppercase tracking-wide text-foreground"
                value={plateNumber}
                disabled={disabled || loading}
                placeholder="ABC2020"
                onChange={(e) => onPlateNumberChange(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void runLookup()
                  }
                }}
              />
            </label>
            <label className="grid gap-1 text-[11px]">
              <span className="font-medium text-foreground">State</span>
              <select
                className="h-9 rounded-lg border border-border/70 bg-background px-1.5 text-sm text-foreground"
                value={plateState}
                disabled={disabled || loading}
                onChange={(e) => onPlateStateChange(e.target.value)}
              >
                <option value="">—</option>
                {US_PLATE_STATES.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.code}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() => void runLookup()}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary",
              "hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
            {loading ? "Looking up…" : "Look up vehicle"}
          </button>
          {error ? (
            <p className="text-[10px] text-amber-200">{error}</p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Demo plates: KY·ABC2020, TN·HOND18, TX·EQN19
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
