"use client"

// Capture Key Image — mobile camera file input → upload → KeyInventory.imageUrl.

import { useEffect, useRef, useState } from "react" // React hooks for UI state
import { Camera, Loader2 } from "lucide-react" // Icons for button / spinner
import { Button } from "@/components/ui/button" // Shared button styles
import { cn } from "@/lib/utils" // className merge helper
import type { KeyInventoryApiRow } from "@/lib/key-inventory-shared" // Inventory API shape

type Props = {
  inventoryId?: string | null // Existing key_inventory row id (optional)
  sku: string // Required SKU so we can create/find the row
  fccId?: string | null // FCC id for new rows
  frequency?: string | null // RF frequency label
  year?: string | null // Vehicle context (optional)
  make?: string | null
  model?: string | null
  organizationId?: string | null // Multi-tenant org scope
  imageUrl?: string | null // Current thumbnail from parent
  onUploaded: (item: KeyInventoryApiRow) => void // Parent merges updated row
  className?: string
  compact?: boolean // Icon-only button mode
}

/** Read a File, shrink it in the browser, return JPEG base64 (no data: prefix). */
async function fileToBase64(file: File): Promise<{ mimeType: string; dataBase64: string }> {
  const mimeType = file.type || "image/jpeg" // Fallback mime if missing
  // Turn the file into a data URL so we can draw it on a canvas.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader() // Browser file reader
    reader.onload = () => resolve(String(reader.result || "")) // Success → data URL
    reader.onerror = () => reject(new Error("Could not read photo")) // Fail → error
    reader.readAsDataURL(file) // Start reading
  })

  // Decode the data URL into an Image so we know width/height.
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image() // Off-screen image element
    el.onload = () => resolve(el) // Ready to draw
    el.onerror = () => reject(new Error("Could not decode photo"))
    el.src = dataUrl // Kick off decode
  })

  const maxEdge = 1280 // Cap long edge so uploads stay small
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height)) // Never upscale
  const w = Math.max(1, Math.round(img.width * scale)) // Target width
  const h = Math.max(1, Math.round(img.height * scale)) // Target height
  const canvas = document.createElement("canvas") // Drawing surface
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d") // 2D paint API
  if (!ctx) {
    // Canvas unavailable — send the original base64 as-is.
    const raw = dataUrl.replace(/^data:image\/\w+;base64,/, "")
    return { mimeType, dataBase64: raw }
  }
  ctx.drawImage(img, 0, 0, w, h) // Paint resized photo
  const compressed = canvas.toDataURL("image/jpeg", 0.82) // JPEG ~82% quality
  return {
    mimeType: "image/jpeg",
    dataBase64: compressed.replace(/^data:image\/\w+;base64,/, ""), // Strip prefix for DB
  }
}

export function KeyInventoryCapturePhotoButton({
  inventoryId,
  sku,
  fccId,
  frequency,
  year,
  make,
  model,
  organizationId,
  imageUrl,
  onUploaded,
  className,
  compact,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null) // Hidden file input
  const [busy, setBusy] = useState(false) // Upload in progress?
  const [error, setError] = useState<string | null>(null) // Error message
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageUrl ?? null) // Thumbnail

  // Keep thumbnail in sync when parent inventory row gets a new imageUrl.
  useEffect(() => {
    setPreviewUrl(imageUrl ?? null)
  }, [imageUrl])

  const handleImageUpload = async (file: File | null) => {
    if (!file) return // User cancelled the picker
    setBusy(true) // Show spinner
    setError(null) // Clear old error
    try {
      const { mimeType, dataBase64 } = await fileToBase64(file) // Compress on device
      // Instant local preview while the upload finishes.
      setPreviewUrl(`data:${mimeType};base64,${dataBase64}`)

      const res = await fetch("/api/inventory/image", {
        method: "POST",
        credentials: "include", // Send session cookie
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: inventoryId || undefined,
          sku,
          fccId: fccId || "",
          frequency: frequency || "",
          year: year || null,
          make: make || null,
          model: model || null,
          organization_id: organizationId || undefined,
          mime_type: mimeType,
          data_base64: dataBase64,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { item: KeyInventoryApiRow; imageUrl?: string | null }
      }
      if (!res.ok) throw new Error(json.error ?? "Upload failed")
      if (json.data?.item) {
        if (json.data.item.imageUrl) setPreviewUrl(json.data.item.imageUrl) // Server URL
        onUploaded(json.data.item) // Tell parent (updates key cards)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setBusy(false) // Hide spinner
      if (inputRef.current) inputRef.current.value = "" // Allow re-picking same file
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- operator capture / API image
          <img
            src={previewUrl}
            alt="Captured key"
            className="h-12 w-12 shrink-0 rounded-md border border-border/60 object-cover bg-black/40"
          />
        ) : null}
        <Button
          type="button"
          size={compact ? "icon" : "sm"}
          variant="secondary"
          className={cn(
            "border border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20",
            compact ? "h-9 w-9" : "h-9"
          )}
          disabled={busy || !sku.trim()}
          aria-label="Capture key image"
          onClick={() => inputRef.current?.click()} // Open camera / photo picker
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Camera className="h-4 w-4" aria-hidden />
          )}
          {compact ? null : "Capture Key Image"}
        </Button>
        {/* Hidden camera / gallery picker — capture=environment opens rear camera on phones. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null // First selected photo
            void handleImageUpload(file) // Start upload (async)
          }}
        />
      </div>
      {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
    </div>
  )
}
