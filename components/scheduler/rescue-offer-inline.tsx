"use client"

// Inline lower-price rescue offer + mock SMS hook for Price Denied jobs.

import { useMemo, useState } from "react"
import { Loader2, MessageSquare, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  buildRescueOfferSmsPreview,
  suggestRescueOfferPriceDollars,
} from "@/lib/rescue-queue"
import { SCHEDULER_GLASS_CARD, SCHEDULER_INPUT, SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"
import type { UnassignedPoolJob } from "@/lib/types"

type RescueOfferInlineProps = {
  job: UnassignedPoolJob
  onClose: () => void
}

export function RescueOfferInline({ job, onClose }: RescueOfferInlineProps) {
  const suggestedDollars = suggestRescueOfferPriceDollars(job)
  const [offerDollars, setOfferDollars] = useState(
    suggestedDollars > 0 ? String(suggestedDollars) : ""
  )
  const [smsState, setSmsState] = useState<"idle" | "sending" | "sent">("idle")
  const [smsMessage, setSmsMessage] = useState<string | null>(null)

  const parsedDollars = useMemo(() => {
    const raw = offerDollars.trim()
    if (!raw) return 0
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
  }, [offerDollars])

  const smsPreview = buildRescueOfferSmsPreview({
    customerName: job.customer_name,
    offerDollars: parsedDollars > 0 ? parsedDollars : suggestedDollars,
  })

  const mockSendSms = () => {
    if (smsState === "sending") return
    setSmsState("sending")
    window.setTimeout(() => {
      setSmsState("sent")
      setSmsMessage(`Mock SMS queued to ${job.customer_phone?.trim() || "customer"}`)
    }, 650)
  }

  return (
    <div
      className={cn(
        SCHEDULER_GLASS_CARD,
        "mt-2 space-y-2 border-rose-500/40 bg-rose-950/20 p-3 ring-1 ring-rose-500/25"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={cn(SCHEDULER_METADATA_LABEL, "text-rose-300")}>Rescue offer</p>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
        >
          Close
        </button>
      </div>

      <label className="block space-y-1">
        <span className={SCHEDULER_METADATA_LABEL}>Lower price ($)</span>
        <input
          type="number"
          min={0}
          step={1}
          value={offerDollars}
          onChange={(e) => setOfferDollars(e.target.value)}
          className={cn(SCHEDULER_INPUT, "h-9 tabular-nums")}
          placeholder={suggestedDollars > 0 ? String(suggestedDollars) : "0"}
        />
      </label>

      <p className="text-[11px] leading-snug text-slate-400">{smsPreview}</p>

      <button
        type="button"
        disabled={smsState === "sending" || parsedDollars <= 0}
        onClick={mockSendSms}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50",
          "bg-emerald-500/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-200",
          "transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-500/25 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)]",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {smsState === "sending" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        )}
        {smsState === "sent" ? "SMS queued (mock)" : "Send rescue SMS (mock)"}
      </button>

      {smsMessage ? (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
          <Sparkles className="h-3 w-3" aria-hidden />
          {smsMessage}
        </p>
      ) : null}
    </div>
  )
}
