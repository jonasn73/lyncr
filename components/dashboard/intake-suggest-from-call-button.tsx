"use client"

// Confirm-only “Suggest from call” — prefills intake; never auto-books.

import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type { ServiceQuoteTypeId } from "@/lib/service-rate-card"

export type IntakeSuggestApplyPayload = {
  serviceTypeId: ServiceQuoteTypeId
  suggestedPriceCents: number | null
  notesDraft: string
  summary: string
}

type IntakeSuggestFromCallButtonProps = {
  phone?: string | null
  notes?: string | null
  customerName?: string | null
  customerNotes?: string | null
  openServiceTypeId?: string | null
  openQuoteCents?: number | null
  vehicleYear?: string | null
  vehicleMake?: string | null
  vehicleModel?: string | null
  callContext?: string | null
  onApply: (suggestion: IntakeSuggestApplyPayload) => void
  className?: string
  compact?: boolean
}

export function IntakeSuggestFromCallButton({
  phone,
  notes,
  customerName,
  customerNotes,
  openServiceTypeId,
  openQuoteCents,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  callContext,
  onApply,
  className,
  compact = false,
}: IntakeSuggestFromCallButtonProps) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/intake/suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          notes,
          customerName,
          customerNotes,
          openServiceTypeId,
          openQuoteCents,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          callContext,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: IntakeSuggestApplyPayload & { requires_confirmation?: boolean }
      }
      if (!res.ok || !json.data) {
        toast({
          title: "Could not suggest",
          description: json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      onApply({
        serviceTypeId: json.data.serviceTypeId,
        suggestedPriceCents: json.data.suggestedPriceCents,
        notesDraft: json.data.notesDraft,
        summary: json.data.summary,
      })
      toast({
        title: "Suggestion ready — confirm before booking",
        description: json.data.summary,
      })
    } catch (e) {
      toast({
        title: "Could not suggest",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/10 font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-60",
        compact ? "min-h-9 px-2.5 text-[11px]" : "min-h-10 px-3 text-xs",
        className
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      )}
      {busy ? "Suggesting…" : "Suggest from call"}
    </button>
  )
}
