"use client"

// ============================================
// Number transfer thread — read + reply (vendor-backed; on-brand for lyncr).
// ============================================

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { displayPortingMessageBody } from "@/lib/porting-display"
import { SITE_NAME } from "@/lib/brand"

type CommentRow = { id: string; body: string; user_type: string; created_at: string }

function labelForUserType(t: string): string {
  if (t === "admin") return "Porting team"
  if (t === "user") return "You"
  if (t === "system") return "Notice"
  return t
}

export function PortingOrderCommentsDialog({
  orderId,
  phoneLabel,
  open,
  onOpenChange,
  allowReply,
}: {
  orderId: string | null
  phoneLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** False when port is cancelled / closed — read-only. */
  allowReply: boolean
}) {
  const [comments, setComments] = useState<CommentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !orderId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/numbers/porting/comments?order_id=${encodeURIComponent(orderId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.data?.comments) setComments(data.data.comments)
        else if (data?.error) setError(data.error)
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load messages")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, orderId])

  async function send() {
    if (!orderId || !reply.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch("/api/numbers/porting/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, body: reply.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Send failed")
      setReply("")
      const r2 = await fetch(`/api/numbers/porting/comments?order_id=${encodeURIComponent(orderId)}`, {
        credentials: "include",
      })
      const d2 = await r2.json()
      if (d2?.data?.comments) setComments(d2.data.comments)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,640px)] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border/70 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
            Transfer messages
          </DialogTitle>
          <DialogDescription className="text-left text-xs">
            {phoneLabel} — updates from the people handling your transfer (PIN, deadlines, carrier questions). Replies
            you send here are delivered to that team through {SITE_NAME}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading messages…</span>
            </div>
          ) : comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No messages yet on this order.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm",
                    c.user_type === "admin"
                      ? "border-primary/25 bg-primary/[0.06]"
                      : "border-border/60 bg-muted/30"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{labelForUserType(c.user_type)}</span>
                    <span>
                      {c.created_at
                        ? new Date(c.created_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : ""}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">{displayPortingMessageBody(c.body)}</p>
                </li>
              ))}
            </ul>
          )}
          {error ? <p className="mt-2 text-center text-xs text-destructive">{error}</p> : null}
        </div>
        {allowReply ? (
          <div className="border-t border-border/70 p-4">
            <label className="sr-only" htmlFor="porting-reply">
              Reply to porting team
            </label>
            <textarea
              id="porting-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply (e.g. correct PIN, billing address)…"
              rows={3}
              className="mb-2 w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <Button type="button" className="w-full" disabled={sending || !reply.trim()} onClick={() => void send()}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send reply"
              )}
            </Button>
          </div>
        ) : (
          <p className="border-t border-border/70 px-4 py-3 text-center text-xs text-muted-foreground">
            No reply box because this transfer is <span className="font-medium text-foreground">finished or cancelled</span>. You can
            still read the messages above. To move a number again, start a new transfer from Settings when you are ready.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
