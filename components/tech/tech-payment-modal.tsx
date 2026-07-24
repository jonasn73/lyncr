// Interactive job payment modal — invoice breakdown + Tap to Pay / Manual Card / Cash.

"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Nfc,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { loadStripe, type Stripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripeTerminal, type Terminal } from "@stripe/terminal-js"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"
import { CustomerSignaturePad } from "@/components/payments/customer-signature-pad"
import {
  formatPaymentCatchError,
  formatStripeCardFailure,
  isStripeLivePublishableKey,
  isStripeTestPublishableKey,
  tapToPayNoReaderMessage,
} from "@/lib/stripe-payment-errors"

type Line = { id: string; label: string; amount: string }
type PayMethod = "tap" | "card" | "cash" | "link"
/** After the main charge: tip + signature → optional tip swipe → receipt. */
type PostPayStep = "tip_sign" | "tip_charge" | "receipt"
type TipChoice = "none" | "15" | "18" | "20" | "custom"

function newLine(label = "", amount = ""): Line {
  return { id: Math.random().toString(36).slice(2), label, amount }
}

function dollarsToCents(v: string): number {
  const n = Math.round(parseFloat(v || "0") * 100)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

/** Start invoice lines from the job quote when present; otherwise one blank service line. */
function initialLines(job: DispatchJob): Line[] {
  const cents = (job as DispatchJob & { quoted_price_cents?: number | null }).quoted_price_cents
  if (typeof cents === "number" && cents >= 50) {
    return [newLine("Quoted service", (cents / 100).toFixed(2))]
  }
  return [newLine("Service", "")]
}

/** Format cents as a plain dollar string for the editable amount field. */
function centsToAmountInput(cents: number): string {
  if (cents <= 0) return ""
  return (cents / 100).toFixed(2)
}

let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey)
  return stripePromise
}

