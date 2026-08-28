"use client"

// On-the-go Collect Payment — job pick OR walk-up charge, then optional invoice send.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  readHeaderMoneyCache,
  writeHeaderMoneyCache,
} from "@/lib/header-money-cache"
import dynamic from "next/dynamic"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripeTerminal, type Terminal } from "@stripe/terminal-js"
import { useCollectJobsQuery } from "@/lib/hooks/use-collect-jobs-query"
import { pickOpenCollectJobForPhone } from "@/lib/collect-job-match"
import {
  CreditCard,
  Loader2,
  MapPin,
  Plus,
  ArrowLeft,
  Nfc,
  Link2,
  MessageSquare,
  Search,
  X,
  History,
  RefreshCw,
} from "lucide-react"
import type { OwnerCollectedTransaction } from "@/lib/owner-collected"
import { formatCollectedDollars } from "@/lib/owner-collected"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { CustomerSignaturePad } from "@/components/payments/customer-signature-pad"
import { DeferredCardKeyInForm } from "@/components/payments/deferred-card-key-in"
import {
  tipCentsFromChoice,
  tipLastSheetSubtitle,
  tipLastTotalNote,
  tipLastPrimaryCta,
  tipCustomerConfirmCta,
  tipCustomerReadyNote,
  cardKeyedHandOffCopy,
  tipSignSheetTitle,
  tipSignHandBackCue,
  postPaySignSheetTitle,
  postPaySignSheetSubtitle,
  postPaySignPrimaryCta,
  shouldOfferOptionalSignature,
  type PaidChargeChannel,
} from "@/lib/payment-slip-ui"
import { type TipChargeResult } from "@/components/payments/charge-result-summary"
import { PaymentReceiptPanel } from "@/components/payments/payment-receipt-panel"
import { PayLinkSentPanel } from "@/components/payments/pay-link-sent-panel"
import {
  formatPaymentCatchError,
  formatStripeCardFailure,
  isStripeLivePublishableKey,
  isStripeTestPublishableKey,
  tapToPayNoReaderMessage,
} from "@/lib/stripe-payment-errors"
import {
  CARD_CHARGE_TIMEOUT_MESSAGE,
  CARD_FORM_LOAD_TIMEOUT_MESSAGE,
  ELEMENTS_LOAD_TIMEOUT_MS,
  PAYMENT_API_TIMEOUT_MS,
  PAYMENT_CONFIRM_TIMEOUT_MS,
  TERMINAL_COLLECT_TIMEOUT_MS,
  TERMINAL_DISCOVER_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "@/lib/payment-timeout"
import { useToast } from "@/hooks/use-toast"
import { openGetPaidModal } from "@/lib/settings-modals-events"

/** True when the string has enough digits for a US SMS (10+). */
function hasUsableSmsPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10
}

/** list → pick job; adhoc → amount; card_entry → key-in; tip_sign → tip then charge (card/tap); send_link → SMS only (no tip); link_sent → success; sign/receipt after pay. */
type CollectMode =
  | "list"
  | "adhoc"
  | "card_entry"
  | "tip_sign"
  | "send_link"
  | "link_sent"
  | "sign"
  | "receipt"
type ListTab = "collect" | "history"
type TipChoice = "none" | "15" | "18" | "20" | "custom"
/** Chosen on the amount step — tip screen only charges this way (once). */
type PendingChargeMethod = "tap" | "card" | "link"

function pendingMethodLabel(method: PendingChargeMethod | null): string {
  if (method === "tap") return "Tap to Pay"
  if (method === "card") return "Card"
  if (method === "link") return "Pay link"
  return "Payment"
}

function formatHistoryWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function historyMethodLabel(method: OwnerCollectedTransaction["paymentMethod"]): string {
  if (method === "TAP_TO_PAY") return "Tap to Pay"
  if (method === "CASH") return "Cash"
  return "Card"
}

function historyStatusClass(status: OwnerCollectedTransaction["status"]): string {
  if (status === "COMPLETED") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
  if (status === "FAILED") return "border-rose-500/35 bg-rose-500/10 text-rose-300"
  return "border-amber-500/35 bg-amber-500/10 text-amber-200"
}

type JobPayLinkBadge = {
  jobId: string | null
  chargeCents: number
  paymentStatus: string
  walletSettled: boolean
  fulfilledNow?: boolean
  url: string
  token: string
}

const TechPaymentModal = dynamic(
  () =>
    import("@/components/tech/tech-payment-modal").then((m) => ({
      default: m.TechPaymentModal,
    })),
  { ssr: false }
)

let stripePromiseCache = new Map<string, Promise<Stripe | null>>()
function getStripePromise(publishableKey: string, stripeAccount?: string | null) {
  const acct = (stripeAccount || "").trim()
  const cacheKey = `${publishableKey}::${acct || "platform"}`
  let p = stripePromiseCache.get(cacheKey)
  if (!p) {
    p = loadStripe(publishableKey, acct ? { stripeAccount: acct } : undefined)
    stripePromiseCache.set(cacheKey, p)
  }
  return p
}

function formatDollarsFromJob(job: DispatchJob): string | null {
  const cents = (job as DispatchJob & { quoted_price_cents?: number | null }).quoted_price_cents
  if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }
  return null
}

function jobTitle(job: DispatchJob): string {
  return (
    (job.customer_name ?? "").trim() ||
    (job.customer_phone ?? "").trim() ||
    (job.summary ?? "").trim() ||
    "Job"
  )
}

