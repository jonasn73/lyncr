"use client"

// Optional "Request Job Photos" — collapsed by default (rarely needed on calls).

import { useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Camera, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type IntakeJobPhoto = {
  id: string
  url: string
  mime_type?: string
  created_at?: string
  category?: "damage" | "id_verification" | "other"
}

export type IntakeRescueMeta = {
  ticket_status?: string | null
  customer_name?: string | null
  vehicle_vin?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_trim?: string | null
  special_notes?: string | null
  verify_on_arrival?: boolean | null
  vin_unavailable?: boolean | null
}

type IntakeJobPhotosPanelProps = {
  callLogId: string | null
  customerPhone: string
  photos: IntakeJobPhoto[]
  onPhotosChange: (photos: IntakeJobPhoto[]) => void
  /** Decoded rescue profile from /intake-rescue submit. */
  rescueMeta?: IntakeRescueMeta | null
  onRescueMetaChange?: (meta: IntakeRescueMeta | null) => void
  compact?: boolean
  className?: string
}

function PhotoGrid({
  title,
  photos,
}: {
  title: string
  photos: IntakeJobPhoto[]
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title} ({photos.length})
      </p>
      {photos.length === 0 ? (
        <div className="grid min-h-[56px] place-items-center rounded-lg border border-dashed border-slate-600/80 bg-slate-950/40 px-2 py-2 text-center text-[10px] text-slate-500">
          Waiting…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {photos.map((photo) => (
            <a
              key={photo.id}
              href={photo.url}
              target="_blank"
              rel="noreferrer"
              className="relative aspect-square overflow-hidden rounded-lg border border-slate-600/70 bg-slate-950"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={title} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function IntakeJobPhotosPanel({
  callLogId,
  customerPhone,
  photos,
  onPhotosChange,
  rescueMeta = null,
  onRescueMetaChange,
  compact = false,
  className,
}: IntakeJobPhotosPanelProps) {
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [hint, setHint] = useState<string | null>(null)
  // Collapsed by default — this feature is rarely used during intake.
  const [expanded, setExpanded] = useState(false)

  const damagePhotos = useMemo(
    () => photos.filter((p) => !p.category || p.category === "damage" || p.category === "other"),
    [photos]
  )
  const idPhotos = useMemo(
    () => photos.filter((p) => p.category === "id_verification"),
    [photos]
  )

  const infoReceived = rescueMeta?.ticket_status === "info_received"
  const hasActivity = photos.length > 0 || infoReceived || requestState === "sent"
  const vehicleLine = [
    rescueMeta?.vehicle_year,
    rescueMeta?.vehicle_make,
    rescueMeta?.vehicle_model,
    rescueMeta?.vehicle_trim,
  ]
    .filter(Boolean)
    .join(" ")

  // Auto-open only when something actually arrived (not for the empty placeholder).
  useEffect(() => {
    if (photos.length > 0 || infoReceived) setExpanded(true)
  }, [photos.length, infoReceived])

  // Hydrate rescue package when reopening the same call ticket.
  useEffect(() => {
    if (!callLogId || callLogId.startsWith("ring-")) return
    let cancel = false
    void fetch(`/api/intake/rescue?call_log_id=${encodeURIComponent(callLogId)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok || cancel) return
        const json = (await r.json()) as {
          data?: {
            photos?: IntakeJobPhoto[]
            token?: IntakeRescueMeta & { ticket_status?: string }
          } | null
        }
        const pkg = json.data
        if (!pkg) return
        if (pkg.photos?.length) onPhotosChange(pkg.photos)
        if (pkg.token && onRescueMetaChange) {
          onRescueMetaChange({
            ticket_status: pkg.token.ticket_status,
            customer_name: pkg.token.customer_name,
            vehicle_vin: pkg.token.vehicle_vin,
            vehicle_year: pkg.token.vehicle_year,
            vehicle_make: pkg.token.vehicle_make,
            vehicle_model: pkg.token.vehicle_model,
            vehicle_trim: pkg.token.vehicle_trim,
            special_notes: pkg.token.special_notes,
            verify_on_arrival: Boolean(
              (pkg.token as { verify_on_arrival?: boolean }).verify_on_arrival
            ),
            vin_unavailable: Boolean(
              (pkg.token as { vin_unavailable?: boolean }).vin_unavailable
            ),
          })
        }
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      cancel = true
    }
  }, [callLogId, onPhotosChange, onRescueMetaChange])

  const requestPhotos = useCallback(async () => {
    if (!customerPhone.trim()) {
      setRequestState("error")
      setHint("Enter the caller phone first.")
      setExpanded(true)
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
        setHint(json.error || "Could not send intake link.")
        return
      }
      setRequestState("sent")
      setHint("Link texted — gallery updates when they submit.")
      setExpanded(true)
    } catch {
      setRequestState("error")
      setHint("Network error sending intake SMS.")
    }
  }, [callLogId, customerPhone])

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Critical dispatch banners stay visible even when the tools stay collapsed. */}
      {infoReceived ? (
        <div className="space-y-2">
          <div className="rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-3 py-2 text-center">
            <p className="text-[11px] font-black uppercase tracking-wider text-emerald-200">
              [ INFO RECEIVED - READY TO DISPATCH ]
            </p>
          </div>
          {rescueMeta?.verify_on_arrival ? (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-500/20 px-3 py-2.5 text-center shadow-[0_0_20px_rgba(245,158,11,0.25)]">
              <p className="text-[12px] font-black uppercase tracking-wide text-amber-100">
                ⚠️ VERIFY ID ON SITE BEFORE UNLOCKING
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* One quiet row — no empty gallery box until the user asks for it. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          "inline-flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-muted-foreground transition-colors hover:text-foreground",
          compact ? "text-[11px]" : "text-xs"
        )}
        aria-expanded={expanded}
      >
        <Camera className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">
          {hasActivity
            ? photos.length > 0
              ? `Job photos (${photos.length})`
              : requestState === "sent"
                ? "Photos requested — waiting…"
                : "Job photos"
            : "Need photos? (optional)"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-60 transition-transform",
            expanded && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="job-photos-tools"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-0.5">
              <button
                type="button"
                onClick={() => void requestPhotos()}
                disabled={requestState === "sending"}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-muted/30 font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50",
                  compact ? "px-3 py-2 text-[11px]" : "px-3 py-2.5 text-xs"
                )}
                title="Text customer a Pending Info Intake link"
              >
                {requestState === "sending" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                )}
                Request photos from customer
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

              {hasActivity ? (
                <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                  {vehicleLine || rescueMeta?.vehicle_vin || rescueMeta?.customer_name ? (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                      {rescueMeta?.customer_name ? (
                        <p className="text-xs font-semibold text-emerald-100">
                          {rescueMeta.customer_name}
                        </p>
                      ) : null}
                      {vehicleLine ? (
                        <p className="text-xs text-emerald-200/90">{vehicleLine}</p>
                      ) : null}
                      {rescueMeta?.vehicle_vin ? (
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          VIN {rescueMeta.vehicle_vin}
                        </p>
                      ) : null}
                      {rescueMeta?.special_notes ? (
                        <p className="mt-1 text-[11px] text-slate-300">
                          {rescueMeta.special_notes}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                    Job Attachments ({photos.length})
                  </p>
                  <div className="flex gap-2">
                    <PhotoGrid title="Damage" photos={damagePhotos} />
                    {rescueMeta?.verify_on_arrival ? (
                      <div className="min-w-0 flex-1">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">
                          ID / Registration
                        </p>
                        <div className="grid min-h-[56px] place-items-center rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-2 py-2 text-center text-[10px] font-semibold text-amber-100">
                          Verify ID on site
                        </div>
                      </div>
                    ) : (
                      <PhotoGrid title="ID / Registration" photos={idPhotos} />
                    )}
                  </div>
                </div>
              ) : (
                <p className="px-0.5 text-[10px] text-muted-foreground">
                  Texts a link so the customer can send damage / ID photos. Skip unless you need them.
                </p>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
