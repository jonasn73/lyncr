"use client"

// Prominent plate-or-VIN lookup at the front of intake vehicle selection.
// Uses unified vin-decode / plate-lookup responses (vehicle + keySpecs in one trip).

import { useEffect, useRef, useState } from "react"
import { Loader2, Search, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizeVin } from "@/lib/nhtsa-vpic"
import { US_PLATE_STATES } from "@/lib/vehicle-plate-lookup"
import type { PlateLookupResult } from "@/lib/vehicle-plate-lookup"
import type {
  PreloadedVehicleKeyBundle,
  VehicleKeyInfoPayload,
} from "@/components/vehicle-key-info-panel"

export type FastVinDecodeResult = {
  year: string
  make: string
  model: string
  trim?: string
  vin: string
  keyBundle?: PreloadedVehicleKeyBundle | null
}

export type FastPlateLookupResult = PlateLookupResult & {
  keyBundle?: PreloadedVehicleKeyBundle | null
}

type VehicleFastLookupFieldProps = {
  plateNumber: string
  plateState: string
  vehicleVin?: string
  onPlateNumberChange: (value: string) => void
  onPlateStateChange: (value: string) => void
  onVinChange?: (vin: string) => void
  onPlateSuccess: (result: FastPlateLookupResult) => void
  onVinSuccess: (result: FastVinDecodeResult) => void
  disabled?: boolean
}

/** True when cleaned input matches a standard 17-character VIN. */
function looksLikeVin(raw: string): boolean {
  return normalizeVin(raw).length === 17
}

type UnifiedDecodeData = {
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_trim?: string | null
  trim?: string | null
  vehicle?: { year?: string; make?: string; model?: string; trim?: string | null }
  keySpecs?: {
    fccId?: string | null
    frequency?: string | null
    key_info?: VehicleKeyInfoPayload | null
    lookup_source?: "fcc" | "ymm" | "ymm_fallback" | "none"
  }
}

function keyBundleFromDecode(
  year: string,
  make: string,
  model: string,
  data?: UnifiedDecodeData | null
): PreloadedVehicleKeyBundle | null {
  if (!data?.keySpecs) return null
  return {
    year,
    make,
    model,
    key_info: data.keySpecs.key_info ?? null,
    lookup_source: data.keySpecs.lookup_source ?? null,
  }
}

