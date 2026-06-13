"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2, MessageSquare, Send, Truck } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { DrawerScrollBody, DrawerStepHeader } from "@/components/dashboard-routing-drawer-shared"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { displayPortingMessageBody } from "@/lib/porting-display"
import { dispatchPortingOrdersChanged } from "@/components/dashboard-numbers-modal-context"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { OwnerPortingDeskDetail, PortingNotification } from "@/lib/types"

type Props = {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PipelineTracker({ steps }: { steps: OwnerPortingDeskDetail["pipeline_steps"] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Transfer status</p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {steps.map((step, i) => (
          <div key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold",
                step.state === "failed"
                  ? "border-red-500/50 bg-red-950/60 text-red-300"
                  : step.state === "complete"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : step.state === "current"
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                      : "border-zinc-700 bg-zinc-900 text-zinc-600"
              )}
            >
              {step.state === "complete" ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium leading-tight",
                step.state === "current"
                  ? "text-sky-200"
                  : step.state === "complete"
                    ? "text-zinc-300"
                    : step.state === "failed"
                      ? "text-red-300"
                      : "text-zinc-600"
              )}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConversationFeed({ notifications }: { notifications: PortingNotification[] }) {
  if (notifications.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
        No carrier messages yet. Updates from the porting desk will appear here.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {notifications.map((n) => {
        const isCarrier =
          n.event_type.toLowerCase().includes("comment") ||
          n.title.toLowerCase().includes("comment") ||
          n.title.toLowerCase().includes("action")
        return (
          <li
            key={n.id}
            className={cn(
              "rounded-xl border px-3 py-3 text-sm",
              isCarrier
                ? "border-amber-500/30 bg-amber-500/10 text-amber-50"
                : "border-zinc-800 bg-zinc-950/50 text-zinc-300"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                {isCarrier ? "Porting desk" : "System update"}
              </span>
              <time className="text-[10px] text-zinc-600">
                {new Date(n.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">
              {displayPortingMessageBody(n.body)}
            </p>
            {n.read_at == null ? (
              <span className="mt-2 inline-block rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                New
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function PortingInteractionDrawer({ orderId, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<OwnerPortingDeskDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState("")
  const [pin, setPin] = useState("")
  const [sending, setSending] = useState(false)

  const loadDesk = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/porting/orders/${encodeURIComponent(orderId)}/desk?mark_read=1`,
        { credentials: "include" }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not load transfer details")
      setDetail(json.data as OwnerPortingDeskDetail)
      setPin(json.data?.order?.pin_or_sid ?? "")
      dispatchPortingOrdersChanged()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not open transfer desk",
        description: e instanceof Error ? e.message : "Try again.",
      })
    } finally {
      setLoading(false)
    }
  }, [orderId, toast])

  useEffect(() => {
    if (open && orderId) void loadDesk()
    if (!open) {
      setDetail(null)
      setReply("")
    }
  }, [open, orderId, loadDesk])

  async function sendUpdate() {
    if (!orderId) return
    const message = reply.trim()
    const pinTrimmed = pin.trim()
    if (!message && !pinTrimmed) {
      toast({ variant: "destructive", title: "Add a reply or corrected PIN" })
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/porting/orders/${encodeURIComponent(orderId)}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, pin: pinTrimmed || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Send failed")
      toast({ title: "Update sent", description: json.message || "Porting desk received your message." })
      setReply("")
      dispatchPortingOrdersChanged()
      await loadDesk()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not send",
        description: e instanceof Error ? e.message : "Try again.",
      })
    } finally {
      setSending(false)
    }
  }

  const phone = detail?.order?.phone_number
    ? formatPhoneDisplay(detail.order.phone_number)
    : "Your number"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" variant="drawer" className={WORKSPACE_SHEET_CLASS}>
        <DrawerStepHeader
          step="Number transfer"
          title="Carrier transfer desk"
          subtitle="Track your port, read Telnyx messages, and send corrections before a rejection."
          lineLabel={phone}
        />

        <DrawerScrollBody className="space-y-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : detail ? (
            <>
              <PipelineTracker steps={detail.pipeline_steps} />

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-amber-400" aria-hidden />
                  <h3 className="text-sm font-semibold text-foreground">Telnyx conversation</h3>
                </div>
                <ConversationFeed notifications={detail.notifications} />
              </div>

              <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                {detail.order.status === "rejected" ? (
                  <label className="block text-xs font-medium text-red-200/90">
                    Correct Account PIN/Passcode
                    <input
                      type="text"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-red-500/40 bg-zinc-950 px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                ) : null}
                <label className="block text-xs font-medium text-zinc-400">
                  Reply / Provide Missing Info to Carrier Desk
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={4}
                    placeholder="Answer the porting team's questions (account number, invoice, LOA details, etc.)"
                    className="mt-1 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-sm text-foreground placeholder:text-zinc-600"
                  />
                </label>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void sendUpdate()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden />
                  )}
                  Send Update to Telnyx
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-zinc-500">
              <Truck className="h-8 w-8 text-zinc-600" aria-hidden />
              Select a transfer from the banner to open this desk.
            </div>
          )}
        </DrawerScrollBody>
      </SheetContent>
    </Sheet>
  )
}
