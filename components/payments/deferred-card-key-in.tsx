"use client"

// Key in a card with Payment Element — createPaymentMethod only (no charge yet).
// Tip screen comes next; Confirm there creates one PaymentIntent for job + tip.

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import {
  CARD_FORM_LOAD_TIMEOUT_MESSAGE,
  ELEMENTS_LOAD_TIMEOUT_MS,
  PAYMENT_CONFIRM_TIMEOUT_MS,
  withTimeout,
} from "@/lib/payment-timeout"
import {
  formatPaymentCatchError,
  formatStripeCardFailure,
} from "@/lib/stripe-payment-errors"

export function DeferredCardKeyInForm(props: {
  /** Service total shown while keying (tip added later — nothing charged here). */
  amountLabel: string
  onSaved: (paymentMethodId: string) => void
  onCancel: () => void
  onError?: (message: string) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elementReady, setElementReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const payGenRef = useRef(0)
  const elementReadyRef = useRef(false)

  useEffect(() => {
    elementReadyRef.current = elementReady
  }, [elementReady])

  useEffect(() => {
    if (elementReady || loadFailed) return
    const t = window.setTimeout(() => {
      if (elementReadyRef.current) return
      setLoadFailed(true)
      const message = CARD_FORM_LOAD_TIMEOUT_MESSAGE
      setError(message)
      props.onError?.(message)
    }, ELEMENTS_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once load watchdog
  }, [elementReady, loadFailed])

  useEffect(() => {
    if (elementReady || loadFailed || stripe) return
    const t = window.setTimeout(() => {
      if (elementReadyRef.current || stripe) return
      setLoadFailed(true)
      const message =
        "Stripe could not load on this device. Try Safari (not an in-app browser), or send a pay link."
      setError(message)
      props.onError?.(message)
    }, ELEMENTS_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stripe null watchdog
  }, [stripe, elementReady, loadFailed])

  function markLoadFailed(message: string) {
    setLoadFailed(true)
    setError(message)
    props.onError?.(message)
  }

  function cancel() {
    payGenRef.current += 1
    setBusy(false)
    setError(null)
    props.onCancel()
  }

  /** Save card details only — do NOT confirmPayment / charge. */
  async function saveCardNoCharge() {
    if (loadFailed) {
      cancel()
      return
    }
    if (!stripe || !elements || !elementReady) {
      const message = "Card form is still loading — wait a second and try again."
      setError(message)
      props.onError?.(message)
      return
    }
    const gen = ++payGenRef.current
    setBusy(true)
    setError(null)
    try {
      const { error: submitError } = await withTimeout(
        elements.submit(),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        "Saving the card timed out. Check the details and try again."
      )
      if (payGenRef.current !== gen) return
      if (submitError) {
        throw new Error(
          formatStripeCardFailure(submitError, "Check the card details and try again.")
        )
      }
      // createPaymentMethod stores the card with Stripe — no money moves yet.
      // Pass country here so AVS keyed cards work even if the Element does not collect it.
      // ZIP still comes from the Element when fields.billingDetails is 'auto'.
      const result = await withTimeout(
        stripe.createPaymentMethod({
          elements,
          params: {
            billing_details: {
              address: {
                country: "US",
              },
            },
          },
        }),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        "Saving the card timed out. Check the details and try again."
      )
      if (payGenRef.current !== gen) return
      if (result.error || !result.paymentMethod?.id) {
        throw new Error(
          formatStripeCardFailure(
            result.error,
            "Could not save the card — check the number and ZIP."
          )
        )
      }
      props.onSaved(result.paymentMethod.id)
    } catch (e) {
      if (payGenRef.current !== gen) return
      const message = formatPaymentCatchError(e, "Could not save the card — try again.")
      setError(message)
      props.onError?.(message)
    } finally {
      if (payGenRef.current === gen) setBusy(false)
    }
  }

  return (
    <div className="space-y-3 px-1 pb-2">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
          Service (before tip)
        </p>
        <p className="text-lg font-bold tabular-nums text-emerald-100">{props.amountLabel}</p>
        <p className="mt-1 text-[11px] leading-snug text-emerald-100/80">
          Key the card now — nothing is charged until the customer finishes tip.
        </p>
      </div>

      <div className="min-h-[12rem] rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
        {!elementReady && !loadFailed ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading card form…
          </div>
        ) : null}
        {!loadFailed ? (
          <PaymentElement
            onReady={() => {
              setElementReady(true)
              setLoadFailed(false)
              setError(null)
            }}
            onLoadError={(event) => {
              const raw = event?.error?.message || "Stripe could not show the card form."
              markLoadFailed(`${raw} Go Back and try again, or send a pay link.`)
            }}
            options={{
              layout: "tabs",
              wallets: { applePay: "never", googlePay: "never" },
              // Must be the string 'auto' | 'never' — nested address objects crash Stripe.js.
              // 'auto' collects ZIP for AVS; country is still passed in createPaymentMethod.
              fields: {
                billingDetails: "auto",
              },
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-sm font-semibold text-rose-300">Card form unavailable</p>
            <p className="max-w-xs text-xs leading-snug text-muted-foreground">
              Stripe never finished loading on this screen. Use Try again, or send a pay link.
            </p>
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
          <p className="text-xs font-semibold text-rose-300">
            {loadFailed ? "Card form failed to load" : "Could not save card"}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-rose-200/90">{error}</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancel}
          className="flex-1 rounded-lg border border-zinc-700 px-3 py-3 text-sm font-semibold text-slate-300"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy || (!loadFailed && (!stripe || !elementReady))}
          onClick={() => {
            if (loadFailed) {
              cancel()
              return
            }
            void saveCardNoCharge()
          }}
          className="flex flex-[1.4] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Saving card…
            </>
          ) : loadFailed ? (
            "Try again"
          ) : !stripe || !elementReady ? (
            "Loading…"
          ) : (
            "Hand phone to customer →"
          )}
        </button>
      </div>
      <p className="text-center text-[10px] leading-snug text-muted-foreground">
        Card saved — next the customer adds a tip. Nothing charged yet.
      </p>
    </div>
  )
}