export function VehicleFastLookupField({
  plateNumber,
  plateState,
  vehicleVin = "",
  onPlateNumberChange,
  onPlateStateChange,
  onVinChange,
  onPlateSuccess,
  onVinSuccess,
  disabled,
}: VehicleFastLookupFieldProps) {
  // Prefer an existing VIN, otherwise the plate already on the ticket.
  const [query, setQuery] = useState(() => (vehicleVin.trim() || plateNumber.trim()).toUpperCase())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const lastAutoVin = useRef("")
  // Keep latest callbacks without re-triggering the auto-VIN effect.
  const onVinSuccessRef = useRef(onVinSuccess)
  onVinSuccessRef.current = onVinSuccess
  const onVinChangeRef = useRef(onVinChange)
  onVinChangeRef.current = onVinChange
  const onPlateSuccessRef = useRef(onPlateSuccess)
  onPlateSuccessRef.current = onPlateSuccess

  const isVin = looksLikeVin(query)

  // Keep the field in sync if the parent hydrates plate/VIN later (draft / rescue).
  useEffect(() => {
    const seeded = (vehicleVin.trim() || plateNumber.trim()).toUpperCase()
    if (!seeded) return
    setQuery((prev) => (prev.trim() ? prev : seeded))
  }, [vehicleVin, plateNumber])

  const runVinDecode = async (vinRaw: string) => {
    const vin = normalizeVin(vinRaw)
    if (vin.length !== 17) {
      setError("VIN must be exactly 17 characters.")
      return
    }
    setLoading(true)
    setError(null)
    setStatus("Decoding VIN and fetching key specs…")
    try {
      const res = await fetch(`/api/vehicle/vin-decode?vin=${encodeURIComponent(vin)}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: UnifiedDecodeData }
      if (!res.ok) throw new Error(json.error ?? "VIN lookup failed")
      const d = json.data
      const year = (d?.vehicle?.year ?? d?.vehicle_year)?.trim() || ""
      const make = (d?.vehicle?.make ?? d?.vehicle_make)?.trim() || ""
      const model = (d?.vehicle?.model ?? d?.vehicle_model)?.trim() || ""
      const trim = (d?.vehicle?.trim ?? d?.vehicle_trim)?.trim() || undefined
      if (!make) throw new Error(json.error ?? "Could not decode VIN")
      onVinChangeRef.current?.(vin)
      onVinSuccessRef.current({
        year,
        make,
        model,
        trim,
        vin,
        keyBundle: keyBundleFromDecode(year, make, model, d),
      })
      const keyCount = d?.keySpecs?.key_info?.profiles?.length ?? 0
      setStatus(
        `Matched ${[year, make, model].filter(Boolean).join(" ")}${
          keyCount > 0 ? ` · ${keyCount} key profile${keyCount === 1 ? "" : "s"}` : ""
        }`
      )
      lastAutoVin.current = vin
    } catch (e) {
      lastAutoVin.current = ""
      setStatus(null)
      setError(e instanceof Error ? e.message : "VIN lookup failed")
    } finally {
      setLoading(false)
    }
  }

  const runPlateLookup = async () => {
    const plate = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    const state = plateState.trim()
    if (!plate) {
      setError("Enter a plate number or a 17-digit VIN.")
      return
    }
    if (!state) {
      setError("Select the plate state, or paste a 17-digit VIN instead.")
      return
    }
    setLoading(true)
    setError(null)
    setStatus("Looking up plate and fetching key specs…")
    try {
      const q = new URLSearchParams({ plate, state })
      const res = await fetch(`/api/vehicle/plate-lookup?${q}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: PlateLookupResult & UnifiedDecodeData
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Plate lookup failed")
      if (!json.data?.vehicle_make && !json.data?.vehicle?.make) {
        throw new Error(json.error ?? "No vehicle found for this plate.")
      }
      const year = (json.data.vehicle?.year ?? json.data.vehicle_year)?.trim() || ""
      const make = (json.data.vehicle?.make ?? json.data.vehicle_make)?.trim() || ""
      const model = (json.data.vehicle?.model ?? json.data.vehicle_model)?.trim() || ""
      onPlateNumberChange(plate)
      onPlateSuccessRef.current({
        ...json.data,
        keyBundle: keyBundleFromDecode(year, make, model, json.data),
      })
      const keyCount = json.data.keySpecs?.key_info?.profiles?.length ?? 0
      setStatus(
        `Matched ${[year, make, model].filter(Boolean).join(" ")}${
          keyCount > 0 ? ` · ${keyCount} key profile${keyCount === 1 ? "" : "s"}` : ""
        }`
      )
    } catch (e) {
      setStatus(null)
      setError(e instanceof Error ? e.message : "Plate lookup failed")
    } finally {
      setLoading(false)
    }
  }

  const runLookup = () => {
    if (looksLikeVin(query)) {
      void runVinDecode(query)
      return
    }
    void runPlateLookup()
  }

  // Auto-decode as soon as a full VIN is pasted (skip plate path).
  useEffect(() => {
    const vin = normalizeVin(query)
    if (vin.length !== 17 || vin === lastAutoVin.current || disabled || loading) return
    const t = window.setTimeout(() => {
      void runVinDecode(vin)
    }, 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the query text changes
  }, [query, disabled])

  return (
    <div className="grid gap-2 rounded-xl border border-primary/35 bg-primary/10 p-3 shadow-sm shadow-primary/5">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Fast Lookup (Plate or VIN)
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Paste a 17-digit VIN or enter a plate + state — we fill the vehicle and jump to key specs.
      </p>

      <div className="grid gap-2 sm:grid-cols-[1fr_5.5rem_auto]">
        <label className="grid min-w-0 gap-1 text-[11px]">
          <span className="font-medium text-foreground">Plate or VIN</span>
          <input
            className={cn(
              "h-11 w-full rounded-lg border border-border/70 bg-background px-3 font-mono text-sm uppercase tracking-wide text-foreground",
              "placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground",
              "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            )}
            value={query}
            disabled={disabled || loading}
            placeholder="ABC2020 or 17-digit VIN"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
              setQuery(next)
              setError(null)
              setStatus(null)
              lastAutoVin.current = ""
              if (looksLikeVin(next)) {
                onVinChange?.(normalizeVin(next))
              } else {
                onPlateNumberChange(next)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                runLookup()
              }
            }}
          />
        </label>

        <label className="grid gap-1 text-[11px]">
          <span className="font-medium text-foreground">State</span>
          <select
            className="h-11 rounded-lg border border-border/70 bg-background px-1.5 text-sm text-foreground disabled:opacity-50"
            value={plateState}
            disabled={disabled || loading || isVin}
            title={isVin ? "Not needed for VIN lookup" : "Plate registration state"}
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

        <div className="flex items-end">
          <button
            type="button"
            disabled={disabled || loading || !query.trim() || (!isVin && !plateState.trim())}
            onClick={runLookup}
            className={cn(
              "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 text-xs font-semibold text-primary",
              "hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            )}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden />
            )}
            {loading ? "Looking up…" : "Look up"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-[11px] text-amber-200">{error}</p>
      ) : status ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {status}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Demo plates: KY·ABC2020, TN·HOND18, TX·EQN19 — or paste any 17-digit VIN.
        </p>
      )}
    </div>
  )
}
