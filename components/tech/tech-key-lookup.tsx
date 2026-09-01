// Tech console — Key Lookup. Same YMM picker + label vocabulary the owner's Fast Lookup
// uses, cross-referenced against the owner's stock via /api/tech/vehicle/key-info.
//
// Two result sections, same split the owner's data actually has:
//   1. Transponder Island catalog — real orderable/stockable SKUs, ranked by match score.
//      This is the "what do I pull or order" answer, so it leads.
//   2. Key & FCC data — chip type, frequency, programming method per FCC ID. Useful even
//      when there's no TI SKU match (or as a cross-check against one).
// Searches automatically once year/make/model are all picked — no button tap required for
// the common path; the FCC ID field + Search button stay for a manual narrow/re-run.

"use client"

import { useState } from "react"
import { ExternalLink, KeyRound, Loader2, PackageSearch, Search } from "lucide-react"
import { VehiclePickerCascade, type VehicleCascadeValue } from "@/components/vehicle-picker-cascade"
import {
  inferProgrammingMethod,
  variantButtonLabel,
  variantDisplayLabel,
} from "@/lib/vehicle-key-variant-labels"
import { sanitizeFccIdInput } from "@/lib/fcc-id-input"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import type { TiCatalogKeyOption } from "@/lib/ti-supplier-catalog-shared"
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
  ti_catalog: TiCatalogKeyOption[]
}

/** Stock cross-reference: prefer a Transponder Island SKU match (exact part), fall back to FCC ID. */
function matchInventory(
  inventory: KeyInventoryApiRow[],
  by: { tiSku?: string | null; fccId?: string | null }
): KeyInventoryApiRow[] {
  const tiSku = by.tiSku?.trim().toUpperCase()
  const fccId = by.fccId?.trim().toUpperCase()
  if (tiSku) {
    const bySku = inventory.filter((row) => row.tiSku?.trim().toUpperCase() === tiSku)
    if (bySku.length > 0) return bySku
  }
  if (fccId) {
    return inventory.filter((row) => row.fccId?.trim().toUpperCase() === fccId)
  }
  return []
}

function StockBadge({ rows }: { rows: KeyInventoryApiRow[] }) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + (Number(r.totalQuantity) || 0), 0)
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-3 py-0.5 text-2xs font-bold uppercase tracking-wide",
        total > 0 ? "bg-success/20 text-success" : "bg-warning/20 text-warning"
      )}
    >
      {total > 0 ? `${total} in stock` : "Out of stock"}
    </span>
  )
}

function StockLine({ rows }: { rows: KeyInventoryApiRow[] }) {
  if (rows.length === 0) return null
  const row = rows[0]!
  return (
    <p className="mt-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-2xs text-muted-foreground">
      Van 1: {row.van1Quantity} · Van 2: {row.van2Quantity} · Shop: {row.shopQuantity}
    </p>
  )
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

  async function search(v: VehicleCascadeValue, fcc: string) {
    if (!(v.vehicle_year && v.vehicle_make && v.vehicle_model)) return
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({
        year: v.vehicle_year,
        make: v.vehicle_make,
        model: v.vehicle_model,
      })
      const cleanFcc = fcc.trim() ? sanitizeFccIdInput(fcc) : ""
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

  // Fires from the picker's own onChange — not a useEffect — the moment year/make/model
  // are all picked, so there's no scroll-down-and-tap-Search step for the common path.
  function handleVehicleChange(next: VehicleCascadeValue) {
    setVehicle(next)
    if (next.vehicle_year && next.vehicle_make && next.vehicle_model) {
      void search(next, fccId)
    } else {
      setResult(null)
      setError(null)
    }
  }

  const catalog = result?.ti_catalog ?? []
  const keys = result?.keySpecs.keys ?? []
  const inventory = result?.inventory ?? []
  const nothingFound = result != null && catalog.length === 0 && keys.length === 0 && !error

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-operator/15 text-operator">
            <KeyRound className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Key lookup</p>
            <p className="text-2xs text-muted-foreground">
              Transponder Island SKU, FCC ID, chip type, programming — plus what you have on hand
            </p>
          </div>
        </div>

        <VehiclePickerCascade value={vehicle} onChange={handleVehicleChange} variant="sequential" disabled={loading} />

        <div className="mt-3 flex gap-2">
          <input
            value={fccId}
            onChange={(e) => setFccId(e.target.value.toUpperCase())}
            placeholder="FCC ID (optional, narrows the match)"
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 font-mono text-sm text-white placeholder:text-muted-foreground"
            autoCapitalize="characters"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSearch) {
                e.preventDefault()
                void search(vehicle, fccId)
              }
            }}
          />
          <button
            type="button"
            disabled={!canSearch || loading}
            onClick={() => void search(vehicle, fccId)}
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

      {loading && !result ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <p className="text-sm">Searching…</p>
        </div>
      ) : null}

      {nothingFound ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <PackageSearch className="h-8 w-8" aria-hidden />
          <p className="text-sm">No key data found for this vehicle.</p>
          <p className="text-2xs">Try clearing the FCC ID or double-check the year/make/model.</p>
        </div>
      ) : null}

      {catalog.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Transponder Island catalog
          </p>
          {catalog.map((hit, i) => {
            const matches = matchInventory(inventory, { tiSku: hit.tiSku, fccId: hit.fccId })
            return (
              <article key={`${hit.tiSku}-${i}`} className="rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-md border border-success/50 bg-success/15 px-2 py-1 font-mono text-sm font-semibold tracking-wide text-success">
                    {hit.tiSku}
                  </span>
                  <StockBadge rows={matches} />
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{hit.title}</p>
                {hit.description ? (
                  <p className="mt-0.5 text-2xs text-muted-foreground">{hit.description}</p>
                ) : null}
                <p className="mt-1 text-2xs text-muted-foreground">
                  {[
                    hit.fccId ? `FCC ${hit.fccId}` : null,
                    hit.frequency ? `${hit.frequency} MHz` : null,
                    hit.buttonCount ? `${hit.buttonCount}-button` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <StockLine rows={matches} />
                {hit.productUrl ? (
                  <a
                    href={hit.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-operator"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden /> View on Transponder Island
                  </a>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}

      {keys.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Key &amp; FCC data</p>
          {keys.map((key) => {
            const matches = matchInventory(inventory, { fccId: key.fccId })
            return (
              <article key={key.id} className="rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm font-semibold text-operator">{key.fccId || "Unknown FCC ID"}</span>
                  <StockBadge rows={matches} />
                </div>

                {key.chipset || key.frequency ? (
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {[
                      key.chipset ? `Chip: ${key.chipset}` : null,
                      key.frequency
                        ? `${key.frequency} MHz${key.modulation && key.modulation !== "XXX" ? ` ${key.modulation}` : ""}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}

                <StockLine rows={matches} />

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
      ) : null}
    </div>
  )
}
