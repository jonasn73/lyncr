"use client"

// Call-time Dynamic Inventory Intake — stock badge / stock-check loop under vehicle header.

import { useEffect, useMemo, useState } from "react"
import { Check, Loader2, Minus, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import {
  deriveCallTimeInventorySku,
  pickPrimaryInventoryRow,
} from "@/lib/call-time-inventory-sku"

type Props = {
  year: string
  make: string
  model: string
  selectedFccId?: string | null
  organizationId?: string | null
  inventory: KeyInventoryApiRow[] | null | undefined
  /** Parent merges the updated row into decode inventory so fallback cards stay in sync. */
  onInventoryUpdated: (item: KeyInventoryApiRow) => void
  /** Operator confirmed no van stock — keep alternatives visible. */
  onMarkedOutOfStock?: () => void
  className?: string
}

export function CallTimeInventoryIntake({
  year,
  make,
  model,
  selectedFccId,
  organizationId,
  inventory,
  onInventoryUpdated,
  onMarkedOutOfStock,
  className,
}: Props) {
  const vehicleReady = Boolean(year?.trim() && make?.trim() && model?.trim())
  const primary = useMemo(
    () => pickPrimaryInventoryRow(inventory, selectedFccId),
    [inventory, selectedFccId]
  )
  const van1 = primary?.van1Quantity ?? 0
  const stockConfirmed = Boolean(primary && van1 > 0)

  const [modifyOpen, setModifyOpen] = useState(false)
  const [stepperBusy, setStepperBusy] = useState(false)
  const [checkPhase, setCheckPhase] = useState<"ask" | "yes_qty">("ask")
  const [qtyDraft, setQtyDraft] = useState("1")
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operatorMarkedOos, setOperatorMarkedOos] = useState(false)

  // Reset local check UI when the vehicle / key context changes.
  useEffect(() => {
    setModifyOpen(false)
    setCheckPhase("ask")
    setQtyDraft("1")
    setError(null)
    setOperatorMarkedOos(false)
  }, [year, make, model, selectedFccId])

  if (!vehicleReady) return null

  const sku = deriveCallTimeInventorySku({
    inventory,
    selectedFccId,
    year,
    make,
    model,
  })

  const upsertVan1 = async (quantity: number): Promise<KeyInventoryApiRow | null> => {
    const res = await fetch("/api/inventory/upsert", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        van1Quantity: quantity,
        fccId: selectedFccId || primary?.fccId || "",
        brand: primary?.brand || "",
        year,
        make,
        model,
        organization_id: organizationId || undefined,
      }),
    })
    const json = (await res.json()) as {
      error?: string
      data?: { item: KeyInventoryApiRow }
    }
    if (!res.ok) throw new Error(json.error ?? "Could not save inventory")
    return json.data?.item ?? null
  }

  const adjustByDelta = async (delta: 1 | -1) => {
    if (!primary) return
    setStepperBusy(true)
    setError(null)
    try {
      // Prefer id-based adjust when we already have a row.
      const res = await fetch(`/api/inventory/${primary.id}/adjust`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, location: "van1" }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { item: KeyInventoryApiRow }
      }
      if (!res.ok) throw new Error(json.error ?? "Could not update stock")
      if (json.data?.item) onInventoryUpdated(json.data.item)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update stock")
    } finally {
      setStepperBusy(false)
    }
  }

  const saveYesInStock = async () => {
    const qty = Math.max(0, Math.trunc(Number(qtyDraft)))
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Enter how many you have (at least 1).")
      return
    }
    setSaveBusy(true)
    setError(null)
    try {
      const item = await upsertVan1(qty)
      if (item) {
        onInventoryUpdated(item)
        setCheckPhase("ask")
        setOperatorMarkedOos(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save inventory")
    } finally {
      setSaveBusy(false)
    }
  }

  const markOutOfStock = async () => {
    setSaveBusy(true)
    setError(null)
    try {
      const item = await upsertVan1(0)
      if (item) onInventoryUpdated(item)
      setOperatorMarkedOos(true)
      onMarkedOutOfStock?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark out of stock")
    } finally {
      setSaveBusy(false)
    }
  }

  // Confirmed stock path
  if (stockConfirmed && primary) {
    return (
      <div
        className={cn(
          "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium text-emerald-200">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            Stock Confirmed: {primary.van1Quantity} available in Van 1
            {primary.sku ? (
              <span className="ml-1.5 font-mono text-[11px] text-emerald-200/70">
                · {primary.sku}
              </span>
            ) : null}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 border border-emerald-500/30 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50"
            onClick={() => setModifyOpen((v) => !v)}
          >
            Modify Count
          </Button>
        </div>

        {modifyOpen ? (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-9 w-9 border border-emerald-500/30"
              disabled={stepperBusy || primary.van1Quantity <= 0}
              aria-label="Remove one from Van 1"
              onClick={() => void adjustByDelta(-1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Minus className="h-4 w-4" aria-hidden />
              )}
            </Button>
            <span className="min-w-[2.5rem] text-center text-base font-semibold tabular-nums text-emerald-100">
              {primary.van1Quantity}
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-9 w-9 border border-emerald-500/30"
              disabled={stepperBusy}
              aria-label="Add one to Van 1"
              onClick={() => void adjustByDelta(1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
            </Button>
            <span className="text-[11px] text-emerald-200/70">Van 1</span>
          </div>
        ) : null}

        {error ? <p className="mt-1.5 text-xs text-rose-300">{error}</p> : null}
      </div>
    )
  }

  // Stock check required (no row, zero van stock, or operator just marked OOS)
  return (
    <div
      className={cn(
        "rounded-xl border-2 border-amber-400/60 bg-amber-500/15 px-3 py-3 shadow-sm shadow-amber-950/30",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/50 bg-amber-500/20 text-amber-100">
          <Search className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-50">Stock Check Required</p>
          <p className="mt-0.5 text-xs leading-snug text-amber-100/80">
            {operatorMarkedOos || (primary && van1 <= 0)
              ? "No Van 1 stock on file for this key. Confirm what you have in the van."
              : "No inventory row (or zero stock) for this vehicle key. Confirm Van 1 count before booking."}
            <span className="mt-0.5 block font-mono text-[10px] text-amber-100/60">SKU {sku}</span>
          </p>
        </div>
      </div>

      {checkPhase === "ask" ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11 border border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
            disabled={saveBusy}
            onClick={() => void markOutOfStock()}
          >
            {saveBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <X className="h-4 w-4" aria-hidden />
            )}
            No, Out of Stock
          </Button>
          <Button
            type="button"
            className="h-11 bg-emerald-600 text-white hover:bg-emerald-500"
            disabled={saveBusy}
            onClick={() => {
              setCheckPhase("yes_qty")
              setQtyDraft(primary && primary.van1Quantity > 0 ? String(primary.van1Quantity) : "1")
              setError(null)
            }}
          >
            <Check className="h-4 w-4" aria-hidden />
            Yes, In Stock
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-2.5">
          <label htmlFor="call-time-qty" className="text-xs font-medium text-emerald-100">
            How many do you have?
          </label>
          <div className="flex gap-2">
            <Input
              id="call-time-qty"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              className="h-10 border-emerald-500/30 bg-zinc-950/60 font-mono text-emerald-50"
            />
            <Button
              type="button"
              className="h-10 shrink-0 bg-emerald-600 hover:bg-emerald-500"
              disabled={saveBusy}
              onClick={() => void saveYesInStock()}
            >
              {saveBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Save to Inventory
            </Button>
          </div>
          <button
            type="button"
            className="text-[11px] text-amber-100/70 underline-offset-2 hover:underline"
            onClick={() => setCheckPhase("ask")}
          >
            Back
          </button>
        </div>
      )}

      {error ? <p className="mt-2 text-center text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}
