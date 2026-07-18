"use client"

// Call-time inventory — compact stock row on Key Details (Add to inventory / Adjust).

import { useEffect, useMemo, useState } from "react"
import { Camera, Loader2, Minus, PackagePlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import {
  deriveCallTimeInventorySku,
  pickPrimaryInventoryRow,
} from "@/lib/call-time-inventory-sku"
import { KeyInventoryCapturePhotoButton } from "@/components/dashboard/key-inventory-capture-photo"

type Props = {
  year: string
  make: string
  model: string
  /** Identified FCC ID from key selection / decode. */
  selectedFccId?: string | null
  /** Identified frequency (e.g. "434 MHz") from key profile. */
  selectedFrequency?: string | null
  /** Selected TI order blank (e.g. TIK-MAZ-46A) — preferred over FCC-… fallback. */
  selectedTiSku?: string | null
  organizationId?: string | null
  inventory: KeyInventoryApiRow[] | null | undefined
  onInventoryUpdated: (item: KeyInventoryApiRow) => void
  /** After Out of Stock — parent keeps Alternative Solutions visible. */
  onMarkedOutOfStock?: () => void
  className?: string
}

export function CallTimeInventoryIntake({
  year,
  make,
  model,
  selectedFccId,
  selectedFrequency,
  selectedTiSku,
  organizationId,
  inventory,
  onInventoryUpdated,
  onMarkedOutOfStock,
  className,
}: Props) {
  const vehicleReady = Boolean(year?.trim() && make?.trim() && model?.trim())
  const fccReady = Boolean(selectedFccId?.trim())
  const auditReady = vehicleReady && fccReady

  const primary = useMemo(
    () => pickPrimaryInventoryRow(inventory, selectedFccId),
    [inventory, selectedFccId]
  )

  const displaySku = useMemo(() => {
    const fromSelection = selectedTiSku?.trim()
    if (fromSelection) return fromSelection.toUpperCase()
    const fromRow = (primary?.tiSku || primary?.sku || "").trim()
    if (fromRow) return fromRow.toUpperCase()
    return deriveCallTimeInventorySku({
      inventory,
      selectedFccId,
      selectedTiSku,
      year,
      make,
      model,
    })
  }, [selectedTiSku, primary?.tiSku, primary?.sku, inventory, selectedFccId, year, make, model])

  const van1Qty = primary?.van1Qty ?? primary?.van1Quantity ?? 0
  const stockActive = Boolean(primary && van1Qty > 0)

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [stepperBusy, setStepperBusy] = useState(false)
  const [qtyDraft, setQtyDraft] = useState(1)
  const [saveBusy, setSaveBusy] = useState(false)
  const [showCapture, setShowCapture] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAdjustOpen(false)
    setAddOpen(false)
    setShowCapture(false)
    setQtyDraft(1)
    setError(null)
  }, [year, make, model, selectedFccId, selectedFrequency, selectedTiSku])

  if (!auditReady) return null

  const sku = deriveCallTimeInventorySku({
    inventory,
    selectedFccId,
    selectedTiSku,
    year,
    make,
    model,
  })
  const tiSkuForSave =
    selectedTiSku?.trim() ||
    primary?.tiSku?.trim() ||
    (displaySku.startsWith("TIK-") || displaySku.startsWith("TIT-") ? displaySku : null) ||
    (sku.startsWith("TIK-") || sku.startsWith("TIT-") ? sku : null) ||
    sku

  const upsertVan1 = async (quantity: number): Promise<KeyInventoryApiRow | null> => {
    const res = await fetch("/api/inventory/upsert", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: tiSkuForSave || sku,
        tiSku: tiSkuForSave || sku,
        van1Quantity: quantity,
        fccId: selectedFccId || primary?.fccId || "",
        frequency: selectedFrequency || primary?.frequency || "",
        brand: primary?.brand || make || "",
        supplierName: primary?.supplierName || "Transponder Island",
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
    if (!primary?.id) {
      const next = Math.max(0, qtyDraft + delta)
      setQtyDraft(next)
      return
    }
    setStepperBusy(true)
    setError(null)
    try {
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

  const saveYesIHaveIt = async () => {
    const qty = Math.max(0, Math.trunc(qtyDraft))
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
        setAddOpen(false)
        setAdjustOpen(false)
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
      onMarkedOutOfStock?.()
      setAddOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark out of stock")
    } finally {
      setSaveBusy(false)
    }
  }

  // —— Known stock (van1Qty > 0) ——
  if (stockActive && primary) {
    return (
      <div
        className={cn(
          "rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-2",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs font-medium text-emerald-200">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            {van1Qty} in van
            <span className="ml-1.5 font-mono text-[10px] text-emerald-300/80">{displaySku}</span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 border border-emerald-500/30 bg-emerald-950/40 px-2 text-[11px] text-emerald-100 hover:bg-emerald-900/50"
            onClick={() => setAdjustOpen((v) => !v)}
          >
            Adjust
          </Button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-200/80 hover:bg-emerald-500/15 hover:text-emerald-100"
            aria-label="Capture key image"
            onClick={() => setShowCapture((v) => !v)}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {adjustOpen ? (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 border border-emerald-500/30"
              disabled={stepperBusy || van1Qty <= 0}
              aria-label="Subtract one key from Van 1"
              onClick={() => void adjustByDelta(-1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Minus className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
            <span className="min-w-[2rem] text-center text-sm font-semibold tabular-nums text-emerald-100">
              {van1Qty}
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 border border-emerald-500/30"
              disabled={stepperBusy}
              aria-label="Add one key to Van 1"
              onClick={() => void adjustByDelta(1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </div>
        ) : null}

        {showCapture ? (
          <div className="mt-2 border-t border-emerald-500/20 pt-2">
            <KeyInventoryCapturePhotoButton
              inventoryId={primary.id}
              sku={sku}
              fccId={selectedFccId || primary.fccId}
              frequency={selectedFrequency || primary.frequency}
              year={year}
              make={make}
              model={model}
              organizationId={organizationId}
              imageUrl={primary.imageUrl}
              onUploaded={onInventoryUpdated}
            />
          </div>
        ) : null}

        {error ? <p className="mt-1.5 text-xs text-rose-300">{error}</p> : null}
      </div>
    )
  }

  // —— Unknown or 0 — compact Add to inventory ——
  return (
    <div
      id="call-time-stock-verification"
      className={cn(
        "rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Not in van
          <span className="ml-1.5 font-mono text-[10px] text-foreground/80">{displaySku}</span>
        </p>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-500"
          disabled={saveBusy}
          onClick={() => {
            setAddOpen(true)
            setQtyDraft(van1Qty > 0 ? van1Qty : 1)
            setError(null)
          }}
        >
          <PackagePlus className="h-3.5 w-3.5" aria-hidden />
          Add to inventory
        </Button>
        <button
          type="button"
          className="text-[11px] font-medium text-rose-300/90 underline-offset-2 hover:underline disabled:opacity-50"
          disabled={saveBusy}
          onClick={() => void markOutOfStock()}
        >
          {saveBusy ? "…" : "Out of stock"}
        </button>
      </div>

      {addOpen ? (
        <div className="mt-2 space-y-2 rounded-md border border-emerald-500/25 bg-emerald-950/25 p-2">
          <p className="text-[11px] font-medium text-emerald-100">How many on hand?</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 border border-emerald-500/30"
              disabled={saveBusy || qtyDraft <= 1}
              aria-label="Decrease quantity"
              onClick={() => setQtyDraft((n) => Math.max(1, n - 1))}
            >
              <Minus className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span className="min-w-[2rem] text-center text-base font-semibold tabular-nums text-emerald-50">
              {qtyDraft}
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 border border-emerald-500/30"
              disabled={saveBusy}
              aria-label="Increase quantity"
              onClick={() => setQtyDraft((n) => n + 1)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              className="h-8 flex-1 bg-emerald-600 text-[11px] hover:bg-emerald-500 sm:flex-none"
              disabled={saveBusy}
              onClick={() => void saveYesIHaveIt()}
            >
              {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Save
            </Button>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </button>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowCapture((v) => !v)}
          >
            <Camera className="h-3 w-3" aria-hidden />
            {showCapture ? "Hide photo" : "Capture key image"}
          </button>
          {showCapture ? (
            <KeyInventoryCapturePhotoButton
              inventoryId={primary?.id}
              sku={sku}
              fccId={selectedFccId}
              frequency={selectedFrequency}
              year={year}
              make={make}
              model={model}
              organizationId={organizationId}
              imageUrl={primary?.imageUrl}
              onUploaded={onInventoryUpdated}
            />
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-1.5 text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}
