"use client"

// Dashboard banner when Lyncr Support replied and the owner has unread chat.

import { useEffect, useState } from "react"
import Link from "next/link"
import { MessageCircle, X } from "lucide-react"
import useSWR from "swr"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "lyncr-support-chat-banner-dismissed-count"

const fetchUnread = async (url: string): Promise<number> => {
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) return 0
  const json = (await res.json().catch(() => ({}))) as { data?: { unread_count?: number } }
  return Number(json.data?.unread_count ?? 0)
}

export function SupportChatReplyBanner() {
  const { data: unread = 0 } = useSWR("/api/support/chat/unread", fetchUnread, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  })
  const [dismissedFor, setDismissedFor] = useState<number | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY)
      setDismissedFor(raw ? Number(raw) : null)
    } catch {
      setDismissedFor(null)
    }
  }, [])

  if (!unread || unread < 1) return null
  if (dismissedFor != null && dismissedFor === unread) return null

  return (
    <div
      className={cn(
        "pointer-events-auto fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[60]",
        "mx-auto max-w-lg sm:inset-x-auto sm:right-4 sm:left-auto sm:w-[min(100%,22rem)]"
      )}
      role="status"
    >
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/40 bg-slate-950/95 px-3 py-3 shadow-lg backdrop-blur">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-50">Lyncr Support replied</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            You have {unread} unread {unread === 1 ? "message" : "messages"} in Help chat.
          </p>
          <Link
            href="/dashboard/help#support-chat"
            className="mt-2 inline-block text-xs font-semibold text-violet-300 underline-offset-2 hover:underline"
          >
            Open chat
          </Link>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className="rounded-md p-1 text-muted-foreground hover:bg-slate-800 hover:text-slate-200"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, String(unread))
            } catch {
              /* ignore */
            }
            setDismissedFor(unread)
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
