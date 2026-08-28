"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Lightbulb, Loader2, MessageSquare, Truck } from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
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
import { toast } from "sonner"
import { displayUserFacingMessage } from "@/lib/porting-display"
import { CarrierTransferDesk } from "@/components/dashboard/carrier-transfer-desk"
import { dispatchPortingOrdersChanged } from "@/components/dashboard-numbers-modal-context"
import { cn } from "@/lib/utils"
import type { OwnerPortingDeskDetail, PortingConversationItem } from "@/lib/types"

type Props = {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PipelineTracker({ steps }: { steps: OwnerPortingDeskDetail["pipeline_steps"] }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Transfer status</p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {steps.map((step, i) => (
          <div key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold",
                step.state === "failed"
                  ? "border-destructive/50 bg-destructive/60 text-destructive"
                  : step.state === "complete"
                    ? "border-success/50 bg-success/15 text-success"
                    : step.state === "current"
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                      : "border-border bg-card text-muted-foreground"
              )}
            >
              {step.state === "complete" ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-micro font-medium leading-tight",
                step.state === "current"
                  ? "text-sky-200"
                  : step.state === "complete"
                    ? "text-foreground"
                    : step.state === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
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
      <div className="flex max-w-[98%] items-start gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-2xs leading-snug text-sky-50/95">
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
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
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
              <div className="max-w-[92%] rounded-full border border-border/80 bg-card/90 px-3 py-2 text-center text-2xs leading-snug text-muted-foreground">
                {displayPortingMessageBody(text)}
                <span className="mt-0.5 block text-micro text-muted-foreground">{formatThreadTime(item.created_at)}</span>
              </div>
            </div>
          )
        }

        if (isCustomer) {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl rounded-br-md border border-sky-500/25 bg-sky-500/15 px-4 py-3 text-sm text-sky-50 shadow-resting">
                <p className="text-micro font-semibold uppercase tracking-wide text-sky-200/80">You</p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{displayPortingMessageBody(text)}</p>
                <time className="mt-2 block text-micro text-sky-200/60">{formatThreadTime(item.created_at)}</time>
              </div>
            </div>
          )
        }

        return (
          <div key={item.id} className="flex justify-start">
            <div
              className={cn(
                "max-w-[92%] rounded-2xl rounded-bl-md border px-4 py-3 text-sm shadow-resting",
                isDesk
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border/80 bg-card/80 text-foreground"
              )}
            >
              <div className="flex items-center gap-2">
                <p className="text-micro font-semibold uppercase tracking-wide text-warning/90">
                  {isDesk ? "Carrier Core Desk" : "Carrier network"}
                </p>
                {item.is_new ? (
                  <span className="rounded-full bg-warning/25 px-2 py-0.5 text-micro font-bold uppercase text-warning">
                    New
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{displayPortingMessageBody(text)}</p>
              <time className="mt-2 block text-micro text-muted-foreground">{formatThreadTime(item.created_at)}</time>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PortingInteractionDrawer({ orderId, open, onOpenChange }: Props) {
  const [detail, setDetail] = useState<OwnerPortingDeskDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState<string | null>(null)

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
      toast.error("Could not open transfer desk", {
        description: e instanceof Error ? e.message : "Try again.",
      })
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (open && orderId) void loadDesk()
    if (!open) {
      setDetail(null)
      setSubmitSuccessMessage(null)
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
      const successText = displayUserFacingMessage(
        json.message ||
          (payload.pin
            ? "PIN saved on your port order. The carrier network is re-reviewing your transfer."
            : "Carrier desk received your update for this line.")
      )
      setSubmitSuccessMessage(successText)
      toast.success(payload.pin ? "PIN saved to carrier" : "Correction submitted", {
        description: successText,
      })
      dispatchPortingOrdersChanged()
      await loadDesk()
    } catch (e) {
      toast.error("Could not send correction", {
        description: displayUserFacingMessage(e instanceof Error ? e.message : "Try again."),
      })
    } finally {
      setSending(false)
    }
  }

  const phone = detail?.order?.phone_number
    ? formatPhoneDisplay(detail.order.phone_number)
    : "Your number"

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent side="right" variant="drawer" className={WORKSPACE_SHEET_CLASS}>
        {/* DrawerStepHeader renders a plain h2 — name the sheet for screen readers. */}
        <SheetTitle className="sr-only">Carrier transfer desk</SheetTitle>
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
                  <MessageSquare className="h-4 w-4 text-warning" aria-hidden />
                  <h3 className="text-sm font-semibold text-foreground">Carrier Correspondence Log</h3>
                </div>
                <ConversationFeed items={detail.conversation} />
              </div>

              <CarrierLookupGuideBanner order={detail.order} conversation={detail.conversation} />

              <CarrierTransferDesk
                key={detail.order.id + detail.order.updated_at}
                order={detail.order}
                sending={sending}
                pinCorrectionRequired={detail.pin_correction_required}
                pinSavedPendingReview={detail.pin_saved_pending_review}
                submitSuccessMessage={submitSuccessMessage}
                conversationSnippets={detail.conversation.slice(-8).map((item) => item.body)}
                onSubmit={submitCorrection}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <Truck className="h-8 w-8 text-muted-foreground" aria-hidden />
              Select a transfer from the banner to open this desk.
            </div>
          )}
        </DrawerScrollBody>
      </SheetContent>
    </Sheet>
  )
}
