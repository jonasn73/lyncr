"use client"

// Persistent toast banner when a customer uploads delayed job photos.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Camera, X } from "lucide-react"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { LYNCR_FOCUS_INTAKE_EVENT, type LyncFocusIntakeDetail } from "@/lib/lync-engine-bus"
import { cn } from "@/lib/utils"

type PhotoUploadNotice = {
  id: string
  phoneDisplay: string
  ticketId: string
  callLogId: string | null
  viewIntakeUrl: string
}

export function PhotoUploadNotificationBanner() {
  // Business account id for the workspace Pusher channel.
  const session = useDashboardSessionOptional()
  const ownerUserId = session?.companyUserId?.trim() || ""
  // Persistent (until dismissed) photo-upload notices.
  const [notices, setNotices] = useState<PhotoUploadNotice[]>([])

  // Subscribe to notification.photo_uploaded on the account channel.
  useEffect(() => {
    if (!ownerUserId || !isRealtimeClientConfigured()) return
    const pusher = getPusherClient()
    if (!pusher) return

    // Match CallAnsweredModal channel naming (keep neon out of the client bundle).
    const channelName = `presence-account-${ownerUserId}`
    const channel = pusher.subscribe(channelName)
    const legacy = pusher.subscribe(`owner-${ownerUserId}`)

    const onPhotoUploaded = (raw: Record<string, unknown>) => {
      const phoneDisplay =
        (raw.phone_display != null ? String(raw.phone_display).trim() : "") ||
        (raw.phone_number != null ? String(raw.phone_number).trim() : "") ||
        "customer"
      const ticketId =
        (raw.ticket_id != null ? String(raw.ticket_id).trim() : "") ||
        (raw.call_log_id != null ? String(raw.call_log_id).trim() : "") ||
        (raw.token_id != null ? String(raw.token_id).trim() : "")
      const callLogId = raw.call_log_id != null ? String(raw.call_log_id).trim() : null
      const viewIntakeUrl =
        (raw.view_intake_url != null ? String(raw.view_intake_url).trim() : "") ||
        `/dashboard?id=${encodeURIComponent(ticketId || "")}`
      const id = `${ticketId}-${Date.now()}`
      setNotices((prev) => {
        // One banner per ticket — replace older notice for the same ticket.
        const without = prev.filter((n) => n.ticketId !== ticketId)
        return [...without, { id, phoneDisplay, ticketId, callLogId, viewIntakeUrl }]
      })
    }

    channel.bind("notification.photo_uploaded", onPhotoUploaded)
    legacy.bind("notification.photo_uploaded", onPhotoUploaded)

    return () => {
      channel.unbind("notification.photo_uploaded", onPhotoUploaded)
      legacy.unbind("notification.photo_uploaded", onPhotoUploaded)
      pusher.unsubscribe(channel.name)
      pusher.unsubscribe(legacy.name)
    }
  }, [ownerUserId])

  // Deep-link ?id= on /dashboard opens the matching intake ticket.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const id = params.get("id")?.trim()
    if (!id) return

    void fetch(`/api/calls/${encodeURIComponent(id)}/summary`, { credentials: "include" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then(
        (json: {
          data?: { id?: string; from_number?: string; to_number?: string; answered_at?: string | null }
        } | null) => {
          const row = json?.data
          const detail: LyncFocusIntakeDetail = {
            callSid: "",
            callLogId: row?.id || id,
            fromNumber: row?.from_number?.trim() || "",
            toNumber: row?.to_number?.trim() || "",
            phase: "connected",
            answeredAt: row?.answered_at ?? new Date().toISOString(),
          }
          window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_INTAKE_EVENT, { detail }))
        }
      )
      .catch(() => {
        const detail: LyncFocusIntakeDetail = {
          callSid: "",
          callLogId: id,
          fromNumber: "",
          toNumber: "",
          phase: "connected",
          answeredAt: new Date().toISOString(),
        }
        window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_INTAKE_EVENT, { detail }))
      })
      .finally(() => {
        // Clean the query param so refresh does not re-open forever.
        const url = new URL(window.location.href)
        url.searchParams.delete("id")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)
      })
  }, [])

  const dismiss = useCallback((noticeId: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== noticeId))
  }, [])

  const focusIntake = useCallback(
    (notice: PhotoUploadNotice) => {
      const detail: LyncFocusIntakeDetail = {
        callSid: "",
        callLogId: notice.callLogId || notice.ticketId,
        fromNumber: notice.phoneDisplay,
        toNumber: "",
        phase: "connected",
        answeredAt: new Date().toISOString(),
      }
      window.dispatchEvent(new CustomEvent(LYNCR_FOCUS_INTAKE_EVENT, { detail }))
      dismiss(notice.id)
    },
    [dismiss]
  )

  if (notices.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[160] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-4">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-sky-500/40",
            "bg-slate-950/95 px-4 py-3 text-sm text-slate-100 shadow-xl backdrop-blur"
          )}
          role="status"
          aria-live="polite"
        >
          <Camera className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">
              New photos received for client {notice.phoneDisplay}.{" "}
              <button
                type="button"
                onClick={() => focusIntake(notice)}
                className="font-bold text-sky-300 underline-offset-2 hover:underline"
              >
                [View Intake]
              </button>
            </p>
            <Link
              href={notice.viewIntakeUrl}
              className="mt-1 inline-block text-[11px] text-slate-400 hover:text-slate-200"
              onClick={() => dismiss(notice.id)}
            >
              Open dashboard ticket
            </Link>
          </div>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Dismiss photo notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
