"use client"

// On-the-go Collect Payment — job pick OR walk-up charge, then optional invoice send.

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripeTerminal, type Terminal } from "@stripe/terminal-js"
import {
  CreditCard,
  Loader2,
  MapPin,
  Plus,
  ArrowLeft,
  Nfc,
  Mail,
  Phone,
  Link2,
  MessageSquare,
  X,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { CustomerSignaturePad } from "@/components/payments/customer-signature-pad"
import {
  formatPaymentCatchError,
  formatStripeCardFailure,
  isStripeLivePublishableKey,
  isStripeTestPublishableKey,
  tapToPayNoReaderMessage,
} from "@/lib/stripe-payment-errors"
import { useToast } from "@/hooks/use-toast"
import { openGetPaidModal } from "@/lib/settings-modals-events"

type CollectMode = "list" | "adhoc" | "tip_sign" | "tip_charge" | "receipt"
type TipChoice = "none" | "15" | "18" | "20" | "custom"

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
  stripeConnectAccountId,
}: {
  onDone: (paymentIntentId: string) => void
  onCancel: () => void
  stripeConnectAccountId?: string | null
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    try {
      const { error: submitError } = await elements.submit()
      if (submitError) {
        throw new Error(
          formatStripeCardFailure(submitError, "Check the card details and try again.")
        )
      }
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      })
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
        const confirmRes = await fetch("/api/payments/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentIntentId: pi.id,
            stripeConnectAccountId: stripeConnectAccountId || undefined,
          }),
        })
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
      setError(formatPaymentCatchError(e, "Card payment failed — try another card."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 px-1 pb-2">
      <PaymentElement
        options={{
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
          <p className="text-xs font-semibold text-rose-300">Payment didn’t go through</p>
          <p className="mt-0.5 text-xs leading-snug text-rose-200/90">{error}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-slate-300"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy || !stripe}
          onClick={() => void pay()}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Charge card"}
        </button>
      </div>
    </div>
  )
}

export function OwnerCollectPaymentSheet({
  open,
  onOpenChange,
  onCollected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCollected?: () => void
}) {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(false)
  const [payJob, setPayJob] = useState<DispatchJob | null>(null)
  /** Latest pay-link status keyed by job id (from /api/payments/pay-links). */
  const [linkByJobId, setLinkByJobId] = useState<Record<string, JobPayLinkBadge>>({})
  /** Stripe Connect: shop must finish Get paid before card charges. */
  const [connectReady, setConnectReady] = useState<boolean | null>(null)
  const [connectMessage, setConnectMessage] = useState<string | null>(null)
  // list → jobs; adhoc → charge; tip_sign → tip+signature; tip_charge → tip card; receipt → invoice
  const [mode, setMode] = useState<CollectMode>("list")
  const [adhocAmount, setAdhocAmount] = useState("")
  const [adhocNote, setAdhocNote] = useState("")
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  const [adhocBusy, setAdhocBusy] = useState(false)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [stripeConnectAccountId, setStripeConnectAccountId] = useState<string | null>(null)
  // Set after a successful walk-up charge so we can tip / sign / email-SMS.
  const [paidPaymentIntentId, setPaidPaymentIntentId] = useState<string | null>(null)
  const [paidTotalCents, setPaidTotalCents] = useState(0)
  const [tipChoice, setTipChoice] = useState<TipChoice>("none")
  const [customTipDollars, setCustomTipDollars] = useState("")
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [slipBusy, setSlipBusy] = useState(false)
  const [tipChargeCents, setTipChargeCents] = useState(0)
  const [receiptName, setReceiptName] = useState("")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState("")
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("email")
  const [receiptBusy, setReceiptBusy] = useState(false)
  // Pre-pay: text/email a Stripe Checkout link (walk-up).
  const [payLinkOpen, setPayLinkOpen] = useState(false)
  const [payLinkName, setPayLinkName] = useState("")
  const [payLinkEmail, setPayLinkEmail] = useState("")
  const [payLinkPhone, setPayLinkPhone] = useState("")
  const [payLinkUrl, setPayLinkUrl] = useState<string | null>(null)

  const resetAdhoc = useCallback(() => {
    setMode("list")
    setAdhocAmount("")
    setAdhocNote("")
    setTaxEnabled(false)
    setTaxRatePercent("6")
    setClientSecret(null)
    setPublishableKey(null)
    setAdhocBusy(false)
    setTapListening(false)
    setPaidPaymentIntentId(null)
    setPaidTotalCents(0)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setSlipBusy(false)
    setTipChargeCents(0)
    setReceiptName("")
    setReceiptEmail("")
    setReceiptPhone("")
    setReceiptChannel("email")
    setPayLinkOpen(false)
    setPayLinkName("")
    setPayLinkEmail("")
    setPayLinkPhone("")
    setPayLinkUrl(null)
    setReceiptBusy(false)
  }, [])

  /** After base charge succeeds: tip options + signature, then invoice. */
  function enterTipSignStep(paymentIntentId: string, totalCents: number) {
    setClientSecret(null)
    setPublishableKey(null)
    setTapListening(false)
    setAdhocBusy(false)
    setPaidPaymentIntentId(paymentIntentId)
    setPaidTotalCents(totalCents)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setTipChargeCents(0)
    setMode("tip_sign")
    onCollected?.()
    toast({
      title: "Payment collected",
      description: "Add a tip (optional) and get a signature.",
    })
  }

  function enterReceiptStep() {
    setClientSecret(null)
    setPublishableKey(null)
    setMode("receipt")
  }

  function selectedTipCents(): number {
    if (tipChoice === "none") return 0
    if (tipChoice === "custom") {
      const dollars = parseFloat(customTipDollars)
      if (!Number.isFinite(dollars) || dollars <= 0) return 0
      return Math.round(dollars * 100)
    }
    const pct = Number(tipChoice)
    if (!Number.isFinite(pct) || paidTotalCents <= 0) return 0
    return Math.round(paidTotalCents * (pct / 100))
  }

  async function saveSlip(opts?: { tipPaymentIntentId?: string | null; tipCents?: number }) {
    if (!paidPaymentIntentId) throw new Error("Missing payment id")
    const tipCents = opts?.tipCents ?? selectedTipCents()
    const res = await fetch("/api/payments/complete-slip", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentIntentId: paidPaymentIntentId,
        tipCents,
        signaturePng,
        tipPaymentIntentId: opts?.tipPaymentIntentId ?? undefined,
      }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not save tip / signature")
  }

  /** Save tip+signature; charge tip on card if ≥ $0.50, else go to invoice. */
  async function continueFromTipSign(opts?: {
    skipTipCharge?: boolean
    allowNoSignature?: boolean
  }) {
    const tipCents = selectedTipCents()
    if (!signaturePng && !opts?.allowNoSignature) {
      toast({
        title: "Signature needed",
        description: "Have the customer sign below, or tap Continue without signature.",
        variant: "destructive",
      })
      return
    }
    setSlipBusy(true)
    try {
      await saveSlip({ tipCents })
      if (tipCents >= 50 && !opts?.skipTipCharge) {
        setTipChargeCents(tipCents)
        setMode("tip_charge")
        toast({
          title: "Charge the tip",
          description: `${fmtCents(tipCents)} — Tap to Pay or card.`,
        })
        return
      }
      enterReceiptStep()
    } catch (e) {
      toast({
        title: "Could not save slip",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSlipBusy(false)
    }
  }

  function finishAndClose() {
    resetAdhoc()
    onOpenChange(false)
  }

  const loadJobs = useCallback(() => {
    setLoading(true)
    fetch("/api/owner/jobs?scope=map", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { jobs?: DispatchJob[] } }) => {
        const list = Array.isArray(j.data?.jobs) ? j.data!.jobs! : []
        const openJobs = list.filter((job) => {
          const s = (job.job_status ?? "").toLowerCase()
          return s !== "completed" && s !== "cancelled" && s !== "canceled"
        })
        setJobs(openJobs.length ? openJobs : list.slice(0, 12))
      })
      .catch(() => {
        setJobs([])
        toast({
          title: "Could not load jobs",
          description: "Try again in a moment.",
          variant: "destructive",
        })
      })
      .finally(() => setLoading(false))

    fetch("/api/payments/connect/status", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { ready?: boolean; message?: string | null } } | null) => {
        setConnectReady(j?.data?.ready === true)
        setConnectMessage(j?.data?.message ?? null)
      })
      .catch(() => {
        setConnectReady(null)
      })

    // Load recent pay links so job rows show “Link sent / Paid” instead of only “new payment”.
    fetch("/api/payments/pay-links?sync=1", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { links?: JobPayLinkBadge[] } } | null) => {
        const links = Array.isArray(j?.data?.links) ? j!.data!.links! : []
        const map: Record<string, JobPayLinkBadge> = {}
        for (const link of links) {
          const jid = (link.jobId || "").trim()
          if (!jid) continue
          // Newest first from API — keep first (most recent) per job.
          if (!map[jid]) map[jid] = link
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
      })
      .catch(() => {
        /* ignore — job list still works */
      })
  }, [toast, onCollected])

  useEffect(() => {
    if (open) {
      loadJobs()
      resetAdhoc()
    }
  }, [open, loadJobs, resetAdhoc])

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

  /** Shared body for walk-up create-intent (card or tap) — contact collected after pay. */
  function adhocIntentBody(paymentMethodType: "MANUAL_CARD" | "TAP_TO_PAY") {
    const dollars = parseAdhocDollars()
    if (dollars == null) return null
    return {
      adhoc: true as const,
      amount: dollars,
      paymentMethodType,
      note: adhocNote.trim() || "Walk-up payment",
      taxEnabled,
      taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
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
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
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

    const totalAtCharge = adhocBreakdown.totalCents
    setAdhocBusy(true)
    setTapListening(true)
    let terminal: Terminal | null = null
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          paymentIntentId?: string
          publishableKey?: string | null
          stripeConnectAccountId?: string | null
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

      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const tokenRes = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
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

      let discover = await terminal.discoverReaders({ simulated: false })
      const noRealReader =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length

      // Never fall back to the simulator on live keys (that caused the error you saw).
      if (noRealReader && allowSimulator && !liveMode) {
        discover = await terminal.discoverReaders({ simulated: true })
      }

      if ("error" in discover) {
        throw new Error(formatPaymentCatchError(discover.error, "Could not find a tap reader."))
      }
      const reader = discover.discoveredReaders?.[0]
      if (!reader) {
        throw new Error(tapToPayNoReaderMessage(liveMode || !allowSimulator))
      }

      const connected = await terminal.connectReader(reader)
      if ("error" in connected) {
        throw new Error(formatPaymentCatchError(connected.error, "Could not connect to the reader."))
      }

      const collected = await terminal.collectPaymentMethod(secret)
      if ("error" in collected) {
        throw new Error(
          formatPaymentCatchError(collected.error, "Customer didn’t complete the tap. Try again.")
        )
      }

      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) {
        throw new Error(
          formatPaymentCatchError(processed.error, "Tap charge failed — try Card entry.")
        )
      }

      const piId = String(processed.paymentIntent?.id || json.data?.paymentIntentId || "")
      if (!piId) throw new Error("Payment succeeded but no payment id was returned")

      await fetch("/api/payments/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId: piId,
          stripeConnectAccountId: stripeConnectAccountId || undefined,
        }),
      }).catch(() => null)

      enterTipSignStep(piId, totalAtCharge)
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

  /** Text or email a Stripe Checkout link for this walk-up amount. */
  async function sendAdhocPayLink(channel: "sms" | "email") {
    const dollars = parseAdhocDollars()
    if (dollars == null) {
      toast({
        title: "Enter an amount",
        description: "Minimum is $0.50.",
        variant: "destructive",
      })
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
          channel,
          adhoc: true,
          amount: dollars,
          taxEnabled,
          taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
          note: adhocNote.trim() || "Walk-up payment",
          customerName: payLinkName.trim() || undefined,
          phone: channel === "sms" ? payLinkPhone.trim() : undefined,
          email: channel === "email" ? payLinkEmail.trim() : undefined,
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
            (channel === "sms"
              ? "Pay link created, but the text could not be delivered. Copy the link below."
              : "Pay link created, but email could not be sent. Copy the link below.")
        )
      }
      toast({
        title: channel === "sms" ? "Pay link texted" : "Pay link emailed",
        description: json.data?.chargeCents
          ? `Customer can pay ${fmtCents(json.data.chargeCents)}.`
          : "Link sent.",
      })
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

  /** Create a tip PaymentIntent (separate charge after the main payment). */
  function tipIntentBody(paymentMethodType: "MANUAL_CARD" | "TAP_TO_PAY") {
    if (tipChargeCents < 50) return null
    return {
      adhoc: true as const,
      amount: tipChargeCents / 100,
      paymentMethodType,
      note: "Tip",
      taxEnabled: false,
      taxRatePercent: 0,
    }
  }

  async function startTipCardIntent() {
    const body = tipIntentBody("MANUAL_CARD")
    if (!body) return
    setAdhocBusy(true)
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          publishableKey?: string | null
          stripeConnectAccountId?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not start tip charge")
      if (!json.data?.clientSecret) throw new Error("No client_secret returned")
      setClientSecret(json.data.clientSecret)
      setPublishableKey(json.data.publishableKey ?? null)
      setStripeConnectAccountId(json.data.stripeConnectAccountId?.trim() || null)
    } catch (e) {
      toast({
        title: "Could not start tip charge",
        description: formatPaymentCatchError(e, "Try again."),
        variant: "destructive",
      })
    } finally {
      setAdhocBusy(false)
    }
  }

  async function runTipTapToPay() {
    const body = tipIntentBody("TAP_TO_PAY")
    if (!body) return
    setAdhocBusy(true)
    setTapListening(true)
    let terminal: Terminal | null = null
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          clientSecret?: string
          paymentIntentId?: string
          publishableKey?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error || "Could not start tip Tap to Pay")
      const secret = json.data?.clientSecret
      if (!secret) throw new Error("No client_secret returned")

      const pk = json.data?.publishableKey ?? publishableKey
      const liveMode = isStripeLivePublishableKey(pk)
      const allowSimulator = isStripeTestPublishableKey(pk)

      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const tokenRes = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
          const tokenJson = (await tokenRes.json()) as {
            data?: { secret?: string }
            error?: string
          }
          if (!tokenRes.ok || !tokenJson.data?.secret) {
            throw new Error(tokenJson.error || "Could not fetch Terminal connection token")
          }
          return tokenJson.data.secret
        },
        onUnexpectedReaderDisconnect: () => setTapListening(false),
      })

      let discover = await terminal.discoverReaders({ simulated: false })
      const noReal =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length
      if (noReal && allowSimulator && !liveMode) {
        discover = await terminal.discoverReaders({ simulated: true })
      }
      if ("error" in discover) {
        throw new Error(formatPaymentCatchError(discover.error, "No tip reader found."))
      }
      const reader = discover.discoveredReaders?.[0]
      if (!reader) throw new Error(tapToPayNoReaderMessage(liveMode || !allowSimulator))

      const connected = await terminal.connectReader(reader)
      if ("error" in connected) {
        throw new Error(formatPaymentCatchError(connected.error, "Reader connect failed."))
      }
      const collected = await terminal.collectPaymentMethod(secret)
      if ("error" in collected) {
        throw new Error(formatPaymentCatchError(collected.error, "Tip tap failed."))
      }
      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) {
        throw new Error(formatPaymentCatchError(processed.error, "Tip charge failed."))
      }

      const tipPi = String(processed.paymentIntent?.id || json.data?.paymentIntentId || "")
      if (tipPi) {
        await fetch("/api/payments/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentIntentId: tipPi,
            stripeConnectAccountId: stripeConnectAccountId || undefined,
          }),
        }).catch(() => null)
        await saveSlip({ tipPaymentIntentId: tipPi, tipCents: tipChargeCents })
      }
      setClientSecret(null)
      setPublishableKey(null)
      enterReceiptStep()
      toast({ title: "Tip collected", description: fmtCents(tipChargeCents) })
    } catch (e) {
      toast({
        title: "Tip Tap to Pay failed",
        description: formatPaymentCatchError(e, "Try card, or skip tip charge."),
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
        description: "Customer should get it shortly.",
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
          className="flex h-auto max-h-[92dvh] flex-col gap-0 rounded-t-2xl rounded-b-none border-zinc-800 bg-[#101018] p-0 sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-bold text-slate-100">
                  {mode === "receipt"
                    ? "Send receipt"
                    : mode === "tip_sign"
                      ? "Tip & signature"
                      : mode === "tip_charge"
                        ? "Charge tip"
                        : mode === "adhoc"
                          ? "Charge"
                          : "Collect"}
                </SheetTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  {mode === "receipt"
                    ? "Email or text the customer a receipt."
                    : mode === "tip_sign"
                      ? "Optional tip, then customer signs."
                      : mode === "tip_charge"
                        ? "Collect the tip on Tap to Pay or card."
                        : mode === "adhoc"
                          ? "Walk-up"
                          : "Charge a walk-up or a job on today’s schedule."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetAdhoc()
                  onOpenChange(false)
                }}
                className="rounded-lg p-2 text-zinc-400 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {mode === "list" ? (
              <>
                {connectReady === false ? (
                  <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3">
                    <p className="text-sm font-semibold text-amber-50">Finish Get paid to accept cards</p>
                    <p className="mt-1 text-xs leading-snug text-amber-100/80">
                      {connectMessage ||
                        "Set up your bank in Lyncr so customers pay your business and funds go to your account."}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenChange(false)
                        // Let Collect close, then open Get paid above anything else.
                        window.setTimeout(() => openGetPaidModal(), 50)
                      }}
                      className="mt-2.5 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Open Get paid
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (connectReady === false) {
                      toast({
                        title: "Get paid required",
                        description: "Finish payout setup before collecting card payments.",
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
                    <span className="block text-sm font-semibold text-emerald-100">Walk-up charge</span>
                    <span className="block text-xs text-emerald-200/70">
                      No job on the schedule — Tap to Pay or card
                    </span>
                  </span>
                </button>

                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Today’s jobs
                </p>

                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading jobs…
                  </div>
                ) : sorted.length === 0 ? (
                  <p className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-sm text-slate-500">
                    No open jobs right now. Use Walk-up charge above.
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
                                  title: "Get paid required",
                                  description: "Finish payout setup before collecting card payments.",
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
                                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
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
            ) : mode === "tip_sign" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
                  <p className="text-sm font-semibold text-emerald-100">Payment received</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                    {fmtCents(paidTotalCents)}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Add a tip
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
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
                          "rounded-xl border py-2.5 text-xs font-semibold transition-colors",
                          tipChoice === opt.id
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                            : "border-zinc-700 bg-zinc-900 text-slate-400"
                        )}
                      >
                        {opt.label}
                        {opt.id !== "none" && paidTotalCents > 0 ? (
                          <span className="mt-0.5 block text-[10px] font-normal tabular-nums opacity-80">
                            {fmtCents(Math.round(paidTotalCents * (Number(opt.id) / 100)))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTipChoice("custom")}
                    className={cn(
                      "mt-2 w-full rounded-xl border py-2.5 text-xs font-semibold transition-colors",
                      tipChoice === "custom"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900 text-slate-400"
                    )}
                  >
                    Custom tip
                  </button>
                  {tipChoice === "custom" ? (
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5">
                      <span className="text-sm font-semibold text-slate-400">$</span>
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
                  {selectedTipCents() > 0 ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Tip {fmtCents(selectedTipCents())}
                      {" · "}
                      New total{" "}
                      <span className="font-semibold text-emerald-300">
                        {fmtCents(paidTotalCents + selectedTipCents())}
                      </span>
                    </p>
                  ) : null}
                </div>

                <CustomerSignaturePad onChange={setSignaturePng} />

                <button
                  type="button"
                  disabled={slipBusy}
                  onClick={() => void continueFromTipSign()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {slipBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {selectedTipCents() >= 50
                    ? `Continue · charge tip ${fmtCents(selectedTipCents())}`
                    : "Continue"}
                </button>
                <button
                  type="button"
                  disabled={slipBusy}
                  onClick={() =>
                    void continueFromTipSign({
                      allowNoSignature: !signaturePng,
                      // Secondary always skips a second tip swipe (record tip only / go to invoice).
                      skipTipCharge: true,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  {!signaturePng
                    ? "Skip signature — send invoice"
                    : selectedTipCents() >= 50
                      ? "Skip tip card charge (record tip only)"
                      : "Skip — send invoice"}
                </button>
              </div>
            ) : mode === "tip_charge" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
                  <p className="text-sm font-semibold text-emerald-100">Tip amount</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                    {fmtCents(tipChargeCents)}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-200/70">
                    Second charge — Tap to Pay or card.
                  </p>
                </div>

                {!clientSecret ? (
                  tapListening ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-6 text-center">
                      <Nfc className="h-8 w-8 animate-pulse text-emerald-300" aria-hidden />
                      <p className="text-sm font-semibold text-emerald-100">Ready for tip tap</p>
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-300" aria-hidden />
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <button
                        type="button"
                        disabled={adhocBusy}
                        onClick={() => void runTipTapToPay()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {adhocBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Nfc className="h-4 w-4" aria-hidden />
                        )}
                        Tap to Pay tip
                      </button>
                      <button
                        type="button"
                        disabled={adhocBusy}
                        onClick={() => void startTipCardIntent()}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
                      >
                        <CreditCard className="h-4 w-4" aria-hidden />
                        Card for tip
                      </button>
                      <button
                        type="button"
                        disabled={adhocBusy}
                        onClick={() => {
                          setClientSecret(null)
                          enterReceiptStep()
                        }}
                        className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-300"
                      >
                        Skip tip charge
                      </button>
                    </div>
                  )
                ) : publishableKey ? (
                  <Elements
                    stripe={getStripePromise(publishableKey, stripeConnectAccountId)}
                    options={{
                      clientSecret,
                      appearance: { theme: "night", variables: { colorPrimary: "#10b981" } },
                    }}
                  >
                    <AdhocCardForm
                      stripeConnectAccountId={stripeConnectAccountId}
                      onCancel={() => {
                        setClientSecret(null)
                        setPublishableKey(null)
                      }}
                      onDone={(tipPiId) => {
                        void (async () => {
                          await saveSlip({
                            tipPaymentIntentId: tipPiId,
                            tipCents: tipChargeCents,
                          }).catch(() => null)
                          setClientSecret(null)
                          setPublishableKey(null)
                          enterReceiptStep()
                          toast({ title: "Tip collected", description: fmtCents(tipChargeCents) })
                        })()
                      }}
                    />
                  </Elements>
                ) : (
                  <p className="text-sm text-rose-400">Missing Stripe publishable key.</p>
                )}
              </div>
            ) : mode === "receipt" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
                  <p className="text-sm font-semibold text-emerald-100">Payment received</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                    {fmtCents(paidTotalCents + Math.max(0, tipChargeCents || selectedTipCents()))}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-200/70">
                    Optional — send a receipt by email or text.
                  </p>
                </div>

                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Customer name (optional)
                  </span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={receiptName}
                    onChange={(e) => setReceiptName(e.target.value)}
                    placeholder="Who should it say it’s for?"
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReceiptChannel("email")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                      receiptChannel === "email"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900 text-slate-400"
                    )}
                  >
                    <Mail className="h-4 w-4" aria-hidden />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptChannel("sms")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                      receiptChannel === "sms"
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900 text-slate-400"
                    )}
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    Text / SMS
                  </button>
                </div>

                {receiptChannel === "email" ? (
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={receiptEmail}
                      onChange={(e) => setReceiptEmail(e.target.value)}
                      placeholder="customer@email.com"
                      className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Phone
                    </span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      value={receiptPhone}
                      onChange={(e) => setReceiptPhone(e.target.value)}
                      placeholder="(502) 555-0100"
                      className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600"
                    />
                  </label>
                )}

                <button
                  type="button"
                  disabled={receiptBusy}
                  onClick={() => void sendReceipt()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {receiptBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : receiptChannel === "email" ? (
                    <Mail className="h-4 w-4" aria-hidden />
                  ) : (
                    <Phone className="h-4 w-4" aria-hidden />
                  )}
                  {receiptChannel === "email" ? "Send invoice email" : "Send invoice text"}
                </button>
                <button
                  type="button"
                  disabled={receiptBusy}
                  onClick={finishAndClose}
                  className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Skip — done
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={resetAdhoc}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>

                {!clientSecret ? (
                  <>
                    {/* Same compact amount card as job Charge */}
                    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
                      <div className="flex items-end gap-2">
                        <label className="min-w-0 flex-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            Amount
                          </span>
                          <div className="relative mt-1">
                            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-zinc-500">
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
                                "w-full rounded-lg border bg-zinc-950 py-2 pr-2.5 pl-6 text-right text-xl font-bold tabular-nums text-white outline-none focus:border-emerald-500",
                                adhocBreakdown.totalCents < 50
                                  ? "border-amber-500/60"
                                  : "border-zinc-700"
                              )}
                            />
                          </div>
                        </label>
                        <div className="shrink-0 pb-0.5 text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
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
                            {taxEnabled
                              ? ` ${adhocBreakdown.ratePercent.toFixed(0)}%`
                              : ""}
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
                        <summary className="cursor-pointer list-none text-[11px] font-medium text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">
                            Note{adhocNote.trim() ? " · set" : ""} · edit
                          </span>
                          <span className="hidden group-open:inline">Hide note</span>
                        </summary>
                        <input
                          type="text"
                          value={adhocNote}
                          onChange={(e) => setAdhocNote(e.target.value)}
                          placeholder="e.g. Lockout — walk-up"
                          className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500"
                        />
                      </details>
                    </section>

                    {tapListening ? (
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-6 text-center">
                        <Nfc className="h-8 w-8 animate-pulse text-emerald-300" aria-hidden />
                        <p className="text-sm font-semibold text-emerald-100">Ready for tap</p>
                        <p className="text-xs text-emerald-200/80">
                          Hold the customer’s card or phone near this device…
                        </p>
                        <Loader2 className="mt-1 h-4 w-4 animate-spin text-emerald-300" aria-hidden />
                      </div>
                    ) : (
                      <section>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                          How to collect
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={adhocBusy}
                            onClick={() => void runAdhocTapToPay()}
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50",
                              "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600",
                              adhocBreakdown.totalCents < 50 && "opacity-70"
                            )}
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                              {adhocBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <Nfc className="h-4 w-4" aria-hidden />
                              )}
                            </span>
                            <span className="text-xs font-semibold text-white">Tap to Pay</span>
                            <span className="text-[10px] text-zinc-500">NFC</span>
                          </button>
                          <button
                            type="button"
                            disabled={adhocBusy}
                            onClick={() => void startAdhocIntent()}
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-xl border border-zinc-700 bg-zinc-800/40 px-3 py-2.5 text-left hover:border-zinc-600 disabled:opacity-50",
                              adhocBreakdown.totalCents < 50 && "opacity-70"
                            )}
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                              <CreditCard className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="text-xs font-semibold text-white">Card</span>
                            <span className="text-[10px] text-zinc-500">Key in</span>
                          </button>
                          <button
                            type="button"
                            disabled={adhocBusy}
                            onClick={() => {
                              setPayLinkOpen((v) => !v)
                              setPayLinkUrl(null)
                            }}
                            className={cn(
                              "col-span-2 flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left disabled:opacity-50",
                              payLinkOpen
                                ? "border-emerald-500/50 bg-emerald-500/15"
                                : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600",
                              adhocBreakdown.totalCents < 50 && "opacity-70"
                            )}
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
                              <Link2 className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="text-xs font-semibold text-white">Pay link</span>
                            <span className="text-[10px] text-zinc-500">Text / email</span>
                          </button>
                        </div>

                        {payLinkOpen ? (
                          <div className="mt-2 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
                            <input
                              type="text"
                              value={payLinkName}
                              onChange={(e) => setPayLinkName(e.target.value)}
                              placeholder="Customer name (optional)"
                              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white outline-none"
                            />
                            <input
                              type="tel"
                              value={payLinkPhone}
                              onChange={(e) => setPayLinkPhone(e.target.value)}
                              placeholder="Mobile for text"
                              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white outline-none"
                            />
                            <input
                              type="email"
                              value={payLinkEmail}
                              onChange={(e) => setPayLinkEmail(e.target.value)}
                              placeholder="Email"
                              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white outline-none"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                disabled={adhocBusy || !payLinkPhone.trim()}
                                onClick={() => void sendAdhocPayLink("sms")}
                                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                                Text
                              </button>
                              <button
                                type="button"
                                disabled={adhocBusy || !payLinkEmail.trim()}
                                onClick={() => void sendAdhocPayLink("email")}
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-900 py-2 text-xs font-semibold text-slate-100 disabled:opacity-50"
                              >
                                <Mail className="h-3.5 w-3.5" aria-hidden />
                                Email
                              </button>
                            </div>
                            {payLinkUrl ? (
                              <p className="break-all text-[10px] text-emerald-300/90">{payLinkUrl}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                    )}
                  </>
                ) : publishableKey ? (
                  <Elements
                    stripe={getStripePromise(publishableKey, stripeConnectAccountId)}
                    options={{
                      clientSecret,
                      appearance: { theme: "night", variables: { colorPrimary: "#10b981" } },
                    }}
                  >
                    <AdhocCardForm
                      stripeConnectAccountId={stripeConnectAccountId}
                      onCancel={() => {
                        setClientSecret(null)
                        setPublishableKey(null)
                      }}
                      onDone={(paymentIntentId) => {
                        enterTipSignStep(paymentIntentId, adhocBreakdown.totalCents)
                      }}
                    />
                  </Elements>
                ) : (
                  <p className="text-sm text-rose-400">
                    Missing Stripe publishable key. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
                  </p>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {payJob ? (
        <TechPaymentModal
          job={payJob}
          showBack
          onClose={() => setPayJob(null)}
          onCompleted={() => {
            setPayJob(null)
            onOpenChange(false)
            onCollected?.()
            toast({ title: "Payment collected", description: "Header total updated." })
          }}
        />
      ) : null}
    </>
  )
}
