"use client"

// 17-digit VIN → auto-fill Year / Make / Model via NHTSA vPIC.

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, ScanLine } from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizeVin } from "@/lib/nhtsa-vpic"
import type { VehicleCascadeValue } from "@/components/vehicle-picker-cascade"

const inputClass =
  "w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

type VinLookupFieldProps = {
  value: string
  onVinChange: (vin: string) => void
  onVehicleResolved: (vehicle: VehicleCascadeValue) => void
  placeholder?: string
  disabled?: boolean
}

export function VinLookupField({
  value,
  onVinChange,
  onVehicleResolved,
  placeholder = "17-character VIN",
  disabled,
}: VinLookupFieldProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matched, setMatched] = useState(false)
  const lastDecoded = useRef("")
  const onResolvedRef = useRef(onVehicleResolved)
  onResolvedRef.current = onVehicleResolved

  useEffect(() => {
    const vin = normalizeVin(value)
    if (vin.length !== 17 || vin === lastDecoded.current) return
    setLoading(true)
    setError(null)
    setMatched(false)
    const t = window.setTimeout(() => {
      void fetch(`/api/vehicle/vin-decode?vin=${encodeURIComponent(vin)}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then(async (r) => {
          const j = (await r.json()) as {
            error?: string
            data?: { vehicle_year?: string; vehicle_make?: string; vehicle_model?: string }
          }
          if (!r.ok) throw new Error(j.error ?? "VIN lookup failed")
          const d = j.data
          if (!d?.vehicle_make) throw new Error("Could not decode VIN")
          lastDecoded.current = vin
          onResolvedRef.current({
            vehicle_year: d.vehicle_year ?? "",
            vehicle_make: d.vehicle_make ?? "",
            vehicle_model: d.vehicle_model ?? "",
          })
          setMatched(true)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "VIN lookup failed")
          lastDecoded.current = ""
        })
        .finally(() => setLoading(false))
    }, 450)
    return () => window.clearTimeout(t)
  }, [value])

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          type="text"
          className={cn(inputClass, matched && "border-emerald-500/50")}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={20}
          onChange={(e) => {
            lastDecoded.current = ""
            setMatched(false)
            setError(null)
            onVinChange(e.target.value.toUpperCase())
          }}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" aria-hidden />
        ) : matched ? (
          <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" aria-hidden />
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {matched ? <p className="text-xs text-emerald-400">Year, make, and model locked from VIN.</p> : null}
    </div>
  )
}
