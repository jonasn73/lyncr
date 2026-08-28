"use client"

// Mobile-friendly Key Inventory barcode scanner (html5-qrcode).
// Portrait viewfinder + torch + vibrate on hit → stock adjust or new-SKU form.

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Flashlight, FlashlightOff, Loader2, Minus, Plus, ScanBarcode, X } from "lucide-react"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { KeyInventoryCapturePhotoButton } from "@/components/dashboard/key-inventory-capture-photo"
import { cn } from "@/lib/utils"
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared"

/** Client-safe shape matching /api/inventory responses (avoid importing Neon helpers). */
type InventoryItem = {
  id: string
  sku: string
  fccId: string
  brand: string
  frequency?: string
  van1Quantity: number
  van2Quantity: number
  shopQuantity: number
  minimumStockAlert: number
  totalQuantity: number
  lowStock: boolean
  notes: string | null
  imageUrl?: string | null
}

type StockLocation = "van1" | "van2" | "shop"

type ScanPhase = "idle" | "looking_up" | "found" | "new" | "error"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId?: string | null
}

function vibrateConfirm() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(40)
    }
  } catch {
    // Ignore — desktop / denied vibration.
  }
}

export function KeyInventoryScanner({ open, onOpenChange, organizationId }: Props) {
  const readerDomId = useId().replace(/:/g, "")
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const handlingScanRef = useRef(false)
  const onDecodedRef = useRef<(text: string) => void>(() => {})
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [phase, setPhase] = useState<ScanPhase>("idle")
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [scannedSku, setScannedSku] = useState("")
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [location, setLocation] = useState<StockLocation>("van1")
  const [adjusting, setAdjusting] = useState(false)
  const [savingNew, setSavingNew] = useState(false)
  const [manualSku, setManualSku] = useState("")
  const [newForm, setNewForm] = useState({ sku: "", fccId: "", brand: "" })

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current
    scannerRef.current = null
    setCameraReady(false)
    setTorchOn(false)
    setTorchSupported(false)
    if (!scanner) return
    try {
      if (scanner.isScanning) {
        await scanner.stop()
      }
      scanner.clear()
    } catch {
      // Camera already stopped.
    }
  }, [])

  const pauseCamera = useCallback(() => {
    const scanner = scannerRef.current
    if (!scanner?.isScanning) return
    try {
      scanner.pause(true)
    } catch {
      // Older devices may not support pause — ignore.
    }
  }, [])

  const resumeCamera = useCallback(() => {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      scanner.resume()
    } catch {
      // Ignore.
    }
    handlingScanRef.current = false
    setPhase("idle")
    setStatusMsg(null)
  }, [])

  const applyTorch = useCallback(async (on: boolean) => {
    const scanner = scannerRef.current
    if (!scanner?.isScanning) return
    try {
      const caps = scanner.getRunningTrackCameraCapabilities()
      const torch = caps.torchFeature()
      if (!torch.isSupported()) {
        setTorchSupported(false)
        return
      }
      await torch.apply(on)
      setTorchOn(on)
    } catch {
      setTorchSupported(false)
    }
  }, [])

  const lookupSku = useCallback(
    async (skuRaw: string) => {
      const sku = skuRaw.trim().toUpperCase()
      if (!sku) return
      setPhase("looking_up")
      setStatusMsg(`Looking up ${sku}…`)
      setScannedSku(sku)
      try {
        const q = new URLSearchParams({ sku })
        if (organizationId) q.set("organization_id", organizationId)
        const res = await fetch(`/api/inventory/sku?${q}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as {
          error?: string
          data?: { found: boolean; sku: string; item: InventoryItem | null }
        }
        if (!res.ok) throw new Error(json.error ?? "Lookup failed")

        if (json.data?.found && json.data.item) {
          setItem(json.data.item)
          setPhase("found")
          setStatusMsg(null)
        } else {
          setItem(null)
          setNewForm({ sku, fccId: "", brand: "" })
          setPhase("new")
          setStatusMsg(null)
        }
      } catch (e) {
        setPhase("error")
        setStatusMsg(e instanceof Error ? e.message : "Lookup failed")
        handlingScanRef.current = false
      }
    },
    [organizationId]
  )

  const onDecoded = useCallback(
    async (decodedText: string) => {
      if (handlingScanRef.current) return
      handlingScanRef.current = true
      vibrateConfirm()
      pauseCamera()
      await lookupSku(decodedText)
    },
    [lookupSku, pauseCamera]
  )
  onDecodedRef.current = (text) => {
    void onDecoded(text)
  }

  // Start / stop camera when the scanner modal opens.
  useEffect(() => {
    if (!open) {
      void stopCamera()
      handlingScanRef.current = false
      setPhase("idle")
      setItem(null)
      setScannedSku("")
      setStatusMsg(null)
      setCameraError(null)
      setManualSku("")
      return
    }

    let cancelled = false

    const start = async () => {
      setCameraError(null)
      // Wait a tick so the reader div is mounted.
      await new Promise((r) => window.setTimeout(r, 80))
      if (cancelled) return

      const el = document.getElementById(`ki-reader-${readerDomId}`)
      if (!el) {
        setCameraError("Camera view could not start. Try again.")
        return
      }

      const scanner = new Html5Qrcode(`ki-reader-${readerDomId}`, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF,
        ],
        verbose: false,
      })
      scannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (viewW, viewH) => {
              const width = Math.min(Math.floor(viewW * 0.82), 320)
              const height = Math.min(Math.floor(viewH * 0.22), 140)
              return { width, height }
            },
            aspectRatio: 1.777,
          },
          (text) => {
            onDecodedRef.current(text)
          },
          () => {
            // Continuous scan noise — ignore.
          }
        )
        if (cancelled) {
          await stopCamera()
          return
        }
        setCameraReady(true)
        try {
          const caps = scanner.getRunningTrackCameraCapabilities()
          setTorchSupported(caps.torchFeature().isSupported())
        } catch {
          setTorchSupported(false)
        }
      } catch (e) {
        console.error("[key-inventory-scanner]", e)
        setCameraError(
          e instanceof Error
            ? e.message
            : "Camera permission denied. Allow camera access or enter the SKU manually."
        )
      }
    }

    void start()
    return () => {
      cancelled = true
      void stopCamera()
    }
    // Only re-run when the modal opens/closes — not on every decode callback identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, readerDomId])

  const closeAll = () => {
    onOpenChange(false)
  }

  const dismissResultAndRescan = () => {
    setItem(null)
    setScannedSku("")
    setNewForm({ sku: "", fccId: "", brand: "" })
    resumeCamera()
  }

  const adjustStock = async (delta: 1 | -1) => {
    if (!item) return
    setAdjusting(true)
    try {
      const res = await fetch(`/api/inventory/${item.id}/adjust`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, location }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { item: InventoryItem }
      }
      if (!res.ok) throw new Error(json.error ?? "Update failed")
      if (json.data?.item) {
        setItem(json.data.item)
        vibrateConfirm()
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Could not update stock")
    } finally {
      setAdjusting(false)
    }
  }

  const saveNewKey = async () => {
    const sku = newForm.sku.trim().toUpperCase()
    if (!sku) {
      setStatusMsg("SKU is required")
      return
    }
    setSavingNew(true)
    setStatusMsg(null)
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          fccId: newForm.fccId,
          brand: newForm.brand,
          organization_id: organizationId || undefined,
          van1Quantity: 1,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { item: InventoryItem; created: boolean }
      }
      if (!res.ok) throw new Error(json.error ?? "Could not save key")
      if (json.data?.item) {
        setItem(json.data.item)
        setScannedSku(json.data.item.sku)
        setPhase("found")
        vibrateConfirm()
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Could not save key")
    } finally {
      setSavingNew(false)
    }
  }

  return (
    <>
      {/* Full-screen camera scanner */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "fixed inset-0 z-[110] flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 text-white sm:max-w-none",
            "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
          )}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Key inventory scanner</DialogTitle>
            <DialogDescription>Scan a barcode to look up or add a key SKU.</DialogDescription>
          </DialogHeader>

          {/* Top bar */}
          <div className="safe-area-pt flex items-center justify-between gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">Scan key stock</p>
              <p className="truncate text-xs text-muted-foreground">
                Aim the barcode at the green box
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {torchSupported ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className={cn(
                    "h-11 w-11 rounded-full border border-border bg-card",
                    torchOn && "border-warning/60 bg-warning/20 text-warning"
                  )}
                  aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
                  onClick={() => void applyTorch(!torchOn)}
                >
                  {torchOn ? (
                    <Flashlight className="h-5 w-5" aria-hidden />
                  ) : (
                    <FlashlightOff className="h-5 w-5" aria-hidden />
                  )}
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-11 w-11 rounded-full border border-border bg-card"
                aria-label="Close scanner"
                onClick={closeAll}
              >
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          </div>

          {/* Viewfinder */}
          <div className="relative mx-auto mt-1 w-full max-w-md flex-1 px-3">
            <div className="relative h-full min-h-[52dvh] overflow-hidden rounded-2xl border border-border bg-black">
              <div id={`ki-reader-${readerDomId}`} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />

              {/* Green target box overlay (centered) */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-[22%] w-[78%] max-h-[140px] max-w-[320px]">
                  <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-md border-l-[3px] border-t-[3px] border-success" />
                  <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-md border-r-[3px] border-t-[3px] border-success" />
                  <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-[3px] border-l-[3px] border-success" />
                  <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-md border-b-[3px] border-r-[3px] border-success" />
                  <span className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-success/50" />
                </div>
              </div>

              {!cameraReady && !cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-sm text-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-success" aria-hidden />
                  Starting camera…
                </div>
              ) : null}

              {cameraError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-center text-sm text-foreground">
                  {cameraError}
                </div>
              ) : null}
            </div>
          </div>

          {/* Manual SKU fallback + status */}
          <div className="safe-area-pb mx-auto w-full max-w-md space-y-3 px-4 pb-6 pt-4">
            {phase === "looking_up" ? (
              <p className="flex items-center justify-center gap-2 text-sm text-success">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {statusMsg}
              </p>
            ) : phase === "error" && statusMsg ? (
              <p className="text-center text-sm text-destructive">{statusMsg}</p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {cameraReady ? "Hold steady — scan confirms with a short vibrate." : " "}
              </p>
            )}

            <div className="flex gap-2">
              <Input
                value={manualSku}
                onChange={(e) => setManualSku(e.target.value.toUpperCase())}
                placeholder="Or type SKU…"
                className="h-11 border-border bg-card font-mono text-sm text-white placeholder:text-muted-foreground"
                autoCapitalize="characters"
                enterKeyHint="search"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualSku.trim()) {
                    e.preventDefault()
                    handlingScanRef.current = true
                    pauseCamera()
                    void lookupSku(manualSku)
                  }
                }}
              />
              <Button
                type="button"
                className="h-11 shrink-0 bg-success hover:bg-success"
                disabled={!manualSku.trim() || phase === "looking_up"}
                onClick={() => {
                  handlingScanRef.current = true
                  pauseCamera()
                  void lookupSku(manualSku)
                }}
              >
                Look up
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Result: SKU found → adjust stock */}
      <Dialog
        open={open && phase === "found" && !!item}
        onOpenChange={(next) => {
          if (!next) dismissResultAndRescan()
        }}
      >
        <DialogContent className="z-[120] max-w-sm gap-4 rounded-2xl border-border bg-background text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">SKU Found: {item?.sku ?? scannedSku}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Current stock:{" "}
              <span className="font-semibold text-success">{item?.totalQuantity ?? 0}</span>
              {item?.lowStock ? (
                <span className="ml-2 text-warning">· reorder soon</span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {item ? (
            <div className="space-y-1 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              <p>
                Van 1: <span className="text-foreground">{item.van1Quantity}</span>
                {" · "}
                Van 2: <span className="text-foreground">{item.van2Quantity}</span>
                {" · "}
                Shop: <span className="text-foreground">{item.shopQuantity}</span>
              </p>
              {item.fccId || item.brand ? (
                <p className="font-mono">
                  {[item.brand, item.fccId].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Adjust location</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["van1", "Van 1"],
                  ["van2", "Van 2"],
                  ["shop", "Shop"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocation(value)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    location === value
                      ? "border-success/70 bg-success/15 text-success"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 border border-border bg-card"
              disabled={adjusting}
              onClick={() => void adjustStock(-1)}
            >
              {adjusting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Minus className="h-4 w-4" aria-hidden />
              )}
              Remove 1
            </Button>
            <Button
              type="button"
              className="h-11 bg-success hover:bg-success"
              disabled={adjusting}
              onClick={() => void adjustStock(1)}
            >
              {adjusting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Add 1
            </Button>
          </div>

          {item ? (
            <div className="rounded-xl border border-border bg-card/40 px-3 py-3">
              <KeyInventoryCapturePhotoButton
                inventoryId={item.id}
                sku={item.sku}
                fccId={item.fccId}
                frequency={item.frequency || ""}
                organizationId={organizationId}
                imageUrl={item.imageUrl}
                onUploaded={(row: KeyInventoryApiRow) => {
                  setItem((prev) =>
                    prev
                      ? {
                          ...prev,
                          imageUrl: row.imageUrl,
                          fccId: row.fccId || prev.fccId,
                          frequency: row.frequency || prev.frequency,
                        }
                      : prev
                  )
                }}
              />
            </div>
          ) : null}

          {statusMsg && phase === "found" ? (
            <p className="text-center text-xs text-destructive">{statusMsg}</p>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => dismissResultAndRescan()}
          >
            Scan another
          </Button>
        </DialogContent>
      </Dialog>

      {/* Result: new SKU → register form */}
      <Dialog
        open={open && phase === "new"}
        onOpenChange={(next) => {
          if (!next) dismissResultAndRescan()
        }}
      >
        <DialogContent className="z-[120] max-w-sm gap-4 rounded-2xl border-border bg-background text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">New key SKU</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              <span className="font-mono text-success">{scannedSku}</span> is not in your
              inventory yet. Add FCC ID and brand to register it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ki-new-sku" className="text-xs text-muted-foreground">
                SKU
              </Label>
              <Input
                id="ki-new-sku"
                value={newForm.sku}
                onChange={(e) => setNewForm((f) => ({ ...f, sku: e.target.value.toUpperCase() }))}
                className="border-border bg-card font-mono text-white"
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ki-new-fcc" className="text-xs text-muted-foreground">
                FCC ID
              </Label>
              <Input
                id="ki-new-fcc"
                value={newForm.fccId}
                onChange={(e) => setNewForm((f) => ({ ...f, fccId: e.target.value.toUpperCase() }))}
                placeholder="e.g. KR55WK49250"
                className="border-border bg-card font-mono text-white placeholder:text-muted-foreground"
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ki-new-brand" className="text-xs text-muted-foreground">
                Brand
              </Label>
              <Input
                id="ki-new-brand"
                value={newForm.brand}
                onChange={(e) => setNewForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="Autel, OEM…"
                className="border-border bg-card text-white placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {statusMsg && phase === "new" ? (
            <p className="text-center text-xs text-destructive">{statusMsg}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 border border-border bg-card"
              disabled={savingNew}
              onClick={() => dismissResultAndRescan()}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11 bg-success hover:bg-success"
              disabled={savingNew || !newForm.sku.trim()}
              onClick={() => void saveNewKey()}
            >
              {savingNew ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save key
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
}

/** Compact launch button used on Settings / Inventory pages. */
export function KeyInventoryScannerLaunchButton({
  className,
  organizationId,
}: {
  className?: string
  organizationId?: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("h-11 gap-2 bg-success hover:bg-success", className)}
      >
        <ScanBarcode className="h-4 w-4" aria-hidden />
        Scan inventory
      </Button>
      <KeyInventoryScanner
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
      />
    </>
  )
}
