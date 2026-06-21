"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Lightbulb, Loader2, MessageSquare, Truck } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { DrawerScrollBody, DrawerStepHeader } from "@/components/dashboard-routing-drawer-shared"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  displayPortingMessageBody,
  formatPortingThreadMessage,
  isPortingSystemStatusMessage,
} from "@/lib/porting-display"
import { dedupePortingConversationItems } from "@/lib/porting-conversation-dedupe"
import { buildCarrierLookupBanner } from "@/lib/porting-carrier-lookup-guide"
import { CarrierTransferDesk } from "@/components/dashboard/carrier-transfer-desk"
import { dispatchPortingOrdersChanged } from "@/components/dashboard-numbers-modal-context"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { OwnerPortingDeskDetail, PortingConversationItem } from "@/lib/types"

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

function formatThreadTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function CarrierLookupGuideBanner({
  order,
  conversation,
}: {
  order: OwnerPortingDeskDetail["order"]
  conversation: PortingConversationItem[]
}) {
  const banner = buildCarrierLookupBanner(order, conversation)
  if (!banner) return null
  return (
    <div className="flex justify-center px-1">
      <div className="flex max-w-[98%] items-start gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] leading-snug text-sky-50/95">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
        <p>
          <span aria-hidden>💡 </span>
          <strong className="font-semibold text-sky-100">{banner.rule_label}</strong>
          {": "}
          {banner.rule_body}
        </p>
      </div>
    </div>
  )
}

function ConversationFeed({ items }: { items: PortingConversationItem[] }) {
  const visibleItems = useMemo(() => dedupePortingConversationItems(items), [items])
  if (visibleItems.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
        No carrier updates yet. Open this desk again after a moment — carrier correspondence syncs on
        each refresh.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {visibleItems.map((item) => {
        const text = formatPortingThreadMessage(item.body)
        if (!text.trim()) return null
        const isSystem = isPortingSystemStatusMessage(item.title, item.body, item.author)
        const isCustomer = item.author === "customer"
        const isDesk = item.author === "porting_desk" || item.author === "carrier"

        if (isSystem) {
          return (
            <div key={item.id} className="flex justify-center px-2">
              <div className="max-w-[92%] rounded-full border border-zinc-700/80 bg-zinc-900/90 px-3 py-1.5 text-center text-[11px] leading-snug text-zinc-400">
                {displayPortingMessageBody(text)}
                <span className="mt-0.5 block text-[10px] text-zinc-600">{formatThreadTime(item.created_at)}</span>
              </div>
            </div>
          )
        }

        if (isCustomer) {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-md border border-sky-500/25 bg-sky-500/15 px-3.5 py-2.5 text-sm text-sky-50 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/80">You</p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{displayPortingMessageBody(text)}</p>
                <time className="mt-2 block text-[10px] text-sky-200/60">{formatThreadTime(item.created_at)}</time>
              </div>
            </div>
          )
        }

        return (
          <div key={item.id} className="flex justify-start">
            <div
              className={cn(
                "max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm shadow-sm",
                isDesk
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-50"
                  : "border-zinc-700/80 bg-zinc-900/80 text-zinc-200"
              )}
            >
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
                  {isDesk ? "Carrier Core Desk" : "Carrier network"}
                </p>
                {item.is_new ? (
                  <span className="rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-100">
                    New
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{displayPortingMessageBody(text)}</p>
              <time className="mt-2 block text-[10px] text-zinc-500">{formatThreadTime(item.created_at)}</time>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PortingInteractionDrawer({ orderId, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<OwnerPortingDeskDetail | null>(null)
  const [loading, setLoading] = useState(false)
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
    }
  }, [open, orderId, loadDesk])

  async function submitCorrection(payload: { pin?: string; message?: string }) {
    const target = detail?.order
    if (!orderId || !target?.id) return

    setSending(true)
    try {
      const res = await fetch(`/api/porting/orders/${encodeURIComponent(target.id)}/resubmit`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          porting_order_id: target.id,
          telnyx_order_id: target.telnyx_order_id ?? undefined,
          phone_number: target.phone_number,
          pin: payload.pin,
          message: payload.message,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Send failed")
      toast({
        title: payload.pin ? "PIN sent to carrier" : "Correction submitted",
        description:
          json.message ||
          (payload.pin
            ? "Carrier is re-reviewing your transfer with the updated PIN."
            : "Carrier desk received your update for this line."),
      })
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
          subtitle="Track your port, read carrier updates, and submit corrections before a rejection."
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
                  <h3 className="text-sm font-semibold text-foreground">Carrier Correspondence Log</h3>
                </div>
                <ConversationFeed items={detail.conversation} />
              </div>

              <CarrierLookupGuideBanner order={detail.order} conversation={detail.conversation} />

              <CarrierTransferDesk
                key={detail.order.id + detail.order.updated_at}
                order={detail.order}
                sending={sending}
                onSubmit={submitCorrection}
              />
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
