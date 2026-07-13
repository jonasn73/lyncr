"use client"

// Customer-facing page: /upload?t=[token] — camera/file capture → POST /api/upload/[token].

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"

/** Shrink a photo on-device so Neon base64 stays under the API size cap. */
async function compressImageFile(file: File): Promise<{ mimeType: string; dataBase64: string; fileName: string }> {
  // Prefer canvas JPEG for phone camera HEIC / huge PNGs.
  const bitmap = await createImageBitmap(file)
  // Max edge ~1280 keeps ignition/lock details readable.
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  // Offscreen canvas for draw + encode.
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  // Export as JPEG data URL at quality 0.72.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72)
  // Strip the data: prefix — API stores raw base64 only.
  const dataBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, "")
  return {
    mimeType: "image/jpeg",
    dataBase64,
    fileName: (file.name || "job-photo.jpg").replace(/\.\w+$/, ".jpg"),
  }
}

function UploadInner() {
  // Read ?t= from the SMS link.
  const search = useSearchParams()
  // Accept t or token for flexibility.
  const token = (search.get("t") || search.get("token") || "").trim()
  // UI state machine for the mobile page.
  const [status, setStatus] = useState<"loading" | "ready" | "uploading" | "done" | "error">("loading")
  // Human-readable status line under the title.
  const [message, setMessage] = useState("Preparing secure upload link…")
  // How many photos already on this token.
  const [photoCount, setPhotoCount] = useState(0)
  // Hidden file input (camera + gallery).
  const inputRef = useRef<HTMLInputElement>(null)
  // Local preview before / after upload.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Validate the token when the page opens.
  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("This upload link is missing or invalid.")
      return
    }
    let cancel = false
    void fetch(`/api/upload/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (cancel) return
        if (r.status === 410) {
          setStatus("error")
          setMessage("This upload link has expired. Ask us to text a new one.")
          return
        }
        if (!r.ok) {
          setStatus("error")
          setMessage("This upload link is no longer valid.")
          return
        }
        const json = (await r.json()) as { data?: { photo_count?: number } }
        setPhotoCount(Number(json.data?.photo_count) || 0)
        setStatus("ready")
        setMessage("Snap a clear photo of your lock, key, or ignition damage, then tap Upload.")
      })
      .catch(() => {
        if (!cancel) {
          setStatus("error")
          setMessage("Could not open this upload link. Check your connection and try again.")
        }
      })
    return () => {
      cancel = true
    }
  }, [token])

  // Handle file picker / camera capture.
  const onFilePicked = useCallback(
    async (file: File | null) => {
      if (!token || !file) return
      // Show a quick local preview while compressing.
      const localPreview = URL.createObjectURL(file)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return localPreview
      })
      setStatus("uploading")
      setMessage("Compressing and uploading…")
      try {
        const compressed = await compressImageFile(file)
        const res = await fetch(`/api/upload/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mime_type: compressed.mimeType,
            file_name: compressed.fileName,
            data_base64: compressed.dataBase64,
          }),
        })
        if (!res.ok) {
          setStatus("error")
          setMessage(
            res.status === 413
              ? "That photo is too large. Try again with a smaller picture."
              : "We could not save your photo. Please try again."
          )
          return
        }
        setPhotoCount((n) => n + 1)
        setStatus("done")
        setMessage("Got it — photo sent to Key Squad. You can upload another if needed.")
      } catch {
        setStatus("error")
        setMessage("Upload failed. Check your connection and try again.")
      }
    },
    [token]
  )

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Key Squad</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Upload job photos</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{message}</p>
        {photoCount > 0 ? (
          <p className="mt-1 text-xs font-medium text-emerald-700">{photoCount} photo(s) received</p>
        ) : null}
      </div>

      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Selected job photo preview"
          className="max-h-64 w-full rounded-2xl object-cover"
        />
      ) : null}

      {status === "ready" || status === "uploading" || status === "done" || status === "error" ? (
        <label
          className={
            status === "uploading"
              ? "flex min-h-[220px] cursor-wait flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-4 text-center opacity-70"
              : "flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50 px-4 text-center active:scale-[0.99]"
          }
        >
          <span className="text-4xl" aria-hidden>
            📷
          </span>
          <span className="mt-3 text-base font-semibold text-emerald-900">
            {status === "uploading" ? "Uploading…" : "Tap to take or choose a photo"}
          </span>
          <span className="mt-1 text-xs text-emerald-800/80">Camera or photo library</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={status === "uploading"}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              e.target.value = ""
              void onFilePicked(file)
            }}
          />
        </label>
      ) : null}

      {status === "done" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Photo uploaded successfully. You can close this page or add another picture above.
        </p>
      ) : null}
    </main>
  )
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-6">
          <p className="text-sm text-zinc-600">Loading…</p>
        </main>
      }
    >
      <UploadInner />
    </Suspense>
  )
}