export function TechPaymentModal(props: {
  job: DispatchJob
  onClose: () => void
  onCompleted: () => void
}) {
  const [lines, setLines] = useState<Line[]>(() => initialLines(props.job))
  // Editable pre-tax amount (dollars). Kept in sync with line items unless the user typed a custom total.
  const [amountInput, setAmountInput] = useState(() => {
    const cents = (props.job as DispatchJob & { quoted_price_cents?: number | null })
      .quoted_price_cents
    if (typeof cents === "number" && cents >= 50) return centsToAmountInput(cents)
    return ""
  })
  const [amountEdited, setAmountEdited] = useState(false)
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  // Contact for “Text / email pay link”.
  const [linkName, setLinkName] = useState(() => props.job.customer_name?.trim() || "")
  const [linkPhone, setLinkPhone] = useState(() => props.job.customer_phone?.trim() || "")
  const [linkEmail, setLinkEmail] = useState("")
  const [linkSentUrl, setLinkSentUrl] = useState<string | null>(null)
  /** True only when SMS/email actually delivered (not just Checkout URL created). */
  const [linkDelivered, setLinkDelivered] = useState(false)
  // Tip + signature (same flow as walk-up Collect Payment).
  const [postPayStep, setPostPayStep] = useState<PostPayStep | null>(null)
  const [paidTotalCents, setPaidTotalCents] = useState(0)
  const [paidPaymentIntentId, setPaidPaymentIntentId] = useState<string | null>(null)
  const [tipChoice, setTipChoice] = useState<TipChoice>("none")
  const [customTipDollars, setCustomTipDollars] = useState("")
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [slipBusy, setSlipBusy] = useState(false)
  const [tipChargeCents, setTipChargeCents] = useState(0)
  const [receiptName, setReceiptName] = useState(() => props.job.customer_name?.trim() || "")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState(() => props.job.customer_phone?.trim() || "")
  const [receiptBusy, setReceiptBusy] = useState(false)
  /** Nested popup: card entry or pay-link form (keeps main sheet short). */
  const [activePopup, setActivePopup] = useState<"link" | "card" | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)

  // Close nested Card / Link popup and clear in-progress payment UI state.
  function closePayPopup() {
    setActivePopup(null)
    if (method === "link" || method === "card") setMethod(null)
    setClientSecret(null)
    setPublishableKey(null)
    setPaymentIntentId(null)
    setLinkSentUrl(null)
    setLinkDelivered(false)
    setError(null)
  }
  // Wait for client mount so createPortal can target document.body.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const linesSubtotalCents = useMemo(
    () => lines.reduce((sum, l) => sum + dollarsToCents(l.amount), 0),
    [lines]
  )

  // When line items change and the user has not typed a custom amount, mirror the line sum.
  useEffect(() => {
    if (amountEdited) return
    setAmountInput(centsToAmountInput(linesSubtotalCents))
  }, [linesSubtotalCents, amountEdited])

  const breakdown = useMemo(() => {
    const subtotalCents = dollarsToCents(amountInput)
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
  }, [amountInput, taxEnabled, taxRatePercent])

  const { subtotalCents, taxCents, totalCents } = breakdown

  /** Buttons used to be disabled at $0 with no feedback — looked clickable but did nothing. */
  function requireChargeAmount(): boolean {
    if (totalCents >= 50) return true
    setError("Enter an amount of at least $0.50 in Amount (before tax), then try again.")
    amountInputRef.current?.focus()
    amountInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    return false
  }

  const lineItemsPayload = () => {
    const fromLines = lines
      .map((l) => ({ label: l.label.trim(), amountCents: dollarsToCents(l.amount) }))
      .filter((l) => l.label && l.amountCents > 0)
    if (subtotalCents <= 0) return []
    // Editable amount wins when it differs from the line sum (cash + Stripe both charge this).
    if (
      fromLines.length === 0 ||
      (amountEdited && Math.abs(subtotalCents - linesSubtotalCents) > 0)
    ) {
      const label =
        fromLines.map((l) => l.label).filter(Boolean).join(" + ").slice(0, 120) || "Service"
      return [{ label, amountCents: subtotalCents }]
    }
    return fromLines
  }

  async function createIntent(paymentMethodType: "TAP_TO_PAY" | "MANUAL_CARD") {
    const lineItems = lineItemsPayload()
    if (totalCents < 50) throw new Error("Enter an amount of at least $0.50.")
    if (lineItems.length === 0) throw new Error("Add at least one line item with an amount.")
    const res = await fetch("/api/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        jobId: props.job.id,
        // Final charge including sales tax (invoiceOverride allows any amount).
        amount: totalCents / 100,
        paymentMethodType,
        invoiceOverride: true,
        lineItems,
        taxEnabled,
        taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
      }),
    })
    const json = (await res.json()) as {
      error?: string
      data?: {
        clientSecret?: string
        client_secret?: string
        paymentIntentId?: string
        publishableKey?: string | null
      }
    }
    if (!res.ok) throw new Error(json.error || "Could not start payment")
    const secret = json.data?.clientSecret || json.data?.client_secret
    if (!secret) throw new Error("No client_secret returned")
    setClientSecret(secret)
    setPaymentIntentId(json.data?.paymentIntentId ?? null)
    setPublishableKey(json.data?.publishableKey?.trim() || null)
    return {
      clientSecret: secret,
      paymentIntentId: json.data?.paymentIntentId ?? null,
      publishableKey: json.data?.publishableKey?.trim() || null,
    }
  }

  async function confirmServer(piId: string) {
    const res = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ paymentIntentId: piId }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not confirm payment")
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

  /** Move to tip + signature after the main charge succeeds. */
  function enterTipSignStep(piId: string | null, chargedCents: number) {
    setPaidPaymentIntentId(piId)
    setPaidTotalCents(chargedCents)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setTipChargeCents(0)
    setClientSecret(null)
    setPublishableKey(null)
    setMethod(null)
    setActivePopup(null)
    setPostPayStep("tip_sign")
    setError(null)
  }

  async function saveSlip(opts?: { tipPaymentIntentId?: string | null; tipCents?: number }) {
    if (!paidPaymentIntentId) return
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

  async function continueFromTipSign(opts?: {
    skipTipCharge?: boolean
    allowNoSignature?: boolean
  }) {
    const tipCents = selectedTipCents()
    if (!signaturePng && !opts?.allowNoSignature) {
      setError("Have the customer sign below, or skip signature.")
      return
    }
    setSlipBusy(true)
    setError(null)
    try {
      if (paidPaymentIntentId) {
        await saveSlip({ tipCents })
      }
      if (tipCents >= 50 && !opts?.skipTipCharge) {
        setTipChargeCents(tipCents)
        setPostPayStep("tip_charge")
        return
      }
      setPostPayStep("receipt")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save tip / signature")
    } finally {
      setSlipBusy(false)
    }
  }

  /** Charge tip as a separate job line (works for owner + tech). */
  async function createTipIntent(paymentMethodType: "TAP_TO_PAY" | "MANUAL_CARD") {
    if (tipChargeCents < 50) throw new Error("Tip must be at least $0.50")
    const res = await fetch("/api/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        jobId: props.job.id,
        amount: tipChargeCents / 100,
        paymentMethodType,
        invoiceOverride: true,
        lineItems: [{ label: "Tip", amountCents: tipChargeCents }],
      }),
    })
    const json = (await res.json()) as {
      error?: string
      data?: {
        clientSecret?: string
        client_secret?: string
        paymentIntentId?: string
        publishableKey?: string | null
      }
    }
    if (!res.ok) throw new Error(json.error || "Could not start tip charge")
    const secret = json.data?.clientSecret || json.data?.client_secret
    if (!secret) throw new Error("No client_secret returned")
    setClientSecret(secret)
    setPaymentIntentId(json.data?.paymentIntentId ?? null)
    setPublishableKey(json.data?.publishableKey?.trim() || null)
    return {
      clientSecret: secret,
      paymentIntentId: json.data?.paymentIntentId ?? null,
      publishableKey: json.data?.publishableKey?.trim() || null,
    }
  }

  async function startTipCardIntent() {
    setError(null)
    setBusy(true)
    try {
      await createTipIntent("MANUAL_CARD")
    } catch (e) {
      setError(formatPaymentCatchError(e, "Could not start tip card charge."))
    } finally {
      setBusy(false)
    }
  }

  async function runTipTapToPay() {
    setError(null)
    setBusy(true)
    setTapListening(true)
    let terminal: Terminal | null = null
    try {
      const intent = await createTipIntent("TAP_TO_PAY")
      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")
      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
          const json = (await res.json()) as { data?: { secret?: string }; error?: string }
          if (!res.ok || !json.data?.secret) {
            throw new Error(json.error || "Could not fetch Terminal connection token")
          }
          return json.data.secret
        },
        onUnexpectedReaderDisconnect: () => {
          setError("Card reader disconnected.")
          setTapListening(false)
        },
      })
      const pk = intent.publishableKey
      const liveMode = isStripeLivePublishableKey(pk)
      const allowSimulator = isStripeTestPublishableKey(pk)
      let discover = await terminal.discoverReaders({ simulated: false })
      const noRealReader =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length
      if (noRealReader && allowSimulator && !liveMode) {
        discover = await terminal.discoverReaders({ simulated: true })
      }
      if ("error" in discover) {
        throw new Error(formatPaymentCatchError(discover.error, "Could not find a tap reader."))
      }
      const reader = discover.discoveredReaders?.[0]
      if (!reader) throw new Error(tapToPayNoReaderMessage(liveMode || !allowSimulator))
      const connected = await terminal.connectReader(reader)
      if ("error" in connected) {
        throw new Error(formatPaymentCatchError(connected.error, "Could not connect reader."))
      }
      const collected = await terminal.collectPaymentMethod(intent.clientSecret)
      if ("error" in collected) {
        throw new Error(formatPaymentCatchError(collected.error, "Tip tap failed."))
      }
      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) {
        throw new Error(formatPaymentCatchError(processed.error, "Tip charge failed."))
      }
      const tipPiId = String(processed.paymentIntent?.id || intent.paymentIntentId || "")
      if (tipPiId) await confirmServer(tipPiId)
      if (paidPaymentIntentId) {
        await saveSlip({ tipPaymentIntentId: tipPiId || null, tipCents: tipChargeCents }).catch(
          () => null
        )
      }
      setClientSecret(null)
      setPublishableKey(null)
      setPostPayStep("receipt")
    } catch (e) {
      setError(formatPaymentCatchError(e, "Tip Tap to Pay failed — try card."))
    } finally {
      setTapListening(false)
      setBusy(false)
      try {
        await terminal?.disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  async function sendReceipt(channel: "email" | "sms") {
    if (!paidPaymentIntentId) {
      setError("Receipt needs a card payment — cash jobs can skip this.")
      return
    }
    setReceiptBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/payments/send-receipt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId: paidPaymentIntentId,
          channel,
          customerName: receiptName.trim() || undefined,
          email: channel === "email" ? receiptEmail.trim() : undefined,
          phone: channel === "sms" ? receiptPhone.trim() : undefined,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not send receipt")
      props.onCompleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send receipt")
    } finally {
      setReceiptBusy(false)
    }
  }

  async function saveCashInvoice() {
    const lineItems = lineItemsPayload()
    if (totalCents < 50) throw new Error("Enter an amount of at least $0.50.")
    if (lineItems.length === 0) throw new Error("Add at least one line item with an amount.")
    const res = await fetch("/api/tech/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        leadId: props.job.id,
        lineItems,
        taxCents,
        paymentMethod: "cash",
        collectNow: true,
      }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not record cash payment")
  }

  async function runTapToPay() {
    setError(null)
    setBusy(true)
    setTapListening(true)
    setMethod("tap")
    let terminal: Terminal | null = null
    try {
      const intent = await createIntent("TAP_TO_PAY")
      const StripeTerminal = await loadStripeTerminal()
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetch("/api/payments/terminal/connection-token", {
            method: "POST",
            credentials: "include",
          })
          const json = (await res.json()) as { data?: { secret?: string }; error?: string }
          if (!res.ok || !json.data?.secret) {
            throw new Error(json.error || "Could not fetch Terminal connection token")
          }
          return json.data.secret
        },
        onUnexpectedReaderDisconnect: () => {
          setError("Card reader disconnected. Try again or use Manual Card Entry.")
          setTapListening(false)
        },
      })

      // Live keys must use a real reader — simulated readers only work with pk_test_…
      const pk = intent.publishableKey
      const liveMode = isStripeLivePublishableKey(pk)
      const allowSimulator = isStripeTestPublishableKey(pk)

      let discover = await terminal.discoverReaders({ simulated: false })
      const noRealReader =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length
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

      const collected = await terminal.collectPaymentMethod(intent.clientSecret)
      if ("error" in collected) {
        throw new Error(
          formatPaymentCatchError(collected.error, "Customer didn’t complete the tap. Try again.")
        )
      }

      const processed = await terminal.processPayment(collected.paymentIntent)
      if ("error" in processed) {
        throw new Error(
          formatPaymentCatchError(processed.error, "Tap charge failed — try Manual Card Entry.")
        )
      }

      const piId = String(processed.paymentIntent?.id || intent.paymentIntentId || "")
      if (piId) await confirmServer(piId)

      // Persist invoice line items; wallet already credited via PaymentIntent confirm.
      await fetch("/api/tech/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: props.job.id,
          lineItems: lineItemsPayload(),
          taxCents,
          paymentMethod: "card",
          collectNow: true,
          skipWalletCredit: true,
        }),
      }).catch(() => {})

      enterTipSignStep(piId || intent.paymentIntentId, totalCents)
    } catch (e) {
      setError(formatPaymentCatchError(e, "Tap to Pay failed — try Manual Card Entry."))
      setMethod(null)
    } finally {
      setTapListening(false)
      setBusy(false)
      try {
        await terminal?.disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  async function startManualCard() {
    setError(null)
    setBusy(true)
    setMethod("card")
    setActivePopup("card")
    try {
      await createIntent("MANUAL_CARD")
    } catch (e) {
      setError(formatPaymentCatchError(e, "Could not start card payment — try again."))
      setMethod(null)
      setActivePopup(null)
    } finally {
      setBusy(false)
    }
  }

  async function payCash() {
    setError(null)
    setBusy(true)
    setMethod("cash")
    try {
      await saveCashInvoice()
      // Cash has no Stripe PI — tip can still be charged on card; signature is optional.
      enterTipSignStep(null, totalCents)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record cash payment")
      setMethod(null)
    } finally {
      setBusy(false)
    }
  }

  /** Create Stripe Checkout URL and text or email it to the customer. */
  async function sendPayLink(channel: "sms" | "email") {
    setError(null)
    setLinkSentUrl(null)
    setLinkDelivered(false)
    if (totalCents < 50) {
      setError("Enter an amount of at least $0.50.")
      return
    }
    setBusy(true)
    setMethod("link")
    try {
      const res = await fetch("/api/payments/send-pay-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel,
          jobId: props.job.id,
          // API expects pre-tax dollars; tax is re-applied server-side.
          amount: subtotalCents / 100,
          taxEnabled,
          taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
          customerName: linkName.trim() || undefined,
          phone: channel === "sms" ? linkPhone.trim() : undefined,
          email: channel === "email" ? linkEmail.trim() : undefined,
          lineItems: lineItemsPayload(),
          note: lineItemsPayload()
            .map((l) => l.label)
            .join(", ")
            .slice(0, 120),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { url?: string; sent?: boolean }
      }
      // Always keep the Checkout URL for copy/paste — but only claim "sent" on success.
      if (json.data?.url) setLinkSentUrl(json.data.url)
      if (!res.ok || json.data?.sent === false) {
        throw new Error(
          json.error ||
            (channel === "sms"
              ? "Pay link created, but the text could not be delivered. Copy the link below."
              : "Pay link created, but email could not be sent. Copy the link below.")
        )
      }
      setLinkDelivered(true)
    } catch (e) {
      setError(formatPaymentCatchError(e, "Could not send pay link — try again."))
    } finally {
      setBusy(false)
    }
  }

  // Portal to <body>: Collect opens this from under the acrylic header (backdrop-filter),
  // which otherwise traps position:fixed to the header — only a sliver shows on screen.
  const modal = (
    <div
      className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Proceed to payment"
    >
      {tapListening ? (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#0b0b12]/95 px-8 text-center">
          <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" />
            <span className="relative flex h-24 w-24 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/15">
              <Nfc className="h-10 w-10 text-indigo-200" aria-hidden />
            </span>
          </div>
          <Loader2 className="mb-4 h-6 w-6 animate-spin text-indigo-300" aria-hidden />
          <p className="text-lg font-semibold text-white">Hold card to back of phone…</p>
          <p className="mt-2 max-w-xs text-sm text-zinc-400">
            Keep the contactless card or wallet still until the charge completes.
          </p>
          <p className="mt-4 font-mono text-xl font-bold text-emerald-300">{fmt(totalCents)}</p>
        </div>
      ) : null}

      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-[#101018] shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">
              {postPayStep === "tip_sign"
                ? "Tip & signature"
                : postPayStep === "tip_charge"
                  ? "Charge tip"
                  : postPayStep === "receipt"
                    ? "Send invoice"
                    : "Proceed to Payment"}
            </h2>
            <p className="text-xs text-zinc-500">
              {props.job.customer_name || props.job.customer_phone || "Customer"}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy || tapListening || slipBusy}
            className="rounded-lg p-2 text-zinc-400 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {postPayStep === "tip_sign" ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
              <p className="text-sm font-semibold text-emerald-100">Payment received</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                {fmt(paidTotalCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
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
                        {fmt(Math.round(paidTotalCents * (Number(opt.id) / 100)))}
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
                <p className="mt-2 text-xs text-zinc-400">
                  Tip {fmt(selectedTipCents())}
                  {" · "}
                  New total{" "}
                  <span className="font-semibold text-emerald-300">
                    {fmt(paidTotalCents + selectedTipCents())}
                  </span>
                </p>
              ) : null}
            </div>
            <CustomerSignaturePad onChange={setSignaturePng} />
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button
              type="button"
              disabled={slipBusy}
              onClick={() => void continueFromTipSign()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {slipBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {selectedTipCents() >= 50
                ? `Continue · charge tip ${fmt(selectedTipCents())}`
                : "Continue"}
            </button>
            <button
              type="button"
              disabled={slipBusy}
              onClick={() =>
                void continueFromTipSign({
                  allowNoSignature: !signaturePng,
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
        ) : postPayStep === "tip_charge" ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
              <p className="text-sm font-semibold text-emerald-100">Tip amount</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                {fmt(tipChargeCents)}
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
                    disabled={busy}
                    onClick={() => void runTipTapToPay()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Nfc className="h-4 w-4" aria-hidden />
                    )}
                    Tap to Pay tip
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void startTipCardIntent()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
                  >
                    <CreditCard className="h-4 w-4" aria-hidden />
                    Card for tip
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setClientSecret(null)
                      setPostPayStep("receipt")
                    }}
                    className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-300"
                  >
                    Skip tip charge
                  </button>
                </div>
              )
            ) : publishableKey ? (
              <Elements
                stripe={getStripePromise(publishableKey)}
                options={{
                  clientSecret,
                  appearance: {
                    theme: "night",
                    variables: { colorPrimary: "#10b981", borderRadius: "10px" },
                  },
                }}
              >
                <ManualCardForm
                  totalLabel={fmt(tipChargeCents)}
                  paymentIntentId={paymentIntentId}
                  lineItems={[{ label: "Tip", amountCents: tipChargeCents }]}
                  jobId={props.job.id}
                  taxCents={0}
                  skipInvoice
                  onError={setError}
                  onSuccess={(tipPiId) => {
                    void (async () => {
                      if (paidPaymentIntentId) {
                        await saveSlip({
                          tipPaymentIntentId: tipPiId,
                          tipCents: tipChargeCents,
                        }).catch(() => null)
                      }
                      setClientSecret(null)
                      setPublishableKey(null)
                      setPostPayStep("receipt")
                    })()
                  }}
                  onBack={() => {
                    setClientSecret(null)
                    setPublishableKey(null)
                  }}
                />
              </Elements>
            ) : (
              <p className="text-sm text-rose-400">Missing Stripe publishable key.</p>
            )}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>
        ) : postPayStep === "receipt" ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="mt-2 text-sm font-semibold text-emerald-100">Payment complete</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-300">
                {fmt(paidTotalCents + Math.max(0, tipChargeCents || selectedTipCents()))}
              </p>
            </div>
            {paidPaymentIntentId ? (
              <>
                <p className="text-xs text-zinc-500">Optional — email or text a receipt.</p>
                <input
                  value={receiptName}
                  onChange={(e) => setReceiptName(e.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                />
                <input
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                  placeholder="Email"
                  inputMode="email"
                  autoCapitalize="none"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                />
                <input
                  value={receiptPhone}
                  onChange={(e) => setReceiptPhone(e.target.value)}
                  placeholder="Mobile for text"
                  inputMode="tel"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                />
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
                <button
                  type="button"
                  disabled={receiptBusy || !receiptEmail.trim()}
                  onClick={() => void sendReceipt("email")}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {receiptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Email invoice
                </button>
                <button
                  type="button"
                  disabled={receiptBusy || !receiptPhone.trim()}
                  onClick={() => void sendReceipt("sms")}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
                >
                  <MessageSquare className="h-4 w-4" />
                  Text invoice
                </button>
              </>
            ) : (
              <p className="text-xs text-zinc-500">
                Cash payment recorded. Tip was charged separately if you collected one.
              </p>
            )}
            <button
              type="button"
              disabled={receiptBusy}
              onClick={() => props.onCompleted()}
              className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-300"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <section>
                {/* Collapsed by default so the sheet stays short; expand only to edit lines. */}
                <details className="group rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <summary className="cursor-pointer list-none px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Invoice lines
                        </p>
                        <p className="mt-0.5 text-sm text-zinc-300">
                          {lines.length} line{lines.length === 1 ? "" : "s"} · tap to edit
                        </p>
                      </div>
                      <span className="text-xs font-medium text-indigo-300 group-open:hidden">Show</span>
                      <span className="hidden text-xs font-medium text-indigo-300 group-open:inline">
                        Hide
                      </span>
                    </div>
                  </summary>
                  <div className="space-y-2 border-t border-zinc-800 px-4 py-3">
                    {lines.map((line) => (
                      <div key={line.id} className="flex items-center gap-2">
                        <input
                          value={line.label}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l.id === line.id ? { ...l, label: e.target.value } : l
                              )
                            )
                          }
                          placeholder="Description"
                          disabled={busy || activePopup !== null}
                          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-60"
                        />
                        <div className="relative w-28 shrink-0">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-zinc-500">
                            $
                          </span>
                          <input
                            value={line.amount}
                            onChange={(e) => {
                              setAmountEdited(false)
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id
                                    ? { ...l, amount: e.target.value.replace(/[^\d.]/g, "") }
                                    : l
                                )
                              )
                            }}
                            inputMode="decimal"
                            placeholder="0.00"
                            disabled={busy || activePopup !== null}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 pr-2 pl-6 text-right text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-60"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAmountEdited(false)
                            setLines((prev) =>
                              prev.length > 1 ? prev.filter((l) => l.id !== line.id) : prev
                            )
                          }}
                          disabled={lines.length === 1 || busy || activePopup !== null}
                          className="shrink-0 rounded-lg p-2 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={busy || activePopup !== null}
                      onClick={() => setLines((prev) => [...prev, newLine()])}
                      className="mt-1 inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" /> Add line
                    </button>
                  </div>
                </details>

                {/* Editable amount + sales tax (same idea as walk-up Collect Payment) */}
                <div className="mt-3 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Amount (before tax)
                    </span>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-zinc-500">
                        $
                      </span>
                      <input
                        ref={amountInputRef}
                        value={amountInput}
                        onChange={(e) => {
                          setAmountEdited(true)
                          setError(null)
                          setAmountInput(e.target.value.replace(/[^\d.]/g, ""))
                        }}
                        inputMode="decimal"
                        placeholder="85.00"
                        disabled={busy || activePopup !== null}
                        aria-label="Amount before tax"
                        className={cn(
                          "w-full rounded-lg border bg-zinc-950 py-2.5 pr-3 pl-7 text-right text-lg font-bold tabular-nums text-white outline-none focus:border-emerald-500 disabled:opacity-60",
                          totalCents < 50 ? "border-amber-500/60" : "border-zinc-700"
                        )}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Type the charge here first (min $0.50) — then pick Tap, Card, Link, or Cash.
                    </p>
                  </label>

                  <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">Sales tax</p>
                      <p className="text-[11px] text-zinc-500">Add tax on top of the amount</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={taxEnabled}
                      disabled={busy || activePopup !== null}
                      onClick={() => setTaxEnabled((v) => !v)}
                      className={cn(
                        "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                        taxEnabled ? "bg-emerald-500" : "bg-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                          taxEnabled && "translate-x-5"
                        )}
                      />
                    </button>
                  </div>

                  {taxEnabled ? (
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Tax rate (%)
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="30"
                        step="0.01"
                        value={taxRatePercent}
                        onChange={(e) => setTaxRatePercent(e.target.value)}
                        disabled={busy || activePopup !== null}
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm tabular-nums text-white outline-none disabled:opacity-60"
                      />
                    </label>
                  ) : null}

                  <div className="space-y-1 border-t border-zinc-800 pt-3 text-xs tabular-nums">
                    <div className="flex justify-between text-zinc-400">
                      <span>Subtotal</span>
                      <span>{fmt(subtotalCents)}</span>
                    </div>
                    {taxEnabled ? (
                      <div className="flex justify-between text-zinc-400">
                        <span>Tax ({breakdown.ratePercent.toFixed(2)}%)</span>
                        <span>{fmt(taxCents)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-sm font-medium text-zinc-300">Total charge</span>
                      <span className="text-lg font-bold text-emerald-300">{fmt(totalCents)}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Payment options
                </p>
                {totalCents < 50 ? (
                  <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100">
                    Enter an amount of at least $0.50 above before choosing how to collect.
                  </p>
                ) : null}
                {error && !postPayStep && !activePopup ? (
                  <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
                    <p className="text-sm font-semibold text-red-200">Couldn’t start payment</p>
                    <p className="mt-0.5 text-sm leading-snug text-red-300/95">{error}</p>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <PayOptionButton
                    active={method === "tap"}
                    disabled={busy || activePopup !== null}
                    dimmed={totalCents < 50}
                    onClick={() => {
                      if (!requireChargeAmount()) return
                      void runTapToPay()
                    }}
                    title="Tap to Pay"
                    subtitle="NFC — hold card to back of phone"
                    icon={<Nfc className="h-5 w-5" />}
                  />
                  <PayOptionButton
                    active={activePopup === "card"}
                    disabled={busy || activePopup !== null}
                    dimmed={totalCents < 50}
                    onClick={() => {
                      if (!requireChargeAmount()) return
                      void startManualCard()
                    }}
                    title="Manual Card Entry"
                    subtitle="Opens a secure card popup"
                    icon={<CreditCard className="h-5 w-5" />}
                  />
                  <PayOptionButton
                    active={activePopup === "link"}
                    disabled={busy || activePopup !== null}
                    dimmed={totalCents < 50}
                    onClick={() => {
                      if (!requireChargeAmount()) return
                      setError(null)
                      setMethod("link")
                      setLinkSentUrl(null)
                      setActivePopup("link")
                    }}
                    title="Text / email pay link"
                    subtitle="Opens a popup to send Stripe Checkout"
                    icon={<Link2 className="h-5 w-5" />}
                  />
                  <PayOptionButton
                    active={method === "cash"}
                    disabled={busy || activePopup !== null}
                    dimmed={totalCents < 50}
                    onClick={() => {
                      if (!requireChargeAmount()) return
                      void payCash()
                    }}
                    title="Cash / Alternative"
                    subtitle="Mark paid without charging a card"
                    icon={<Banknote className="h-5 w-5" />}
                  />
                </div>
              </section>
            </div>

            {/* Nested popups keep Card / Link forms off the main scroll. */}
            {activePopup === "link" ? (
              <NestedPayPopup title="Text / email pay link" onClose={closePayPopup}>
                <p className="text-xs text-emerald-100/90">
                  Sends a secure link for {fmt(totalCents)}. When they pay, the job is marked
                  collected.
                </p>
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Customer name
                  </span>
                  <input
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    disabled={busy}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Mobile for text
                  </span>
                  <input
                    value={linkPhone}
                    onChange={(e) => setLinkPhone(e.target.value)}
                    disabled={busy}
                    inputMode="tel"
                    placeholder="+15551234567"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Email
                  </span>
                  <input
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    disabled={busy}
                    inputMode="email"
                    autoCapitalize="none"
                    placeholder="customer@email.com"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none disabled:opacity-60"
                  />
                </label>
                <div className="grid gap-2">
                  <button
                    type="button"
                    disabled={busy || !linkPhone.trim()}
                    onClick={() => void sendPayLink("sms")}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <MessageSquare className="h-4 w-4" aria-hidden />
                    )}
                    Text pay link
                  </button>
                  <button
                    type="button"
                    disabled={busy || !linkEmail.trim()}
                    onClick={() => void sendPayLink("email")}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 py-3 text-sm font-semibold text-slate-100 disabled:opacity-50"
                  >
                    <Mail className="h-4 w-4" aria-hidden />
                    Email pay link
                  </button>
                </div>
                {linkSentUrl ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
                    <p className="text-sm font-semibold text-emerald-200">
                      {linkDelivered ? "Link sent" : "Pay link ready (not delivered)"}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-emerald-100/80">{linkSentUrl}</p>
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-emerald-300 underline"
                      onClick={() => {
                        void navigator.clipboard?.writeText(linkSentUrl)
                      }}
                    >
                      Copy link
                    </button>
                  </div>
                ) : null}
              </NestedPayPopup>
            ) : null}

            {activePopup === "card" ? (
              <NestedPayPopup title="Manual card entry" onClose={closePayPopup}>
                {error ? <p className="text-sm text-red-300">{error}</p> : null}
                {clientSecret && publishableKey ? (
                  <Elements
                    stripe={getStripePromise(publishableKey)}
                    options={{
                      clientSecret,
                      appearance: {
                        theme: "night",
                        variables: { colorPrimary: "#6366f1", borderRadius: "10px" },
                      },
                    }}
                  >
                    <ManualCardForm
                      totalLabel={fmt(totalCents)}
                      paymentIntentId={paymentIntentId}
                      lineItems={lineItemsPayload()}
                      jobId={props.job.id}
                      taxCents={taxCents}
                      onError={setError}
                      onSuccess={(piId) => {
                        enterTipSignStep(piId || paymentIntentId, totalCents)
                      }}
                      onBack={closePayPopup}
                    />
                  </Elements>
                ) : busy ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-zinc-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Preparing secure card form…
                  </div>
                ) : (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    Add <span className="font-mono">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</span> in
                    Vercel to enable Manual Card Entry.
                  </p>
                )}
              </NestedPayPopup>
            ) : null}
          </>
        )}
      </div>
    </div>
  )

  if (!mounted || typeof document === "undefined") return null
  return createPortal(modal, document.body)
}

