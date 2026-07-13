"use client"

// Intake "Request Job Photos" button + live Job Attachments gallery (Pusher-driven).

import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Camera, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type IntakeJobPhoto = {
  id: string
  url: string
  mime_type?: string
  created_at?: string
}

type IntakeJobPhotosPanelProps = {
  /** Active call_log / temporary ticket id (null for brand-new manual drafts). */
  callLogId: string | null
  /** Customer phone to SMS the /upload?t= link. */
  customerPhone: string
  /** Photos pushed from Pusher ticket.photos_updated (parent owns realtime). */
  photos: IntakeJobPhoto[]
  /** Replace gallery when parent hydrates or receives Pusher payloads. */
  onPhotosChange: (photos: IntakeJobPhoto[]) => void
  /** Optional denser spacing for step intake. */
  compact?: boolean
  className?: string
}

export function IntakeJobPhotosPanel({
  callLogId,
  customerPhone,
  photos,
  onPhotosChange,
  compact = false,
  className,
}: IntakeJobPhotosPanelProps) {
  // idle → sending SMS → sent (waiting for uploads) → error.
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  // Last error / success hint under the button.
  const [hint, setHint] = useState<string | null>(null)
  // Expand gallery when the first photo arrives.
  const [galleryOpen, setGalleryOpen] = useState(photos.length > 0)

  // Keep gallery open whenever we have attachments.
  useEffect(() => {
    if (photos.length > 0) setGalleryOpen(true)
  }, [photos.length])

  // Hydrate existing photos when reopening the same call ticket.
  useEffect(() => {
    if (!callLogId || callLogId.startsWith("ring-")) return
    let cancel = false
    void fetch(`/api/intake/photos?call_log_id=${encodeURIComponent(callLogId)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok || cancel) return
        const json = (await r.json()) as { data?: { photos?: IntakeJobPhoto[] } }
        const list = json.data?.photos ?? []
        if (list.length) onPhotosChange(list)
      })
      .catch(() => {
        /* ignore hydrate errors */
      })
    return () => {
      cancel = true
    }
  }, [callLogId, onPhotosChange])

  // Text the /upload SMS via Telnyx.
  const requestPhotos = useCallback(async () => {
    if (!customerPhone.trim()) {
      setRequestState("error")
      setHint("Enter the caller phone first.")
      return
    }
    setRequestState("sending")
    setHint(null)
    try {
      const res = await fetch("/api/intake/request-photos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: customerPhone,
          call_log_id: callLogId && !callLogId.startsWith("ring-") ? callLogId : null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setRequestState("error")
        setHint(json.error || "Could not send photo link.")
        return
      }
      setRequestState("sent")
      setHint("Photo link texted — gallery updates live when they upload.")
      setGalleryOpen(true)
    } catch {
      setRequestState("error")
      setHint("Network error sending photo SMS.")
    }
  }, [callLogId, customerPhone])

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => void requestPhotos()}
        disabled={requestState === "sending"}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/50 bg-sky-500/15 font-bold text-sky-100 transition-colors hover:bg-sky-500/25 disabled:opacity-50",
          compact ? "px-3 py-2.5 text-xs" : "px-4 py-3 text-sm"
        )}
        title="Text customer a secure photo upload link"
      >
        {requestState === "sending" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Camera className="h-4 w-4" aria-hidden />
        )}
        [ 📷 Request Job Photos ]
      </button>

      {hint ? (
        <p
          className={cn(
            "text-[10px]",
            requestState === "error" ? "text-red-400" : "text-sky-300/90"
          )}
        >
          {hint}
        </p>
      ) : null}

      <AnimatePresence initial={false}>
        {galleryOpen ? (
          <motion.div
            key="job-attachments"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                Job Attachments ({photos.length})
              </p>
              {photos.length === 0 ? (
                <div className="grid min-h-[72px] place-items-center rounded-lg border border-dashed border-slate-600/80 bg-slate-950/40 px-3 py-4 text-center text-[11px] text-slate-500">
                  Waiting for customer photos…
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <AnimatePresence initial={false}>
                    {photos.map((photo) => (
                      <motion.a
                        key={photo.id}
                        href={photo.url}
                        target="_blank"
                        rel="noreferrer"
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 380, damping: 24 }}
                        className="relative aspect-square overflow-hidden rounded-lg border border-slate-600/70 bg-slate-950"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt="Job attachment"
                          className="h-full w-full object-cover"
                        />
                      </motion.a>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700/70 bg-slate-950/30 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Job Attachments (0)
            </p>
            <div className="mt-2 grid min-h-[56px] place-items-center text-[11px] text-slate-600">
              Empty — request photos to open the gallery
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