function AdhocCardForm({
  onDone,
  onCancel,
  onError,
  stripeConnectAccountId,
  amountLabel,
}: {
  onDone: (paymentIntentId: string) => void
  onCancel: () => void
  /** Parent can keep the decline reason for the receipt summary. */
  onError?: (message: string) => void
  stripeConnectAccountId?: string | null
  /** Shown above the card fields so amount stays visible on the charge step. */
  amountLabel?: string | null
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elementReady, setElementReady] = useState(false)
  // True when Stripe.js / Payment Element never mounted — unlock UI (no endless Loading…).
  const [loadFailed, setLoadFailed] = useState(false)
  // Bump this to invalidate in-flight pay() so a late Stripe resolve cannot re-stick busy.
  const payGenRef = useRef(0)
  // Ref so the load-timeout callback always sees the latest ready flag (no stale closure).
  const elementReadyRef = useRef(false)

  useEffect(() => {
    elementReadyRef.current = elementReady
  }, [elementReady])

  // If Payment Element never mounts (Connect / blocked Stripe.js / Safari), fail visibly.
  useEffect(() => {
    if (elementReady || loadFailed) return
    const t = window.setTimeout(() => {
      // Still not ready after ELEMENTS_LOAD_TIMEOUT_MS → stop spinner, show Try again.
      if (elementReadyRef.current) return
      setLoadFailed(true)
      const message = CARD_FORM_LOAD_TIMEOUT_MESSAGE
      setError(message)
      onError?.(message)
    }, ELEMENTS_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
    // Intentionally omit onError — inline parent callbacks would reset the timer every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once load watchdog
  }, [elementReady, loadFailed])

  // Stripe.js itself never loaded (useStripe stays null) — same fail path.
  useEffect(() => {
    if (elementReady || loadFailed || stripe) return
    const t = window.setTimeout(() => {
      if (elementReadyRef.current || stripe) return
      setLoadFailed(true)
      const message =
        "Stripe could not load on this device. Try Safari (not an in-app browser), or send a pay link."
      setError(message)
      onError?.(message)
    }, ELEMENTS_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stripe null watchdog
  }, [stripe, elementReady, loadFailed])

  // Belt-and-suspenders: even if Promise.race fails (Safari timer quirks), clear busy.
  useEffect(() => {
    if (!busy) return
    const genAtStart = payGenRef.current
    const watchdog = window.setTimeout(() => {
      if (payGenRef.current !== genAtStart) return
      payGenRef.current += 1
      setBusy(false)
      const message = CARD_CHARGE_TIMEOUT_MESSAGE
      setError(message)
      onError?.(message)
    }, PAYMENT_CONFIRM_TIMEOUT_MS + 1_500)
    return () => window.clearTimeout(watchdog)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm when busy flips
  }, [busy])

  function forceCancelCharge() {
    // Invalidate any in-flight pay(); Stripe may keep working but UI must unlock.
    payGenRef.current += 1
    setBusy(false)
    setError(null)
    onCancel()
  }

  function markLoadFailed(message: string) {
    setLoadFailed(true)
    setError(message)
    onError?.(message)
  }

  async function pay() {
    // Stripe.js / Payment Element not ready — do not set busy or the button spins forever.
    if (loadFailed) {
      forceCancelCharge()
      return
    }
    if (!stripe || !elements || !elementReady) {
      const message = "Card form is still loading — wait a second and try again."
      setError(message)
      onError?.(message)
      return
    }
    const gen = ++payGenRef.current
    setBusy(true)
    setError(null)
    try {
      const { error: submitError } = await withTimeout(
        elements.submit(),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        CARD_CHARGE_TIMEOUT_MESSAGE
      )
      if (payGenRef.current !== gen) return
      if (submitError) {
        throw new Error(
          formatStripeCardFailure(submitError, "Check the card details and try again.")
        )
      }
      // confirmPayment can hang on 3DS / wallet sheets — always race a timeout.
      // Country may not be collected by Payment Element 'auto' fields — pass US for AVS keyed cards.
      const result = await withTimeout(
        stripe.confirmPayment({
          elements,
          redirect: "if_required",
          confirmParams: {
            payment_method_data: {
              billing_details: {
                address: {
                  country: "US",
                },
              },
            },
          },
        }),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        CARD_CHARGE_TIMEOUT_MESSAGE
      )
      if (payGenRef.current !== gen) return
      if (result.error) {
        throw new Error(
          formatStripeCardFailure(result.error, "Card was declined — try another card.")
        )
      }
      const pi = result.paymentIntent
      // Requires_action without a final success (rare when redirect: if_required)
      if (pi && pi.status !== "succeeded" && pi.status !== "requires_capture") {
        throw new Error(
          `Payment not completed (status: ${pi.status}). Ask the customer to approve the bank prompt, or try another card.`
        )
      }
      if (pi?.id) {
        const confirmRes = await fetchWithTimeout(
          "/api/payments/confirm",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paymentIntentId: pi.id,
              stripeConnectAccountId: stripeConnectAccountId || undefined,
            }),
          },
          PAYMENT_API_TIMEOUT_MS,
          "Card may have charged, but Lyncr confirmation timed out. Check Stripe before retrying."
        )
        if (payGenRef.current !== gen) return
        if (!confirmRes.ok) {
          const json = (await confirmRes.json().catch(() => ({}))) as { error?: string }
          throw new Error(
            json.error ||
              "Card charged, but Lyncr could not confirm it yet. Check Stripe Dashboard before retrying."
          )
        }
        onDone(pi.id)
        return
      }
      throw new Error("Payment finished but Stripe did not return a payment id. Check Stripe Dashboard.")
    } catch (e) {
      if (payGenRef.current !== gen) return
      const message = formatPaymentCatchError(e, "Card payment failed — try another card.")
      setError(message)
      onError?.(message)
    } finally {
      // Always clear spinner for this generation — even on timeout / hang recovery.
      if (payGenRef.current === gen) setBusy(false)
    }
  }

  return (
    <div className="space-y-3 px-1 pb-2">
      {amountLabel ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
            Charging
          </p>
          <p className="text-lg font-bold tabular-nums text-emerald-100">{amountLabel}</p>
        </div>
      ) : null}

      <div className="min-h-[12rem] rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
        {/* Spinner only while still hoping the iframe will appear */}
        {!elementReady && !loadFailed ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading card form…
          </div>
        ) : null}
        {/* Keep Payment Element mounted so Stripe can finish even after we show an error */}
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
              // Wallets (Apple/Google Pay) can stall mount on mobile WebViews — card-only for keyed entry.
              wallets: { applePay: "never", googlePay: "never" },
              // Must be the string 'auto' | 'never' — nested address objects crash Stripe.js.
              // 'auto' collects ZIP for AVS; country is still passed in confirmPayment.
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
            {loadFailed ? "Card form failed to load" : "Card charge failed"}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-rose-200/90">
            <span className="font-semibold">Why: </span>
            {error}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-rose-100/80">
            If this keeps happening on Safari or in-app browsers, send a pay link instead.
          </p>
        </div>
      ) : null}

      {busy ? (
        <button
          type="button"
          onClick={forceCancelCharge}
          className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm font-semibold text-amber-100"
        >
          Cancel charge — unlock form
        </button>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={forceCancelCharge}
          className="flex-1 rounded-lg border border-zinc-700 px-3 py-3 text-sm font-semibold text-slate-300"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy || (!loadFailed && (!stripe || !elementReady))}
          onClick={() => {
            if (loadFailed) {
              // Unlock → back to amount / Card button so they can retry a fresh PaymentIntent.
              forceCancelCharge()
              return
            }
            void pay()
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Charging…
            </>
          ) : loadFailed ? (
            "Try again"
          ) : !stripe || !elementReady ? (
            "Loading…"
          ) : (
            "Charge card"
          )}
        </button>
      </div>
    </div>
  )
}

