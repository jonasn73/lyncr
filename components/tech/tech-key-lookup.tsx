// Tech console — Key Lookup. Same YMM picker + label vocabulary the owner's Fast Lookup
// uses, cross-referenced against the owner's stock via /api/tech/vehicle/key-info.

"use client"

import { useState } from "react"
import { KeyRound, Loader2, PackageSearch, Search } from "lucide-react"
import { VehiclePickerCascade, type VehicleCascadeValue } from "@/components/vehicle-picker-cascade"
import {
  inferProgrammingMethod,
  variantButtonLabel,
  variantDisplayLabel,
} from "@/lib/vehicle-key-variant-labels"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import { cn } from "@/lib/utils"

type KeyVariant = {
  id: string
  title: string
  key_type: string | null
  buttons: string | null
  fits_text: string | null
  programming_method: string | null
}

type KeyEntry = {
  id: string
  fccId: string
  frequency: string | null
  modulation: string | null
  chipset: string | null
  variants: KeyVariant[]
}

type KeyInfoResponse = {
  vehicle: { year: string; make: string; model: string; trim: string | null }
  keySpecs: { keys: KeyEntry[] }
  inventory: KeyInventoryApiRow[]
}

function stockLine(rows: KeyInventoryApiRow[]): { total: number; label: string } {
  const total = rows.reduce((sum, r) => sum + (Number(r.totalQuantity) || 0), 0)
  const label = rows
    .map((r) => `Van 1: ${r.van1Quantity} · Van 2: ${r.van2Quantity} · Shop: ${r.shopQuantity}`)
    .find(Boolean)
  return { total, label: label ?? "No stock on record" }
}

export function TechKeyLookup() {
  const [vehicle, setVehicle] = useState<VehicleCascadeValue>({
    vehicle_year: "",
    vehicle_make: "",
    vehicle_model: "",
  })
  const [fccId, setFccId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KeyInfoResponse | null>(null)

  const canSearch = Boolean(vehicle.vehicle_year && vehicle.vehicle_make && vehicle.vehicle_model)

  async function search() {
    if (!canSearch) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const q = new URLSearchParams({
        year: vehicle.vehicle_year,
        make: vehicle.vehicle_make,
        model: vehicle.vehicle_model,
      })
      const cleanFcc = fccId.trim() ? sanitizeFccIdInput(fccId) : ""
      if (cleanFcc) q.set("fcc_id", cleanFcc)
      const res = await fetch(`/api/tech/vehicle/key-info?${q}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { error?: string; data?: KeyInfoResponse }
      if (!res.ok) throw new Error(json.error ?? "Lookup failed")
      setResult(json.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed")
    } finally {
      setLoading(false)
    }
  }

  const keys = result?.keySpecs.keys ?? []
  const inventory = result?.inventory ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-operator/15 text-operator">
            <KeyRound className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Key lookup</p>
            <p className="text-2xs text-muted-foreground">FCC ID, chip type, programming — plus what you have on hand</p>
          </div>
        </div>

        <VehiclePickerCascade value={vehicle} onChange={setVehicle} variant="sequential" disabled={loading} />

        <div className="mt-3 flex gap-2">
          <input
            value={fccId}
            onChange={(e) => setFccId(e.target.value.toUpperCase())}
            placeholder="FCC ID (optional)"
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 font-mono text-sm text-white placeholder:text-muted-foreground"
            autoCapitalize="characters"
          />
          <button
            type="button"
            disabled={!canSearch || loading}
            onClick={() => void search()}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-operator px-4 text-sm font-semibold text-operator-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            Search
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result && keys.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <PackageSearch className="h-8 w-8" aria-hidden />
          <p className="text-sm">No key data found for this vehicle.</p>
          <p className="text-2xs">Try clearing the FCC ID or double-check the year/make/model.</p>
        </div>
      ) : null}

      {keys.map((key) => {
        const matches = inventory.filter(
          (row) => row.fccId && key.fccId && row.fccId.toUpperCase() === key.fccId.toUpperCase()
        )
        const stock = stockLine(matches)
        return (
          <article key={key.id} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm font-semibold text-operator">{key.fccId || "Unknown FCC ID"}</span>
              {matches.length > 0 ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-3 py-0.5 text-2xs font-bold uppercase tracking-wide",
                    stock.total > 0 ? "bg-success/20 text-success" : "bg-warning/20 text-warning"
                  )}
                >
                  {stock.total > 0 ? `${stock.total} in stock` : "Out of stock"}
                </span>
              ) : null}
            </div>

            {key.chipset || key.frequency ? (
              <p className="mt-1 text-2xs text-muted-foreground">
                {[key.chipset ? `Chip: ${key.chipset}` : null, key.frequency ? `${key.frequency} MHz${key.modulation && key.modulation !== "XXX" ? ` ${key.modulation}` : ""}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}

            {matches.length > 0 ? (
              <p className="mt-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-2xs text-muted-foreground">
                {stock.label}
              </p>
            ) : null}

            {key.variants.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {key.variants.map((v) => {
                  const styleLabel = variantDisplayLabel(v.title, v.key_type)
                  const buttonLabel = variantButtonLabel(v.title, v.buttons, v.fits_text, v.key_type)
                  const programming = v.programming_method ?? inferProgrammingMethod(v.title, v.key_type, key.chipset)
                  return (
                    <li key={v.id} className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
                      <p className="text-sm font-medium text-foreground">
                        {buttonLabel ? `${buttonLabel} · ${styleLabel}` : styleLabel}
                      </p>
                      <p className="mt-0.5 text-2xs uppercase tracking-wide text-muted-foreground">{programming}</p>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