/** Second-layer sheet on top of Proceed to Payment (Card / pay-link forms). */
function NestedPayPopup(props: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    // Full-screen dimmer above the main payment sheet (z above 7000).
    <div className="fixed inset-0 z-[7200] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center">
      {/* Compact panel — scrolls inside if the form is tall. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-700 bg-[#12121a] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h3 className="text-sm font-bold text-white">{props.title}</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-2 text-zinc-400 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">{props.children}</div>
      </div>
    </div>
  )
}

function PayOptionButton(props: {
  title: string
  subtitle: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  /** Soft “needs amount” look — still clickable so we can show an error. */
  dimmed?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition active:scale-[0.99] disabled:opacity-50",
        props.active
          ? "border-indigo-500 bg-indigo-500/15"
          : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600",
        props.dimmed && !props.disabled && "opacity-70"
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950/60 text-indigo-300">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{props.title}</span>
        <span className="block text-[11px] text-zinc-500">{props.subtitle}</span>
      </span>
    </button>
  )
}

function ManualCardForm(props: {
  totalLabel: string
  paymentIntentId: string | null
  jobId: string
  lineItems: { label: string; amountCents: number }[]
  taxCents?: number
  /** Tip-only charge — skip writing a full job invoice again. */
  skipInvoice?: boolean
  onError: (msg: string | null) => void
  onSuccess: (paymentIntentId: string | null) => void
  onBack: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    props.onError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear once when form mounts
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    props.onError(null)
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url:
            typeof window !== "undefined"
              ? `${window.location.origin}/tech/dashboard`
              : undefined,
        },
      })
      if (error) {
        props.onError(
          formatStripeCardFailure(error, "Card was declined — try another card.")
        )
        return
      }
      if (
        paymentIntent &&
        paymentIntent.status !== "succeeded" &&
        paymentIntent.status !== "requires_capture"
      ) {
        props.onError(
          `Payment not completed (status: ${paymentIntent.status}). Ask the customer to finish bank verification, or try another card.`
        )
        return
      }
      const piId = paymentIntent?.id || props.paymentIntentId
      if (piId) {
        const res = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ paymentIntentId: piId }),
        })
        if (!res.ok) {
          const json = (await res.json()) as { error?: string }
          throw new Error(
            json.error ||
              "Card charged, but Lyncr could not confirm it yet. Check Stripe before retrying."
          )
        }
      }
      if (!props.skipInvoice) {
        await fetch("/api/tech/invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            leadId: props.jobId,
            lineItems: props.lineItems,
            taxCents: props.taxCents ?? 0,
            paymentMethod: "card",
            collectNow: true,
            skipWalletCredit: true,
          }),
        }).catch(() => {})
      }
      props.onSuccess(piId ?? null)
    } catch (err) {
      props.onError(formatPaymentCatchError(err, "Card payment failed — try another card."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Card details</p>
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={props.onBack}
          className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-3 text-sm font-semibold text-zinc-200 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay ${props.totalLabel}`}
        </button>
      </div>
    </form>
  )
}
