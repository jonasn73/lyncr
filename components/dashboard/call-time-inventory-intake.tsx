"use client"

// Call-time inventory auditing loop — Key Details step (FCC + frequency → stock check).

import { useEffect, useMemo, useState } from "react"
import { Download, Loader2, Minus, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"
import {
  deriveCallTimeInventorySku,
  pickPrimaryInventoryRow,
} from "@/lib/call-time-inventory-sku"
import {
  formatTiSupplierOrderBadge,
  resolveTransponderIslandSupplierSku,
} from "@/lib/transponder-island-sku"
import { KeyInventoryCapturePhotoButton } from "@/components/dashboard/key-inventory-capture-photo"

type Props = {
  year: string
  make: string
  model: string
  /** Identified FCC ID from key selection / decode. */
  selectedFccId?: string | null
  /** Identified frequency (e.g. "434 MHz") from key profile. */
  selectedFrequency?: string | null
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
  organizationId,
  inventory,
  onInventoryUpdated,
  onMarkedOutOfStock,
  className,
}: Props) {
  const vehicleReady = Boolean(year?.trim() && make?.trim() && model?.trim())
  const fccReady = Boolean(selectedFccId?.trim())
  // Trigger stock audit once vehicle + FCC are known (frequency shown when available).
  const auditReady = vehicleReady && fccReady

  const primary = useMemo(
    () => pickPrimaryInventoryRow(inventory, selectedFccId),
    [inventory, selectedFccId]
  )

  const displayFcc = (selectedFccId || primary?.fccId || "").trim() || "N/A"
  const displayFrequency =
    (selectedFrequency || primary?.frequency || "").trim() || "N/A"
  const displayTiSku = (primary?.tiSku || primary?.sku || "").trim() || "N/A"
  const supplierOverride = useMemo(
    () =>
      resolveTransponderIslandSupplierSku({
        year,
        make,
        model,
        fccId: selectedFccId || primary?.fccId,
        catalogSku: primary?.tiSku || primary?.sku || "PROX-SUB-01",
        title: "Proximity Smart Key",
        keyType: "Smart Key",
      }),
    [year, make, model, selectedFccId, primary?.fccId, primary?.tiSku, primary?.sku]
  )
  const van1Qty = primary?.van1Qty ?? primary?.van1Quantity ?? 0
  const stockActive = Boolean(primary && van1Qty > 0)

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [stepperBusy, setStepperBusy] = useState(false)
  const [checkPhase, setCheckPhase] = useState<"ask" | "yes_qty">("ask")
  const [qtyDraft, setQtyDraft] = useState(1)
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAdjustOpen(false)
    setCheckPhase("ask")
    setQtyDraft(1)
    setError(null)
  }, [year, make, model, selectedFccId, selectedFrequency])

  if (!auditReady) return null

  const sku = deriveCallTimeInventorySku({
    inventory,
    selectedFccId,
    year,
    make,
    model,
  })
  const tiSkuForSave =
    primary?.tiSku?.trim() ||
    (displayTiSku !== "N/A" ? displayTiSku : null) ||
    (sku.startsWith("TIK-") ? sku : null)

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
        brand: primary?.brand || "",
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
      // No row yet — upsert absolute quantity from stepper draft.
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
        setCheckPhase("ask")
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
          "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium text-emerald-200">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            Stock Active: {van1Qty} in Van 1
            {displayTiSku !== "N/A" ? (
              <span className="ml-2 font-mono text-[11px] text-emerald-300/90">
                TI-SKU: {supplierOverride?.catalogSku || displayTiSku}
              </span>
            ) : null}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 border border-emerald-500/30 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50"
            onClick={() => setAdjustOpen((v) => !v)}
          >
            Adjust
          </Button>
        </div>
        {supplierOverride ? (
          <p className="mt-1.5 inline-flex max-w-full flex-wrap rounded-md border border-sky-400/50 bg-sky-500/15 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-sky-100">
            {formatTiSupplierOrderBadge(supplierOverride)}
          </p>
        ) : null}

        {adjustOpen ? (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-9 w-9 border border-emerald-500/30"
              disabled={stepperBusy || van1Qty <= 0}
              aria-label="Subtract one key from Van 1"
              onClick={() => void adjustByDelta(-1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Minus className="h-4 w-4" aria-hidden />
              )}
            </Button>
            <span className="min-w-[2.5rem] text-center text-base font-semibold tabular-nums text-emerald-100">
              {van1Qty}
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-9 w-9 border border-emerald-500/30"
              disabled={stepperBusy}
              aria-label="Add one key to Van 1"
              onClick={() => void adjustByDelta(1)}
            >
              {stepperBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
            </Button>
            <span className="text-[11px] text-emerald-200/70">Van 1 (e.g. after programming)</span>
          </div>
        ) : null}

        <div className="mt-2.5 border-t border-emerald-500/20 pt-2.5">
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

        {error ? <p className="mt-1.5 text-xs text-rose-300">{error}</p> : null}
      </div>
    )
  }

  // —— Unknown or 0 — Stock Verification Required ——
  return (
    <div
      id="call-time-stock-verification"
      className={cn(
        "rounded-xl border-2 border-amber-400/70 bg-amber-500/15 px-3 py-3 shadow-sm shadow-amber-950/30",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/50 bg-amber-500/20 text-amber-100">
          <Search className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-50">Stock Verification Required</p>
          <p className="text-xs leading-relaxed text-amber-100/90">
            We need FCC ID:{" "}
            <span className="font-mono font-medium text-amber-50">{displayFcc}</span> (
            {displayFrequency}) — TI-SKU:{" "}
            <span className="font-mono font-medium text-amber-50">
              {supplierOverride?.catalogSku || displayTiSku}
            </span>
            .
          </p>
          {supplierOverride ? (
            <p className="inline-flex max-w-full flex-wrap rounded-md border border-sky-400/50 bg-sky-500/15 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-sky-100">
              {formatTiSupplierOrderBadge(supplierOverride)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
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
            Out of Stock
          </Button>
          <Button
            type="button"
            className="h-11 bg-emerald-600 text-white hover:bg-emerald-500"
            disabled={saveBusy}
            onClick={() => {
              setCheckPhase("yes_qty")
              setQtyDraft(van1Qty > 0 ? van1Qty : 1)
              setError(null)
            }}
          >
            <Download className="h-4 w-4" aria-hidden />
            Yes, I Have It
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-2.5">
          <p className="text-xs font-medium text-emerald-100">How many do you have on hand?</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-10 w-10 border border-emerald-500/30"
              disabled={saveBusy || qtyDraft <= 1}
              aria-label="Decrease quantity"
              onClick={() => setQtyDraft((n) => Math.max(1, n - 1))}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-[2.75rem] text-center text-lg font-semibold tabular-nums text-emerald-50">
              {qtyDraft}
            </span>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-10 w-10 border border-emerald-500/30"
              disabled={saveBusy}
              aria-label="Increase quantity"
              onClick={() => setQtyDraft((n) => n + 1)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              className="h-10 flex-1 bg-emerald-600 hover:bg-emerald-500 sm:flex-none"
              disabled={saveBusy}
              onClick={() => void saveYesIHaveIt()}
            >
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
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