export function OwnerCollectPaymentSheet({
  open,
  onOpenChange,
  onCollected,
  prefill = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCollected?: () => void
  /** CRM / deep-link: prefill name+phone and optionally open Add charge. */
  prefill?: {
    customerName?: string
    customerPhone?: string
    startAdhoc?: boolean
    /** When set, open TechPaymentModal for this job once the list loads. */
    jobId?: string
  } | null
}) {
  const { toast } = useToast()
  // Instant from session cache when possible; refreshes in the background.
  const { jobs, isLoading: loading, error: jobsError } = useCollectJobsQuery(open)

  useEffect(() => {
    if (!open || !jobsError) return
    toast({
      title: "Could not load jobs",
      description: "Try again in a moment.",
      variant: "destructive",
    })
  }, [open, jobsError, toast])
  const [payJob, setPayJob] = useState<DispatchJob | null>(null)
  /** Latest pay-link status keyed by job id (from /api/payments/pay-links). */
  const [linkByJobId, setLinkByJobId] = useState<Record<string, JobPayLinkBadge>>({})
  /** Stripe Connect: shop must finish Get paid before card charges. */
  const [connectReady, setConnectReady] = useState<boolean | null>(null)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)
  // list → jobs; adhoc → amount + method; card_entry → key card (no charge);
  // tip_sign → tip LAST then ONE charge (card/tap); send_link → SMS only; sign → optional pad; receipt
  const [mode, setMode] = useState<CollectMode>("list")
  /** How they chose to pay on the amount step (tip comes after). */
  const [pendingMethod, setPendingMethod] = useState<PendingChargeMethod | null>(null)
  /** pm_… from deferred key-in — charged only after tip Confirm. */
  const [savedPaymentMethodId, setSavedPaymentMethodId] = useState<string | null>(null)
  const [listTab, setListTab] = useState<ListTab>("collect")

  // CRM / Messages: open the matching job charge when prefill.jobId (or phone match) is set.
  useEffect(() => {
    if (!open || !prefill) return
    const wantId = prefill.jobId?.trim() || ""
    // Only auto-open a job when CRM/Messages asked for a job (or unpaid phone path with jobId).
    if (!wantId) return
    if (payJob) return
    const byId = jobs.find((j) => j.id === wantId) ?? null
    const byPhone =
      byId ?? pickOpenCollectJobForPhone(jobs, prefill.customerPhone ?? null)
    if (byPhone) {
      setPayJob(byPhone)
      return
    }
    // Job list loaded empty / mismatch — fall back to walk-up with name+phone.
    if (!loading) {
      setMode("adhoc")
      setListTab("collect")
    }
  }, [open, prefill, jobs, loading, payJob])
  const [historyRows, setHistoryRows] = useState<OwnerCollectedTransaction[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historySearch, setHistorySearch] = useState("")
  const [historyDebouncedQ, setHistoryDebouncedQ] = useState("")
  /** Collected period totals — seed from header money cache; null until known (never fake $0). */
  const [collectedTodayCents, setCollectedTodayCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache()
    return cached && typeof cached.todayCents === "number" ? cached.todayCents : null
  })
  const [collectedWeekCents, setCollectedWeekCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache()
    return cached && typeof cached.weekCents === "number" ? cached.weekCents : null
  })
  const [collectedMonthCents, setCollectedMonthCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache()
    return cached && typeof cached.monthCents === "number" ? cached.monthCents : null
  })
  const [adhocAmount, setAdhocAmount] = useState("")
  const [adhocNote, setAdhocNote] = useState("")
  const [taxEnabled, setTaxEnabled] = useState(true)
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  const [taxDefaultsReady, setTaxDefaultsReady] = useState(false)
  const [adhocBusy, setAdhocBusy] = useState(false)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [stripeConnectAccountId, setStripeConnectAccountId] = useState<string | null>(null)
  // Set after a successful walk-up charge (or pending base before tip charge).
  const [paidPaymentIntentId, setPaidPaymentIntentId] = useState<string | null>(null)
  /** Service+tax base (pre-tip). Set when entering tip_sign; stays base for receipt summary. */
  const [paidTotalCents, setPaidTotalCents] = useState(0)
  /** How the charge was taken (keyed ZIP vs Tap vs cash) — controls post-pay signature UI. */
  const [paidChargeChannel, setPaidChargeChannel] = useState<PaidChargeChannel | null>(null)
  const [tipChoice, setTipChoice] = useState<TipChoice>("none")
  const [customTipDollars, setCustomTipDollars] = useState("")
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [slipBusy, setSlipBusy] = useState(false)
  /** Tip included in the single charge — shown on the Send receipt screen. */
  const [tipResult, setTipResult] = useState<TipChargeResult>({ kind: "none" })
  const [receiptName, setReceiptName] = useState("")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState("")
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("email")
  const [receiptBusy, setReceiptBusy] = useState(false)
  // Pre-pay: text a Stripe Checkout link (walk-up / CRM).
  const [payLinkName, setPayLinkName] = useState("")
  const [payLinkPhone, setPayLinkPhone] = useState("")
  /** When false + known phone: show “We’ll text …” instead of a blank input. */
  const [payLinkPhoneEditing, setPayLinkPhoneEditing] = useState(true)
  const [payLinkUrl, setPayLinkUrl] = useState<string | null>(null)

  const resetAdhoc = useCallback(() => {
    setMode("list")
    setListTab("collect")
    setPayJob(null)
    setAdhocAmount("")
    setAdhocNote("")
    // Keep business tax defaults when resetting a charge (loaded separately).
    if (!taxDefaultsReady) {
      setTaxEnabled(true)
      setTaxRatePercent("6")
    }
    setClientSecret(null)
    setPublishableKey(null)
    setAdhocBusy(false)
    setTapListening(false)
    setPendingMethod(null)
    setSavedPaymentMethodId(null)
    setPaidPaymentIntentId(null)
    setPaidTotalCents(0)
    setPaidChargeChannel(null)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setSlipBusy(false)
    setTipResult({ kind: "none" })
    setReceiptName("")
    setReceiptEmail("")
    setReceiptPhone("")
    setReceiptChannel("email")
    setPayLinkName("")
    setPayLinkPhone("")
    setPayLinkPhoneEditing(true)
    setPayLinkUrl(null)
    setReceiptBusy(false)
    setHistorySearch("")
    setHistoryDebouncedQ("")
  }, [])

  // Load business sales-tax defaults so Charge opens with tax ON (unless Settings says off).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/settings/sales-tax", {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: { enabledDefault?: boolean; ratePercent?: number }
        }
        if (cancelled || !res.ok) return
        const enabled = json.data?.enabledDefault !== false
        const rate =
          typeof json.data?.ratePercent === "number" && Number.isFinite(json.data.ratePercent)
            ? String(json.data.ratePercent)
            : "6"
        setTaxEnabled(enabled)
        setTaxRatePercent(rate)
        setTaxDefaultsReady(true)
      } catch {
        if (!cancelled) {
          setTaxEnabled(true)
          setTaxRatePercent("6")
          setTaxDefaultsReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const loadPaymentHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (historyDebouncedQ) params.set("q", historyDebouncedQ)
      const res = await fetch(`/api/owner/collected/transactions?${params}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: { transactions?: OwnerCollectedTransaction[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Could not load history")
      setHistoryRows(Array.isArray(json.data?.transactions) ? json.data!.transactions! : [])
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not load history")
    } finally {
      setHistoryLoading(false)
    }
  }, [historyDebouncedQ])

  // Debounce History search.
  useEffect(() => {
    const t = window.setTimeout(() => setHistoryDebouncedQ(historySearch.trim()), 280)
    return () => window.clearTimeout(t)
  }, [historySearch])

  // Load history when the History tab is opened (or search changes).
  useEffect(() => {
    if (!open || mode !== "list" || listTab !== "history") return
    void loadPaymentHistory()
  }, [open, mode, listTab, loadPaymentHistory])

  // Refresh collected (sales) totals whenever Collect opens on the list.
  useEffect(() => {
    if (!open || mode !== "list") return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/owner/collected?timezone=${encodeURIComponent(
            typeof Intl !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
              : "America/New_York"
          )}`,
          {
            credentials: "include",
            cache: "no-store",
          }
        )
        const json = (await res.json()) as {
          data?: {
            todayCents?: number
            yesterdayCents?: number
            weekCents?: number
            monthCents?: number
            allTimeCents?: number
          }
        }
        if (cancelled || !res.ok) return
        const today = json.data?.todayCents
        const yesterday = json.data?.yesterdayCents
        const week = json.data?.weekCents
        const month = json.data?.monthCents
        const allTime = json.data?.allTimeCents
        if (typeof today === "number") setCollectedTodayCents(today)
        if (typeof week === "number") setCollectedWeekCents(week)
        if (typeof month === "number") setCollectedMonthCents(month)
        // Mirror into header money cache so Money sheet + next Collect open stay warm.
        if (typeof today === "number" && typeof month === "number") {
          const prev = readHeaderMoneyCache()
          writeHeaderMoneyCache({
            availableCents: prev?.availableCents ?? 0,
            pendingCents: prev?.pendingCents ?? 0,
            connectReady: prev?.connectReady ?? false,
            todayCents: today,
            yesterdayCents: typeof yesterday === "number" ? yesterday : prev?.yesterdayCents ?? 0,
            weekCents: typeof week === "number" ? week : prev?.weekCents ?? 0,
            monthCents: month,
            allTimeCents: typeof allTime === "number" ? allTime : prev?.allTimeCents ?? 0,
          })
        }
      } catch {
        /* keep last */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, mode, listTab])

  /**
   * Amount + method chosen.
   * Card → key-in first (no charge). Tap → tip LAST then charge.
   * Pay link → send contact UI only (NO owner tip — tip is customer-side if ever added).
   */
  function enterMethodStep(method: PendingChargeMethod) {
    if (adhocBreakdown.totalCents < 50) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }
    setClientSecret(null)
    setPublishableKey(null)
    setTapListening(false)
    setAdhocBusy(false)
    setPayLinkUrl(null)
    setPaidPaymentIntentId(null)
    setPaidTotalCents(adhocBreakdown.totalCents)
    setPaidChargeChannel(null)
    setPendingMethod(method)
    setSavedPaymentMethodId(null)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setTipResult({ kind: "none" })
    if (method === "card") {
      void startCardEntry()
      return
    }
    // Remote pay link: skip tip chips — SMS-only send step (no tip).
    if (method === "link") {
      // Prefer CRM / caller phone already on the sheet so the owner rarely re-types it.
      const known =
        payLinkPhone.trim() ||
        receiptPhone.trim() ||
        (prefill?.customerPhone ?? "").trim() ||
        ""
      if (known && !payLinkPhone.trim()) setPayLinkPhone(known)
      setPayLinkPhoneEditing(!hasUsableSmsPhone(known || payLinkPhone))
      setMode("send_link")
      return
    }
    // Tap to Pay: tip-last, then one charge.
    setMode("tip_sign")
  }

  /** Load Connect + publishable key, then show deferred Payment Element (no PI yet). */
  async function startCardEntry() {
    setAdhocBusy(true)
    try {
      const res = await fetch("/api/payments/elements-config", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        error?: string
        data?: { publishableKey?: string; stripeConnectAccountId?: string }
      }
      if (!res.ok) throw new Error(json.error || "Could not open card form")
      const pk = json.data?.publishableKey?.trim()
      const accountId = json.data?.stripeConnectAccountId?.trim()
      if (!pk || !accountId) throw new Error("Missing Stripe keys for card entry.")
      setPublishableKey(pk)
      setStripeConnectAccountId(accountId)
      setMode("card_entry")
    } catch (e) {
      toast({
        title: "Could not open card form",
        description: formatPaymentCatchError(e, "Try again or use a pay link."),
        variant: "destructive",
      })
      setPendingMethod(null)
      setMode("adhoc")
    } finally {
      setAdhocBusy(false)
    }
  }

  /** After key-in: tip LAST for the customer (still no charge). */
  function enterTipAfterCardSaved(paymentMethodId: string) {
    setSavedPaymentMethodId(paymentMethodId)
    setClientSecret(null)
    setMode("tip_sign")
    toast({
      title: "Card saved",
      description: cardKeyedHandOffCopy(),
    })
  }

  /** Tip Confirm — one charge for Card / Tap (pay link never uses this). */
  function confirmTipAndCharge() {
    if (pendingMethod === "tap") {
      void runAdhocTapToPay()
      return
    }
    if (pendingMethod === "card") {
      void chargeSavedCardWithTip()
      return
    }
  }

  /**
   * Create+confirm one PaymentIntent for job + tip using the keyed payment method.
   * Handles 3DS via handleNextAction when Stripe requires it.
   */
  async function chargeSavedCardWithTip() {
    if (!savedPaymentMethodId) {
      toast({
        title: "Card missing",
        description: "Go back and key the card again.",
        variant: "destructive",
      })
      return
    }
    const body = adhocIntentBody("MANUAL_CARD")
    if (!body) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }
    setAdhocBusy(true)
    try {
      const tipCents = selectedTipCents()
      const res = await fetchWithTimeout(
        "/api/payments/create-intent",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            tipCents,
            paymentMethodId: savedPaymentMethodId,
          }),
        },
        PAYMENT_API_TIMEOUT_MS,
        "Starting the card charge timed out. Check your connection and try again."
      )
      const json = (await res.json()) as {
        error?: string
        data?: {
          paymentIntentId?: string
          clientSecret?: string
          status?: string
          publishableKey?: string | null
          stripeConnectAccountId?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not charge card")
      const piId = json.data?.paymentIntentId
      if (!piId) throw new Error("No payment id returned")
      const connectId =
        json.data?.stripeConnectAccountId?.trim() || stripeConnectAccountId || null
      setStripeConnectAccountId(connectId)
      const status = json.data?.status || ""
      const secret = json.data?.clientSecret
      const pk = json.data?.publishableKey?.trim() || publishableKey

      // 3DS / bank prompt — complete on-device, still one charge.
      if (
        (status === "requires_action" || status === "requires_confirmation") &&
        secret &&
        pk &&
        connectId
      ) {
        const stripe = await getStripePromise(pk, connectId)
        if (!stripe) throw new Error("Stripe.js failed to load for bank verification.")
        const next = await withTimeout(
          stripe.handleNextAction({ clientSecret: secret }),
          PAYMENT_CONFIRM_TIMEOUT_MS,
          CARD_CHARGE_TIMEOUT_MESSAGE
        )
        if (next.error) {
          throw new Error(
            formatStripeCardFailure(next.error, "Bank verification failed — try another card.")
          )
        }
        const nextStatus = next.paymentIntent?.status
        if (nextStatus && nextStatus !== "succeeded" && nextStatus !== "requires_capture") {
          throw new Error(`Payment not completed (status: ${nextStatus}).`)
        }
      } else if (status && status !== "succeeded" && status !== "requires_capture") {
        throw new Error(`Payment not completed (status: ${status}).`)
      }

      const confirmRes = await fetchWithTimeout(
        "/api/payments/confirm",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentIntentId: piId,
            stripeConnectAccountId: connectId || undefined,
          }),
        },
        PAYMENT_API_TIMEOUT_MS,
        "Card may have charged, but Lyncr confirmation timed out. Check Stripe before retrying."
      )
      if (!confirmRes.ok) {
        const cj = (await confirmRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(
          cj.error ||
            "Card charged, but Lyncr could not confirm it yet. Check Stripe Dashboard before retrying."
        )
      }

      await saveSlip({ paymentIntentId: piId, tipCents }).catch(() => null)
      enterPostPaySignOrReceipt(piId, paidTotalCents + tipCents, "manual_card", tipCents)
    } catch (e) {
      toast({
        title: "Card charge failed",
        description: formatPaymentCatchError(e, "Try again or use a pay link."),
        variant: "destructive",
      })
    } finally {
      setAdhocBusy(false)
    }
  }

  /** After the single charge succeeds: save tip on slip, then optional signature or receipt. */
  function enterPostPaySignOrReceipt(
    piId: string,
    chargedCents: number,
    channel: PaidChargeChannel,
    tipCents: number
  ) {
    setClientSecret(null)
    setPublishableKey(null)
    setTapListening(false)
    setAdhocBusy(false)
    setPaidPaymentIntentId(piId)
    setPaidChargeChannel(channel)
    // Keep paidTotalCents as service+tax base for ChargeResultSummary.
    if (tipCents > 0) {
      setTipResult({ kind: "charged", cents: tipCents })
    } else {
      setTipResult({ kind: "none" })
    }
    onCollected?.()
    toast({
      variant: "success",
      title: "Payment received",
      description: fmtCents(chargedCents),
    })
    if (shouldOfferOptionalSignature(channel, chargedCents)) {
      setSignaturePng(null)
      setMode("sign")
    } else {
      setMode("receipt")
    }
  }

  function enterReceiptStep(nextTip?: TipChargeResult) {
    setClientSecret(null)
    setPublishableKey(null)
    if (nextTip) setTipResult(nextTip)
    setMode("receipt")
  }

  function selectedTipCents(): number {
    return tipCentsFromChoice(tipChoice, paidTotalCents, customTipDollars)
  }

  /** Total PI amount = service+tax base + tip (one charge). */
  function chargeTotalCents(): number {
    return Math.max(0, paidTotalCents) + selectedTipCents()
  }

  async function saveSlip(opts?: {
    tipPaymentIntentId?: string | null
    tipCents?: number
    paymentIntentId?: string
  }) {
    const piId = opts?.paymentIntentId ?? paidPaymentIntentId
    if (!piId) throw new Error("Missing payment id")
    const tipCents = opts?.tipCents ?? selectedTipCents()
    const res = await fetch("/api/payments/complete-slip", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentIntentId: piId,
        tipCents,
        signaturePng,
        tipPaymentIntentId: opts?.tipPaymentIntentId ?? undefined,
        // Required for Connect direct charges (PI lives on the shop account).
        stripeConnectAccountId: stripeConnectAccountId || undefined,
      }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not save tip / signature")
  }

  /** Post-pay optional signature → receipt. */
  async function continueFromSign() {
    setSlipBusy(true)
    try {
      const tipCents =
        tipResult.kind === "charged" ? tipResult.cents : selectedTipCents()
      await saveSlip({ tipCents })
      enterReceiptStep()
    } catch (e) {
      const message = e instanceof Error ? e.message : "Try again."
      toast({
        title: "Could not save signature",
        description: message,
        variant: "destructive",
      })
      if (paidPaymentIntentId) {
        enterReceiptStep()
        toast({
          title: "Payment is still complete",
          description: "You can send the invoice next. Signature may need a retry.",
        })
      }
    } finally {
      setSlipBusy(false)
    }
  }

  function finishAndClose() {
    resetAdhoc()
    onOpenChange(false)
  }

  const applyPayLinkBadges = useCallback(
    (links: JobPayLinkBadge[]) => {
      const map: Record<string, JobPayLinkBadge> = {}
      for (const link of links) {
        const jid = (link.jobId || "").trim()
        if (!jid) continue
        const existing = map[jid]
        const linkPaid = link.paymentStatus === "paid" || link.walletSettled
        if (!existing) {
          map[jid] = link
          continue
        }
        const existingPaid = existing.paymentStatus === "paid" || existing.walletSettled
        // Prefer Paid over Waiting; otherwise keep the first (newest) unpaid row.
        if (linkPaid && !existingPaid) map[jid] = link
      }
      setLinkByJobId(map)
      const repaired = links.filter((l) => l.fulfilledNow)
      if (repaired.length > 0) {
        toast({
          title: "Payment found",
          description: "A customer pay link was paid — your balance updated.",
        })
        onCollected?.()
      }
    },
    [toast, onCollected]
  )

  // Secondary data (Connect + badges) — never block the job list spinner.
  useEffect(() => {
    if (!open) return
    resetAdhoc()

    // After reset: apply CRM / deep-link name+phone and optionally open Add charge / job.
    if (prefill) {
      const name = (prefill.customerName ?? "").trim()
      const phone = (prefill.customerPhone ?? "").trim()
      if (name) {
        setPayLinkName(name)
        setReceiptName(name)
      }
      if (phone) {
        setPayLinkPhone(phone)
        setReceiptPhone(phone)
        setReceiptChannel("sms")
      }
      // Job path wins over walk-up — open TechPaymentModal once jobs are ready.
      if (prefill.jobId?.trim()) {
        setListTab("collect")
      } else if (prefill.startAdhoc) {
        setMode("adhoc")
        setListTab("collect")
      }
    }

    fetch("/api/payments/connect/status", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { ready?: boolean; message?: string | null } } | null) => {
        setConnectReady(j?.data?.ready === true)
        setConnectMessage(j?.data?.message ?? null)
      })
      .catch(() => {
        setConnectReady(null)
      })

    // Fast: DB badges first. Slow Stripe sync runs after so the list stays snappy.
    fetch("/api/payments/pay-links", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { links?: JobPayLinkBadge[] } } | null) => {
        const links = Array.isArray(j?.data?.links) ? j!.data!.links! : []
        applyPayLinkBadges(links)
      })
      .catch(() => {
        /* ignore — job list still works */
      })
      .finally(() => {
        void fetch("/api/payments/pay-links?sync=1", {
          credentials: "include",
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: { data?: { links?: JobPayLinkBadge[] } } | null) => {
            const links = Array.isArray(j?.data?.links) ? j!.data!.links! : []
            if (links.length) applyPayLinkBadges(links)
          })
          .catch(() => {
            /* ignore */
          })
      })
  }, [open, resetAdhoc, applyPayLinkBadges, prefill])

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aPin = coerceMapCoord(a.latitude) != null
      const bPin = coerceMapCoord(b.latitude) != null
      if (aPin !== bPin) return aPin ? -1 : 1
      return (b.created_at || "").localeCompare(a.created_at || "")
    })
  }, [jobs])

  function parseAdhocDollars(): number | null {
    const dollars = parseFloat(adhocAmount)
    if (!Number.isFinite(dollars) || dollars < 0.5) return null
    return dollars
  }

  const adhocBreakdown = useMemo(() => {
    const subtotal = parseFloat(adhocAmount)
    const subtotalCents =
      Number.isFinite(subtotal) && subtotal > 0 ? Math.round(subtotal * 100) : 0
    const rateRaw = parseFloat(taxRatePercent)
    const rate =
      taxEnabled && Number.isFinite(rateRaw) && rateRaw > 0 ? Math.min(30, rateRaw) / 100 : 0
    const taxCents = rate > 0 ? Math.round(subtotalCents * rate) : 0
    return {
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      ratePercent: rate * 100,
    }
  }, [adhocAmount, taxEnabled, taxRatePercent])

  function fmtCents(cents: number): string {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }

  /** Shared body for walk-up create-intent (card or tap) — contact from CRM prefill or pay-link fields. */
  function adhocIntentBody(paymentMethodType: "MANUAL_CARD" | "TAP_TO_PAY") {
    const dollars = parseAdhocDollars()
    if (dollars == null) return null
    // Prefer explicit pay-link fields; fall back to CRM prefill so walk-up stays linked to this phone.
    const name = payLinkName.trim() || receiptName.trim() || prefill?.customerName?.trim() || ""
    const phone = payLinkPhone.trim() || receiptPhone.trim() || prefill?.customerPhone?.trim() || ""
    return {
      adhoc: true as const,
      amount: dollars,
      paymentMethodType,
      note: adhocNote.trim() || "Service",
      taxEnabled,
      taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
      // Tip chosen on tip_sign — included in the same PaymentIntent (one charge).
      tipCents: selectedTipCents(),
      ...(name ? { customerName: name } : {}),
      ...(phone ? { customerPhone: phone } : {}),
    }
  }

  async function startAdhocIntent() {
    const body = adhocIntentBody("MANUAL_CARD")
    if (!body) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }
    setAdhocBusy(true)
    try {
      const res = await fetchWithTimeout(
        "/api/payments/create-intent",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        PAYMENT_API_TIMEOUT_MS,
        "Starting the card charge timed out. Check your connection and try again."
      )
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          publishableKey?: string | null
          stripeConnectAccountId?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not start payment")
      const secret = json.data?.clientSecret
      if (!secret) throw new Error("No client_secret returned")
      setClientSecret(secret)
      setPublishableKey(json.data?.publishableKey ?? null)
      setStripeConnectAccountId(json.data?.stripeConnectAccountId?.trim() || null)
    } catch (e) {
      toast({
        title: "Could not start payment",
        description: formatPaymentCatchError(e, "Try again in a moment."),
        variant: "destructive",
      })
    } finally {
      setAdhocBusy(false)
    }
  }

  /** Customer taps card / phone on this device (Stripe Terminal / Tap to Pay). */
  async function runAdhocTapToPay() {
    const body = adhocIntentBody("TAP_TO_PAY")
    if (!body) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }

    const tipCents = selectedTipCents()
    const expectedChargeCents = paidTotalCents + tipCents
    setAdhocBusy(true)
    setTapListening(true)
    let terminal: Terminal | null = null
    try {
      const res = await fetchWithTimeout(
        "/api/payments/create-intent",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        PAYMENT_API_TIMEOUT_MS,
        "Starting Tap to Pay timed out. Try Card or a pay link instead."
      )
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          paymentIntentId?: string
          publishableKey?: string | null
          stripeConnectAccountId?: string | null
          chargeCents?: number
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not start Tap to Pay")
      const secret = json.data?.clientSecret
      if (!secret) throw new Error("No client_secret returned")
      setStripeConnectAccountId(json.data?.stripeConnectAccountId?.trim() || null)

      // Live vs test — only test mode may use Stripe’s fake “simulated” reader.
      const pk = json.data?.publishableKey ?? publishableKey
      const liveMode = isStripeLivePublishableKey(pk)
      const allowSimulator = isStripeTestPublishableKey(pk)

      const StripeTerminal = await withTimeout(
        loadStripeTerminal(),
        TERMINAL_DISCOVER_TIMEOUT_MS,
        "Tap to Pay SDK timed out loading. Use Card or a pay link on this browser."
      )
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const tokenRes = await fetchWithTimeout(
            "/api/payments/terminal/connection-token",
            {
              method: "POST",
              credentials: "include",
            },
            PAYMENT_API_TIMEOUT_MS,
            "Terminal connection timed out. Use Card or a pay link instead."
          )
          const tokenJson = (await tokenRes.json()) as {
            data?: { secret?: string }
            error?: string
          }
          if (!tokenRes.ok || !tokenJson.data?.secret) {
            throw new Error(tokenJson.error || "Could not fetch Terminal connection token")
          }
          return tokenJson.data.secret
        },
        onUnexpectedReaderDisconnect: () => {
          toast({
            title: "Reader disconnected",
            description: "Try Tap again, or use Card / Apple Pay / Cash App.",
            variant: "destructive",
          })
          setTapListening(false)
        },
      })

      // Discover can hang on desktop browsers with no NFC — always race a timeout.
      let discover = await withTimeout(
        terminal.discoverReaders({ simulated: false }),
        TERMINAL_DISCOVER_TIMEOUT_MS,
        tapToPayNoReaderMessage(liveMode || !allowSimulator)
      )
      const noRealReader =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length

      // Never fall back to the simulator on live keys (that caused the error you saw).
      if (noRealReader && allowSimulator && !liveMode) {
        discover = await withTimeout(
          terminal.discoverReaders({ simulated: true }),
          TERMINAL_DISCOVER_TIMEOUT_MS,
          tapToPayNoReaderMessage(false)
        )
      }

      if ("error" in discover) {
        throw new Error(formatPaymentCatchError(discover.error, "Could not find a tap reader."))
      }
      const reader = discover.discoveredReaders?.[0]
      if (!reader) {
        throw new Error(tapToPayNoReaderMessage(liveMode || !allowSimulator))
      }

      const connected = await withTimeout(
        terminal.connectReader(reader),
        TERMINAL_DISCOVER_TIMEOUT_MS,
        "Could not connect to the tap reader in time. Use Card or a pay link."
      )
      if ("error" in connected) {
        throw new Error(formatPaymentCatchError(connected.error, "Could not connect to the reader."))
      }

      const collected = await withTimeout(
        terminal.collectPaymentMethod(secret),
        TERMINAL_COLLECT_TIMEOUT_MS,
        "No tap received in time. Try again, or use Card / a pay link."
      )
      if ("error" in collected) {
        throw new Error(
          formatPaymentCatchError(collected.error, "Customer didn’t complete the tap. Try again.")
        )
      }

      const processed = await withTimeout(
        terminal.processPayment(collected.paymentIntent),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        "Tap charge timed out while processing. Check Stripe before retrying."
      )
      if ("error" in processed) {
        throw new Error(
          formatPaymentCatchError(processed.error, "Tap charge failed — try Card entry.")
        )
      }

      const piId = String(processed.paymentIntent?.id || json.data?.paymentIntentId || "")
      if (!piId) throw new Error("Payment succeeded but no payment id was returned")

      await fetchWithTimeout(
        "/api/payments/confirm",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentIntentId: piId,
            stripeConnectAccountId: stripeConnectAccountId || undefined,
          }),
        },
        PAYMENT_API_TIMEOUT_MS,
        "Tap charged, but confirmation timed out. Check Stripe before retrying."
      ).catch(() => null)

      const charged =
        typeof json.data?.chargeCents === "number" && json.data.chargeCents > 0
          ? json.data.chargeCents
          : expectedChargeCents
      await saveSlip({ paymentIntentId: piId, tipCents }).catch(() => null)
      enterPostPaySignOrReceipt(piId, charged, "tap", tipCents)
    } catch (e) {
      toast({
        title: "Tap to Pay failed",
        description: formatPaymentCatchError(e, "Try Card / Apple Pay / Cash App instead."),
        variant: "destructive",
      })
    } finally {
      setTapListening(false)
      setAdhocBusy(false)
      try {
        await terminal?.disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  /** Text a Stripe Checkout link for service + tax only (no owner tip). */
  async function sendAdhocPayLink() {
    // Link amount = service (+ tax) only — tip is not chosen by the owner on send.
    const chargeCents =
      paidTotalCents > 0 ? paidTotalCents : adhocBreakdown.totalCents
    if (chargeCents < 50) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
      return
    }
    if (!hasUsableSmsPhone(payLinkPhone)) {
      toast({
        title: "Enter a mobile number",
        description: "Need a valid phone to text the pay link.",
        variant: "destructive",
      })
      setPayLinkPhoneEditing(true)
      return
    }
    setAdhocBusy(true)
    setPayLinkUrl(null)
    try {
      const res = await fetch("/api/payments/send-pay-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "sms",
          adhoc: true,
          // Total already includes tax — do not re-apply tax. No tip baked in.
          amount: chargeCents / 100,
          taxEnabled: false,
          taxRatePercent: 0,
          note: adhocNote.trim() || "Service",
          customerName: payLinkName.trim() || undefined,
          phone: payLinkPhone.trim(),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { url?: string; chargeCents?: number; sent?: boolean }
      }
      if (json.data?.url) setPayLinkUrl(json.data.url)
      if (!res.ok || json.data?.sent === false) {
        throw new Error(
          json.error ||
            "Pay link created, but the text could not be delivered. Copy the link below."
        )
      }
      // Prefer server-reported charge when present (tax/rounding).
      if (typeof json.data?.chargeCents === "number" && json.data.chargeCents > 0) {
        setPaidTotalCents(json.data.chargeCents)
      }
      // Stay on a clear success step — do not silently dump back to Collect home.
      setMode("link_sent")
    } catch (e) {
      toast({
        title: "Could not send pay link",
        description: formatPaymentCatchError(e, "Try again in a moment."),
        variant: "destructive",
      })
    } finally {
      setAdhocBusy(false)
    }
  }

  async function sendReceipt() {
    if (!paidPaymentIntentId) return
    if (receiptChannel === "email" && !receiptEmail.trim().includes("@")) {
      toast({
        title: "Enter an email",
        description: "Need a valid address to send the invoice.",
        variant: "destructive",
      })
      return
    }
    if (receiptChannel === "sms" && receiptPhone.replace(/\D/g, "").length < 10) {
      toast({
        title: "Enter a phone number",
        description: "Need a valid number to text the invoice.",
        variant: "destructive",
      })
      return
    }

    setReceiptBusy(true)
    try {
      const res = await fetch("/api/payments/send-receipt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId: paidPaymentIntentId,
          channel: receiptChannel,
          customerName: receiptName.trim() || undefined,
          email: receiptChannel === "email" ? receiptEmail.trim() : undefined,
          phone: receiptChannel === "sms" ? receiptPhone.trim() : undefined,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not send invoice")
      toast({
        title: receiptChannel === "email" ? "Invoice emailed" : "Invoice texted",
        description: "Customer gets an itemized invoice with a view link.",
      })
      finishAndClose()
    } catch (e) {
      toast({
        title: "Could not send invoice",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setReceiptBusy(false)
    }
  }

  return (
    <>
      <Sheet
        open={open && !payJob}
        onOpenChange={(next) => {
          if (!next) resetAdhoc()
          onOpenChange(next)
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className={cn(
            // Content-height bottom sheet (not sparse full-screen) — matches Latest / job sheets.
            "flex h-auto flex-col gap-0 rounded-t-2xl rounded-b-none border-zinc-800 bg-[#101018] p-0 sm:max-w-lg",
            mode === "tip_sign" ||
            mode === "send_link" ||
            mode === "link_sent" ||
            mode === "sign" ||
            mode === "card_entry" ||
            mode === "receipt"
              ? "max-h-[min(88dvh,40rem)]"
              : "max-h-[92dvh]"
          )}
        >
          {/* Mobile drag affordance — same as Just finished / Scheduler sheets. */}
          <div className="flex shrink-0 justify-center pb-0.5 pt-3 md:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-full bg-zinc-600/80" />
          </div>
          <SheetHeader
            className={cn(
              "shrink-0 px-4 pb-3 pt-2 text-left md:pt-4",
              // Paid / Link sent heroes are the star — lighter chrome than tip/charge steps.
              mode === "receipt" || mode === "link_sent"
                ? "border-b-0 pb-1"
                : "border-b border-zinc-800"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {mode === "receipt" ? (
                  <SheetTitle className="sr-only">Paid</SheetTitle>
                ) : mode === "link_sent" ? (
                  <SheetTitle className="sr-only">Link sent</SheetTitle>
                ) : (
                  <SheetTitle className="text-base font-bold text-slate-100">
                    {mode === "tip_sign"
                      ? tipSignSheetTitle(false)
                      : mode === "send_link"
                        ? "Text pay link"
                        : mode === "card_entry"
                          ? "Key in card"
                          : mode === "sign"
                            ? postPaySignSheetTitle()
                            : mode === "adhoc"
                              ? "Charge"
                              : listTab === "history"
                                ? "Payment history"
                                : "Collect from customer"}
                  </SheetTitle>
                )}
                {mode !== "receipt" && mode !== "link_sent" ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {mode === "tip_sign"
                      ? tipLastSheetSubtitle(fmtCents(paidTotalCents))
                      : mode === "send_link"
                        ? `They open the link and pay ${fmtCents(paidTotalCents)}`
                        : mode === "card_entry"
                          ? "Enter card + ZIP. Nothing charged until tip is done."
                          : mode === "sign"
                            ? postPaySignSheetSubtitle()
                            : mode === "adhoc"
                              ? "Enter amount, then choose how to pay. Tip is last for Card / Tap."
                              : listTab === "history"
                                ? "Cards, Tap to Pay, and cash you have run."
                                : "Add a charge or pick a job on today’s schedule."}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  resetAdhoc()
                  onOpenChange(false)
                }}
                className="rounded-lg p-2 text-muted-foreground hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {mode === "list" ? (
              <>
                <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
                    Collected (sales — not bank deposits)
                  </p>
                  <p className="mb-2 text-[10px] leading-snug text-emerald-200/55">
                    Full customer totals. Bank transfers are lower after the card fee.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] font-medium text-emerald-200/55">Today</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-100">
                        {formatCollectedDollars(collectedTodayCents)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-medium text-emerald-200/55">This week</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-100">
                        {formatCollectedDollars(collectedWeekCents)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-medium text-emerald-200/55">This month</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-100">
                        {formatCollectedDollars(collectedMonthCents)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
                  <button
                    type="button"
                    onClick={() => setListTab("collect")}
                    className={cn(
                      "rounded-lg py-2 text-xs font-semibold transition-colors",
                      listTab === "collect"
                        ? "bg-emerald-500/20 text-emerald-100"
                        : "text-muted-foreground hover:text-slate-200"
                    )}
                  >
                    Collect
                  </button>
                  <button
                    type="button"
                    onClick={() => setListTab("history")}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors",
                      listTab === "history"
                        ? "bg-emerald-500/20 text-emerald-100"
                        : "text-muted-foreground hover:text-slate-200"
                    )}
                  >
                    <History className="h-3.5 w-3.5" aria-hidden />
                    History
                  </button>
                </div>
              </>
            ) : null}
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {mode === "list" && listTab === "history" ? (
              <div className="space-y-3">
                <p className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                  This list is customer charges only. Bank transfers are in{" "}
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false)
                      window.setTimeout(() => openGetPaidModal(), 50)
                    }}
                    className="font-semibold text-emerald-300 underline-offset-2 hover:underline"
                  >
                    Bank &amp; payouts
                  </button>
                  .
                </p>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search name or phone"
                    className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 pl-10 pr-3 text-sm text-slate-100 placeholder:text-muted-foreground outline-none focus:border-emerald-500/40"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {historyDebouncedQ ? "Matching charges" : "Recent charges"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadPaymentHistory()}
                    disabled={historyLoading}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-emerald-300/90 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", historyLoading && "animate-spin")}
                      aria-hidden
                    />
                    Refresh
                  </button>
                </div>

                {historyLoading && historyRows.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading history…
                  </div>
                ) : historyError ? (
                  <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-4 text-center text-sm text-rose-200">
                    {historyError}
                  </p>
                ) : historyRows.length === 0 ? (
                  <p className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-8 text-center text-sm text-muted-foreground">
                    {historyDebouncedQ
                      ? "No matching charges. Try another name or phone."
                      : "No charges yet. Run a card or Tap to Pay from Collect, then check back here."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {historyRows.map((tx) => {
                      const title =
                        tx.customerName ||
                        (tx.customerPhone ? formatPhoneDisplay(tx.customerPhone) : null) ||
                        (tx.jobId ? "Job payment" : "Add charge")
                      const subtitle = [
                        historyMethodLabel(tx.paymentMethod),
                        tx.jobLabel,
                        tx.tipCents && tx.tipCents > 0
                          ? `Tip ${formatCollectedDollars(tx.tipCents)}`
                          : null,
                        tx.hasSignature ? "Signed" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                      const canReceipt =
                        tx.status === "COMPLETED" && Boolean(tx.stripePaymentIntentId)
                      return (
                        <li key={tx.id}>
                          <button
                            type="button"
                            disabled={!canReceipt}
                            onClick={() => {
                              if (!canReceipt || !tx.stripePaymentIntentId) return
                              // Re-open receipt send for this past charge.
                              setPaidPaymentIntentId(tx.stripePaymentIntentId)
                              const tipCents =
                                tx.tipCents && tx.tipCents > 0 ? tx.tipCents : 0
                              const totalCents = Math.round(tx.amount * 100)
                              // baseCents = service (+ tax) only; tip shown via tipResult
                              setPaidTotalCents(Math.max(0, totalCents - tipCents))
                              setReceiptName(tx.customerName || "")
                              setReceiptPhone(tx.customerPhone || "")
                              setTipResult(
                                tipCents > 0
                                  ? { kind: "charged", cents: tipCents }
                                  : { kind: "none" }
                              )
                              setMode("receipt")
                            }}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl border bg-zinc-900/50 px-3 py-3 text-left transition-colors",
                              canReceipt
                                ? "border-zinc-800 hover:border-emerald-500/40 hover:bg-zinc-900"
                                : "cursor-default border-zinc-800/80"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                tx.status === "COMPLETED"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : tx.status === "FAILED"
                                    ? "bg-rose-500/15 text-rose-300"
                                    : "bg-amber-500/15 text-amber-200"
                              )}
                            >
                              <CreditCard className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-start justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-slate-100">
                                  {title}
                                </span>
                                <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">
                                  {formatCollectedDollars(Math.round(tx.amount * 100))}
                                </span>
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {formatHistoryWhen(tx.createdAt)}
                                {subtitle ? ` · ${subtitle}` : ""}
                              </span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                    historyStatusClass(tx.status)
                                  )}
                                >
                                  {tx.status === "COMPLETED"
                                    ? "Paid"
                                    : tx.status === "FAILED"
                                      ? "Failed"
                                      : "Pending"}
                                </span>
                                {!tx.jobId ? (
                                  <span className="inline-flex rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    Quick
                                  </span>
                                ) : null}
                                {canReceipt ? (
                                  <span className="text-[10px] font-medium text-emerald-400/90">
                                    Tap to send receipt
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ) : mode === "list" ? (
              <>
                {connectReady === false ? (
                  <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3">
                    <p className="text-sm font-semibold text-amber-50">Finish bank setup to accept cards</p>
                    <p className="mt-1 text-xs leading-snug text-amber-100/80">
                      {connectMessage ||
                        "Connect your bank once so customers pay your business and funds go to your account."}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChange(false)
                        // Let Collect close, then open bank setup above anything else.
                        window.setTimeout(() => openGetPaidModal(), 50)
                      }}
                      className="mt-2.5 w-full rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Open bank setup
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (connectReady === false) {
                      toast({
                        title: "Bank setup required",
                        description: "Finish bank setup before collecting card payments.",
                        variant: "destructive",
                      })
                      window.setTimeout(() => openGetPaidModal(), 50)
                      return
                    }
                    setMode("adhoc")
                  }}
                  className="mb-4 flex w-full items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-left transition-colors hover:bg-emerald-500/15"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                    <Plus className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-emerald-100">Add charge</span>
                    <span className="block text-xs text-emerald-200/70">
                      No job needed — Tap to Pay or card
                    </span>
                  </span>
                </button>

                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Today’s jobs
                </p>

                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading jobs…
                  </div>
                ) : sorted.length === 0 ? (
                  <p className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-sm text-muted-foreground">
                    No open jobs right now. Tap Add charge above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sorted.map((job) => {
                      const quote = formatDollarsFromJob(job)
                      const link = linkByJobId[job.id]
                      const paid = Boolean(
                        link && (link.paymentStatus === "paid" || link.walletSettled)
                      )
                      const linkLabel = link
                        ? paid
                          ? `Paid ${fmtCents(link.chargeCents)} · in balance`
                          : `Link sent ${fmtCents(link.chargeCents)} · waiting`
                        : quote
                          ? `Quoted ${quote}`
                          : "Set amount next"
                      return (
                        <li key={job.id}>
                          <button
                            type="button"
                            onClick={() => {
                              if (connectReady === false && !(link && (link.paymentStatus === "paid" || link.walletSettled))) {
                                toast({
                                  title: "Bank setup required",
                                  description: "Finish bank setup before collecting card payments.",
                                  variant: "destructive",
                                })
                                window.setTimeout(() => openGetPaidModal(), 50)
                                return
                              }
                              setPayJob(job)
                            }}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl border bg-zinc-900/50 px-3 py-3 text-left transition-colors",
                              paid
                                ? "border-emerald-500/45 hover:border-emerald-500/60 hover:bg-zinc-900"
                                : link
                                  ? "border-sky-500/40 hover:border-sky-500/55 hover:bg-zinc-900"
                                  : "border-zinc-800 hover:border-emerald-500/40 hover:bg-zinc-900"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                paid
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : link
                                    ? "bg-sky-500/15 text-sky-300"
                                    : "bg-emerald-500/15 text-emerald-400"
                              )}
                            >
                              {link ? (
                                <Link2 className="h-4 w-4" aria-hidden />
                              ) : (
                                <CreditCard className="h-4 w-4" aria-hidden />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-100">
                                {jobTitle(job)}
                              </span>
                              {job.location ? (
                                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                                  {job.location}
                                </span>
                              ) : null}
                              <span
                                className={cn(
                                  "mt-1 block text-[11px] font-medium",
                                  paid
                                    ? "text-emerald-400"
                                    : link
                                      ? "text-sky-300"
                                      : "text-emerald-400/90"
                                )}
                              >
                                {linkLabel}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            ) : mode === "card_entry" ? (
              <div className="flex flex-col gap-3">
                {publishableKey && stripeConnectAccountId ? (
                  <Elements
                    key={`deferred-card:${stripeConnectAccountId}:${paidTotalCents}`}
                    stripe={getStripePromise(publishableKey, stripeConnectAccountId)}
                    options={{
                      mode: "payment",
                      amount: Math.max(50, paidTotalCents),
                      currency: "usd",
                      paymentMethodCreation: "manual",
                      appearance: { theme: "night", variables: { colorPrimary: "#10b981" } },
                      // Card-only keyed entry (ZIP/AVS) — wallets off.
                      paymentMethodTypes: ["card"],
                    }}
                  >
                    <DeferredCardKeyInForm
                      amountLabel={fmtCents(paidTotalCents)}
                      onCancel={() => {
                        setSavedPaymentMethodId(null)
                        setPendingMethod(null)
                        setPublishableKey(null)
                        setMode("adhoc")
                      }}
                      onSaved={(pmId) => enterTipAfterCardSaved(pmId)}
                    />
                  </Elements>
                ) : (
                  <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-3">
                    <p className="text-sm font-semibold text-rose-300">Card form not ready</p>
                    <p className="text-xs text-rose-100/80">
                      Finish bank setup, then try Card again.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingMethod(null)
                        setMode("adhoc")
                      }}
                      className="w-full rounded-lg border border-zinc-700 py-2 text-sm font-semibold text-slate-200"
                    >
                      Back
                    </button>
                  </div>
                )}
              </div>
            ) : mode === "send_link" ? (
              // Pay link only: amount already set — text SMS (no tip chips, no email).
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPayLinkUrl(null)
                    setPendingMethod(null)
                    setMode("adhoc")
                  }}
                  className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-100">
                      They open the link and pay {fmtCents(paidTotalCents)}
                    </p>
                    <p className="text-[10px] text-emerald-200/70">No tip on this step</p>
                  </div>
                  <p className="text-base font-bold tabular-nums text-emerald-300">
                    {fmtCents(paidTotalCents)}
                  </p>
                </div>

                <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
                  <input
                    type="text"
                    value={payLinkName}
                    onChange={(e) => setPayLinkName(e.target.value)}
                    placeholder="Name (optional)"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none"
                  />
                  {!payLinkPhoneEditing && hasUsableSmsPhone(payLinkPhone) ? (
                    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2">
                      <p className="text-sm font-semibold text-white">
                        We&apos;ll text{" "}
                        {formatPhoneDisplay(payLinkPhone) || payLinkPhone.trim()}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPayLinkPhoneEditing(true)}
                        className="mt-1 text-[11px] font-semibold text-sky-300 underline"
                      >
                        Wrong number?
                      </button>
                    </div>
                  ) : (
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Customer&apos;s mobile number
                      </span>
                      <input
                        type="tel"
                        value={payLinkPhone}
                        onChange={(e) => setPayLinkPhone(e.target.value)}
                        inputMode="tel"
                        placeholder="(502) 555-1234"
                        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={adhocBusy || !hasUsableSmsPhone(payLinkPhone)}
                    onClick={() => void sendAdhocPayLink()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {adhocBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Text link
                  </button>
                  {payLinkUrl ? (
                    <p className="break-all text-[10px] text-emerald-300/90">{payLinkUrl}</p>
                  ) : null}
                </div>
              </div>
            ) : mode === "link_sent" ? (
              // Success after SMS — confirm before returning to Collect home.
              <PayLinkSentPanel
                phone={payLinkPhone}
                amountCents={paidTotalCents}
                linkUrl={payLinkUrl}
                onDone={() => {
                  // Deliberate return to Collect root (jobs / stats).
                  resetAdhoc()
                }}
                onTextAgain={() => {
                  // Keep amount + phone; reopen the text form.
                  setMode("send_link")
                }}
              />
            ) : mode === "tip_sign" ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setClientSecret(null)
                    setTapListening(false)
                    if (pendingMethod === "card" && savedPaymentMethodId) {
                      // Keep saved card; go back to tip from amount would lose it —
                      // back to amount clears the keyed card.
                      setSavedPaymentMethodId(null)
                      setPendingMethod(null)
                      setPublishableKey(null)
                      setMode("adhoc")
                    } else {
                      setPendingMethod(null)
                      setMode("adhoc")
                    }
                  }}
                  className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-100">Service</p>
                    <p className="text-[10px] text-emerald-200/70">
                      Job + tax · pay with {pendingMethodLabel(pendingMethod)}
                      {pendingMethod === "card" && savedPaymentMethodId ? " · card ready" : ""}
                    </p>
                  </div>
                  <p className="text-base font-bold tabular-nums text-emerald-300">
                    {fmtCents(paidTotalCents)}
                  </p>
                </div>

                {pendingMethod === "card" && savedPaymentMethodId ? (
                  <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-center text-xs font-medium text-sky-100">
                    {tipCustomerReadyNote()}
                  </p>
                ) : null}

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Add a tip
                  </p>
                  <div className="mt-1.5 grid grid-cols-4 gap-2">
                    {(
                      [
                        { id: "none" as const, label: "No tip" },
                        { id: "15" as const, label: "15%" },
                        { id: "18" as const, label: "18%" },
                        { id: "20" as const, label: "20%" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTipChoice(opt.id)}
                        className={cn(
                          "rounded-xl border py-2 text-xs font-semibold transition-colors",
                          tipChoice === opt.id
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                            : "border-zinc-700 bg-zinc-900 text-muted-foreground"
                        )}
                      >
                        {opt.label}
                        {opt.id !== "none" && paidTotalCents > 0 ? (
                          <span className="mt-0.5 block text-[10px] font-normal tabular-nums opacity-80">
                            {fmtCents(
                              tipCentsFromChoice(opt.id, paidTotalCents, customTipDollars)
                            )}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTipChoice("custom")}
                    className={cn(
                      "mt-1.5 w-full rounded-xl border py-2 text-xs font-semibold transition-colors",
                      tipChoice === "custom"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900 text-muted-foreground"
                    )}
                  >
                    Custom tip
                  </button>
                  {tipChoice === "custom" ? (
                    <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
                      <span className="text-sm font-semibold text-muted-foreground">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={customTipDollars}
                        onChange={(e) => setCustomTipDollars(e.target.value)}
                        className="w-full bg-transparent text-sm font-semibold tabular-nums text-white outline-none"
                      />
                    </div>
                  ) : null}
                  <p className="mt-1.5 text-xs leading-snug text-emerald-200/90">
                    {tipLastTotalNote({
                      totalAmountLabel: fmtCents(chargeTotalCents()),
                      tipCents: selectedTipCents(),
                      tipAmountLabel: fmtCents(selectedTipCents()),
                      baseAmountLabel: fmtCents(paidTotalCents),
                    })}
                  </p>
                </div>

                {tapListening ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-6 text-center">
                    <Nfc className="h-8 w-8 animate-pulse text-emerald-300" aria-hidden />
                    <p className="text-sm font-semibold text-emerald-100">Ready for tap</p>
                    <p className="text-xs text-emerald-200/80">
                      Hold the customer’s card or phone near this device…
                    </p>
                    <Loader2 className="mt-1 h-4 w-4 animate-spin text-emerald-300" aria-hidden />
                    <button
                      type="button"
                      onClick={() => {
                        setTapListening(false)
                        setAdhocBusy(false)
                        toast({
                          title: "Tap cancelled",
                          description: "Go back and choose Card or a pay link.",
                        })
                      }}
                      className="mt-2 rounded-lg border border-zinc-600 px-3 py-2 text-xs font-semibold text-slate-200"
                    >
                      Cancel tap
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      adhocBusy ||
                      !pendingMethod ||
                      (pendingMethod === "card" && !savedPaymentMethodId)
                    }
                    onClick={() => confirmTipAndCharge()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {adhocBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : pendingMethod === "tap" ? (
                      <Nfc className="h-4 w-4" aria-hidden />
                    ) : (
                      <CreditCard className="h-4 w-4" aria-hidden />
                    )}
                    {tipCustomerConfirmCta(fmtCents(chargeTotalCents()))}
                  </button>
                )}
              </div>
            ) : mode === "sign" ? (
              <div className="flex flex-col gap-3">
                <CustomerSignaturePad
                  onChange={setSignaturePng}
                  canvasClassName="h-36 w-full sm:h-40"
                  optional
                />
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-center text-xs font-medium text-sky-100">
                  {tipSignHandBackCue({
                    offerSignature: true,
                    hasSignature: Boolean(signaturePng),
                  })}
                </p>
                <button
                  type="button"
                  disabled={slipBusy}
                  onClick={() => void continueFromSign()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {slipBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {postPaySignPrimaryCta(Boolean(signaturePng))}
                </button>
              </div>
            ) : mode === "receipt" ? (
              <PaymentReceiptPanel
                baseCents={paidTotalCents}
                tip={tipResult}
                receiptName={receiptName}
                onReceiptNameChange={setReceiptName}
                receiptChannel={receiptChannel}
                onReceiptChannelChange={setReceiptChannel}
                receiptEmail={receiptEmail}
                onReceiptEmailChange={setReceiptEmail}
                receiptPhone={receiptPhone}
                onReceiptPhoneChange={setReceiptPhone}
                receiptBusy={receiptBusy}
                onSend={() => void sendReceipt()}
                onSkip={finishAndClose}
                skipLabel="Skip — done"
              />
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={resetAdhoc}
                  className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>

                {/* Amount + how to pay — tip is a separate last step */}
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3">
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Amount
                      </span>
                      <div className="relative mt-1">
                        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
                          $
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.50"
                          step="0.01"
                          placeholder="0.00"
                          value={adhocAmount}
                          onChange={(e) => setAdhocAmount(e.target.value)}
                          aria-label="Amount before tax"
                          className={cn(
                            "w-full rounded-lg border bg-zinc-950 py-2 pr-3 pl-6 text-right text-xl font-bold tabular-nums text-white outline-none focus:border-emerald-500",
                            adhocBreakdown.totalCents < 50
                              ? "border-amber-500/60"
                              : "border-zinc-700"
                          )}
                        />
                      </div>
                    </label>
                    <div className="shrink-0 pb-0.5 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Total
                      </p>
                      <p className="text-lg font-bold tabular-nums text-emerald-300">
                        {fmtCents(adhocBreakdown.totalCents)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={taxEnabled}
                      onClick={() => setTaxEnabled((v) => !v)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span
                        className={cn(
                          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                          taxEnabled ? "bg-emerald-500" : "bg-zinc-700"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                            taxEnabled && "translate-x-4"
                          )}
                        />
                      </span>
                      <span className="text-xs font-medium text-zinc-300">
                        Tax
                        {taxEnabled ? ` ${adhocBreakdown.ratePercent.toFixed(0)}%` : ""}
                      </span>
                    </button>
                    {taxEnabled ? (
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="30"
                        step="0.01"
                        value={taxRatePercent}
                        onChange={(e) => setTaxRatePercent(e.target.value)}
                        aria-label="Tax rate percent"
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-xs tabular-nums text-white outline-none"
                      />
                    ) : null}
                  </div>

                  <details className="group mt-2 border-t border-zinc-800/80 pt-2">
                    <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">
                        Note{adhocNote.trim() ? " · set" : ""} · edit
                      </span>
                      <span className="hidden group-open:inline">Hide note</span>
                    </summary>
                    <input
                      type="text"
                      value={adhocNote}
                      onChange={(e) => setAdhocNote(e.target.value)}
                      placeholder="e.g. Lockout"
                      className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white outline-none placeholder:text-muted-foreground focus:border-emerald-500"
                    />
                  </details>
                </section>

                <section>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    How to pay
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={adhocBusy}
                      onClick={() => enterMethodStep("tap")}
                      className="flex flex-col items-start gap-1 rounded-xl border border-zinc-700 bg-zinc-800/40 px-3 py-3 text-left hover:border-zinc-600 disabled:opacity-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                        <Nfc className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold text-white">Tap to Pay</span>
                      <span className="text-[10px] text-muted-foreground">NFC</span>
                    </button>
                    <button
                      type="button"
                      disabled={adhocBusy}
                      onClick={() => enterMethodStep("card")}
                      className="flex flex-col items-start gap-1 rounded-xl border border-zinc-700 bg-zinc-800/40 px-3 py-3 text-left hover:border-zinc-600 disabled:opacity-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                        <CreditCard className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold text-white">Card</span>
                      <span className="text-[10px] text-muted-foreground">Key in · ZIP</span>
                    </button>
                    <button
                      type="button"
                      disabled={adhocBusy}
                      onClick={() => enterMethodStep("link")}
                      className="col-span-2 flex flex-col items-start gap-1 rounded-xl border border-zinc-700 bg-zinc-800/40 px-3 py-3 text-left hover:border-zinc-600 disabled:opacity-50"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                        <Link2 className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold text-white">Pay link</span>
                      <span className="text-[10px] text-muted-foreground">Text SMS</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                    Card / Tap: tip last. Pay link: send only — no tip here.
                  </p>
                </section>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {payJob ? (
        <TechPaymentModal
          job={payJob}
          showBack
          offerFinishJob
          onClose={() => setPayJob(null)}
          onCompleted={() => {
            setPayJob(null)
            onOpenChange(false)
            onCollected?.()
            toast({
              title: "Collect finished",
              description: "Payment recorded. Job status updated if you completed it.",
            })
          }}
        />
      ) : null}
    </>
  )
}
