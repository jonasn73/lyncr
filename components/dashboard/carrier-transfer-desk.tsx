"use client"

// Carrier Transfer Desk — correction form with strict regex validation before Telnyx submit.

import { useEffect, useMemo, useState } from "react"
import { Loader2, Send, CheckCircle2 } from "lucide-react"
import {
  portingPinPatternForOrder,
  requiresExactEightDigitWirelessPin,
  storedPortingPinForDesk,
  validatePortingDeskSubmission,
} from "@/lib/porting-desk-validation"
import { orderRequiresPinCorrection } from "@/lib/porting-pin-correction"
import type { PortingOrder } from "@/lib/types"
import { cn } from "@/lib/utils"

export type CarrierTransferDeskSubmitPayload = {
  pin?: string
  message?: string
}

type Props = {
  order: PortingOrder
  sending: boolean
  pinCorrectionRequired?: boolean
  pinSavedPendingReview?: boolean
  submitSuccessMessage?: string | null
  conversationSnippets?: string[]
  onSubmit: (payload: CarrierTransferDeskSubmitPayload) => void | Promise<void>
}

export function CarrierTransferDesk({
  order,
  sending,
  pinCorrectionRequired,
  pinSavedPendingReview,
  submitSuccessMessage,
  conversationSnippets = [],
  onSubmit,
}: Props) {
  const initialPin = useMemo(() => storedPortingPinForDesk(order), [order])
  const [reply, setReply] = useState("")
  const [pin, setPin] = useState(initialPin)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [showPinEditor, setShowPinEditor] = useState(false)

  useEffect(() => {
    setPin(storedPortingPinForDesk(order))
  }, [order.id, order.pin_or_sid, order.updated_at, order])

  const pinRequired =
    pinCorrectionRequired ?? orderRequiresPinCorrection(order, conversationSnippets)
  const pinPendingReview =
    pinSavedPendingReview ??
    (Boolean(storedPortingPinForDesk(order)) &&
      (order.telnyx_status ?? "").toLowerCase().includes("exception") &&
      pinRequired === false)
  const showPinForm = pinRequired || (pinPendingReview && showPinEditor)
  const pinPattern = useMemo(() => portingPinPatternForOrder(order), [order])
  const exactEight = requiresExactEightDigitWirelessPin(order)
  const pinHint = exactEight
    ? "Exactly 8 digits required for this wireless carrier."
    : pinRequired
      ? "4–8 digit transfer PIN from your carrier app (numbers only)."
      : "4–8 digits if correcting a PIN/passcode."

  function handleSubmit() {
    const needsPin = pinRequired || (pinPendingReview && showPinEditor)
    const validation = validatePortingDeskSubmission({
      order,
      pinRequired: needsPin,
      pin,
      message: reply,
    })
    if (!validation.ok) {
      setFieldError(validation.message)
      return
    }
    setFieldError(null)
    const pinTrimmed = pin.trim()
    const messageTrimmed = reply.trim()
    void onSubmit({
      pin: pinTrimmed || undefined,
      message: needsPin ? undefined : messageTrimmed || undefined,
    })
  }

  const pinTrimmed = pin.trim()
  const pinInvalid = pinTrimmed.length > 0 && !pinPattern.test(pinTrimmed)
  const submitBlocked = (pinRequired || (pinPendingReview && showPinEditor)) && !pinPattern.test(pinTrimmed)

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      {submitSuccessMessage ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2.5 text-xs text-emerald-100"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <p>{submitSuccessMessage}</p>
        </div>
      ) : null}

      {pinPendingReview && !showPinForm ? (
        <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-3">
          <p className="text-xs font-medium text-emerald-100">
            PIN on file — carrier is re-reviewing your transfer
          </p>
          <p className="text-[11px] leading-snug text-emerald-200/80">
            Telnyx may still show a red PIN warning for a few minutes while they process your correction.
            You do not need to submit again unless the carrier rejects a different PIN.
          </p>
          <button
            type="button"
            onClick={() => setShowPinEditor(true)}
            className="text-[11px] font-semibold text-sky-300 underline-offset-2 hover:underline"
          >
            Use a different PIN
          </button>
        </div>
      ) : null}

      {showPinForm || order.status === "rejected" ? (
        <label className="block text-xs font-medium text-red-200/90">
          Correct Account PIN/Passcode
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            name="lyncr-porting-pin"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 8))
              setFieldError(null)
            }}
            placeholder="Transfer PIN from your carrier app"
            aria-invalid={pinInvalid || Boolean(fieldError?.toLowerCase().includes("pin"))}
            className={cn(
              "mt-1 w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm text-foreground",
              pinInvalid || fieldError?.toLowerCase().includes("pin")
                ? "border-red-500 ring-1 ring-red-500/40"
                : pinPendingReview
                  ? "border-emerald-500/40"
                  : "border-red-500/40"
            )}
          />
          <span className="mt-1 block text-[10px] text-red-200/70">{pinHint}</span>
        </label>
      ) : null}

      {!pinRequired && !pinPendingReview ? (
        <label className="block text-xs font-medium text-zinc-400">
          Reply / Provide Missing Info to Carrier Desk
          <textarea
            value={reply}
            onChange={(e) => {
              setReply(e.target.value)
              setFieldError(null)
            }}
            rows={4}
            placeholder="Answer the carrier desk (account number, invoice, LOA details, etc.)"
            aria-invalid={Boolean(fieldError && !fieldError.toLowerCase().includes("pin"))}
            className={cn(
              "mt-1 w-full resize-y rounded-lg border bg-zinc-900/80 px-3 py-2 text-sm text-foreground placeholder:text-zinc-600",
              fieldError && !fieldError.toLowerCase().includes("pin")
                ? "border-red-500 ring-1 ring-red-500/40"
                : "border-zinc-800"
            )}
          />
        </label>
      ) : (
        <p className="text-[11px] leading-snug text-amber-200/90">
          Submit Correction sends your PIN to the carrier via Telnyx — not as a chat comment — so the
          exception clears.
        </p>
      )}

      {fieldError ? (
        <p
          className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200"
          role="alert"
        >
          {fieldError}
        </p>
      ) : null}

      {!(pinPendingReview && !showPinForm) ? (
      <button
        type="button"
        disabled={sending || !order.id || submitBlocked}
        onClick={handleSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        Submit Correction to Carrier
      </button>
      ) : null}
    </div>
  )
}
