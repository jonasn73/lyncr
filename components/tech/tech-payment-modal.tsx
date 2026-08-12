// Interactive job payment modal — invoice breakdown + Tap to Pay / Manual Card / Cash.

"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ArrowLeft,
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
  tipCentsFromChoice,
  tipLastSheetSubtitle,
  tipLastTotalNote,
  tipLastPrimaryCta,
  tipSignHandBackCue,
  tipSignSheetTitle,
  postPaySignSheetTitle,
  postPaySignSheetSubtitle,
  postPaySignPrimaryCta,
  shouldOfferOptionalSignature,
  type PaidChargeChannel,
} from "@/lib/payment-slip-ui"
import {
  ChargeResultSummary,
  type TipChargeResult,
} from "@/components/payments/charge-result-summary"
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
  fetchWithTimeout,
  PAYMENT_API_TIMEOUT_MS,
  PAYMENT_CONFIRM_TIMEOUT_MS,
  TERMINAL_COLLECT_TIMEOUT_MS,
  TERMINAL_DISCOVER_TIMEOUT_MS,
  withTimeout,
} from "@/lib/payment-timeout"

type Line = { id: string; label: string; amount: string }
type PayMethod = "tap" | "card" | "cash" | "link"
/** Tip LAST (before money moves) → optional signature after pay → receipt. */
type PostPayStep = "tip_sign" | "sign" | "receipt"
type TipChoice = "none" | "15" | "18" | "20" | "custom"

/** Sent pay-link row from GET /api/payments/pay-links (with optional Stripe sync). */
type SentPayLink = {
  token: string
  url: string
  stripeSessionId?: string
  chargeCents: number
  paymentStatus: string
  walletSettled: boolean
  createdAt: string
  fulfilledNow?: boolean
}

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

export function TechPaymentModal(props: {
  job: DispatchJob
  onClose: () => void
  onCompleted: () => void
  /** When opened from Collect — show Back to the job list (same as Walk-up). */
  showBack?: boolean
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
  // Tax defaults to ON (6%) until Settings loads — matches product “tax unless turned off”.
  const [taxEnabled, setTaxEnabled] = useState(true)
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tapListening, setTapListening] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [stripeConnectAccountId, setStripeConnectAccountId] = useState<string | null>(null)
  // Contact for “Text / email pay link”.
  const [linkName, setLinkName] = useState(() => props.job.customer_name?.trim() || "")
  const [linkPhone, setLinkPhone] = useState(() => props.job.customer_phone?.trim() || "")
  const [linkEmail, setLinkEmail] = useState("")
  const [linkSentUrl, setLinkSentUrl] = useState<string | null>(null)
  /** True only when SMS/email actually delivered (not just Checkout URL created). */
  const [linkDelivered, setLinkDelivered] = useState(false)
  // Tip LAST (before charge) + optional signature after pay (same as owner Collect).
  const [postPayStep, setPostPayStep] = useState<PostPayStep | null>(null)
  /** Job total (service + tax) used as tip % base — set when entering tip screen. */
  const [paidTotalCents, setPaidTotalCents] = useState(0)
  /** How the single charge was taken — controls optional signature after pay. */
  const [paidChargeChannel, setPaidChargeChannel] = useState<PaidChargeChannel | null>(null)
  const [paidPaymentIntentId, setPaidPaymentIntentId] = useState<string | null>(null)
  const [tipChoice, setTipChoice] = useState<TipChoice>("none")
  const [customTipDollars, setCustomTipDollars] = useState("")
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [slipBusy, setSlipBusy] = useState(false)
  const [tipResult, setTipResult] = useState<TipChargeResult>({ kind: "none" })
  const [receiptName, setReceiptName] = useState(() => props.job.customer_name?.trim() || "")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState(() => props.job.customer_phone?.trim() || "")
  const [receiptBusy, setReceiptBusy] = useState(false)
  /** Nested popup: card entry or pay-link form (keeps main sheet short). */
  const [activePopup, setActivePopup] = useState<"link" | "card" | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  /** Previously sent pay links for this job (status + copy URL). */
  const [sentLinks, setSentLinks] = useState<SentPayLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)
  const [linksSyncing, setLinksSyncing] = useState(false)
  const [linkCancelBusy, setLinkCancelBusy] = useState<string | null>(null)
  /** Rare: owner wants a second charge after a link already paid. */
  const [forceNewCharge, setForceNewCharge] = useState(false)

  const waitingLinks = useMemo(
    () =>
      sentLinks.filter(
        (l) =>
          l.paymentStatus !== "paid" &&
          !l.walletSettled &&
          l.paymentStatus !== "expired"
      ),
    [sentLinks]
  )

  // Latest settled pay link for this job (if any).
  const paidLink = useMemo(
    () =>
      sentLinks.find((l) => l.paymentStatus === "paid" || l.walletSettled) ?? null,
    [sentLinks]
  )
  // While we still do not know link status, avoid flashing a blank “enter amount” form.
  const awaitingLinkStatus = linksLoading && sentLinks.length === 0
  const showPaidSummary = Boolean(paidLink) && !forceNewCharge && !postPayStep

  // Load / refresh pay-link status from Stripe (also credits wallet if customer already paid).
  async function refreshSentLinks(opts?: { sync?: boolean }) {
    const sync = opts?.sync !== false
    if (sync) setLinksSyncing(true)
    else setLinksLoading(true)
    // First open always shows the status spinner until we know paid vs unpaid.
    if (sentLinks.length === 0) setLinksLoading(true)
    try {
      const res = await fetchWithTimeout(
        `/api/payments/pay-links?jobId=${encodeURIComponent(props.job.id)}${sync ? "&sync=1" : ""}`,
        { credentials: "include", cache: "no-store" },
        // Sync hits Stripe — allow a bit longer, but never hang the Charge sheet forever.
        sync ? 45_000 : PAYMENT_API_TIMEOUT_MS,
        "Checking pay links timed out."
      )
      const json = (await res.json().catch(() => ({}))) as {
        data?: { links?: SentPayLink[] }
      }
      const list = Array.isArray(json.data?.links) ? json.data!.links! : []
      setSentLinks(list)
      const justPaid = list.find((l) => l.fulfilledNow)
      if (justPaid) {
        setError(null)
        setLinkSentUrl(justPaid.url)
        setLinkDelivered(true)
        setForceNewCharge(false)
      }
    } catch {
      /* keep prior list — still clear loading so Charge UI is usable */
    } finally {
      setLinksLoading(false)
      setLinksSyncing(false)
    }
  }

  useEffect(() => {
    setForceNewCharge(false)
    void refreshSentLinks({ sync: true })
    // Load business tax defaults (ON + % unless Settings turned them off).
    void (async () => {
      try {
        const res = await fetch("/api/settings/sales-tax", {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as {
          data?: { enabledDefault?: boolean; ratePercent?: number }
        }
        if (!res.ok) return
        setTaxEnabled(json.data?.enabledDefault !== false)
        if (typeof json.data?.ratePercent === "number" && Number.isFinite(json.data.ratePercent)) {
          setTaxRatePercent(String(json.data.ratePercent))
        }
      } catch {
        /* keep ON / 6% */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when opening this job
  }, [props.job.id])

  async function cancelPayLink(link: SentPayLink) {
    setLinkCancelBusy(link.token)
    setError(null)
    try {
      const res = await fetch("/api/payments/pay-links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          token: link.token,
          sessionId: link.stripeSessionId,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not cancel link")
      await refreshSentLinks({ sync: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel link")
    } finally {
      setLinkCancelBusy(null)
    }
  }
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
  // Do not wipe a quoted amount with $0 when lines are still empty.
  useEffect(() => {
    if (amountEdited) return
    if (linesSubtotalCents <= 0) return
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
    // Tip chosen on tip screen — baked into the SAME PaymentIntent (one charge).
    const tipCents = selectedTipCents()
    const res = await fetchWithTimeout(
      "/api/payments/create-intent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          jobId: props.job.id,
          // Job total including sales tax (invoiceOverride allows any amount).
          amount: totalCents / 100,
          paymentMethodType,
          invoiceOverride: true,
          lineItems,
          taxEnabled,
          taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
          tipCents,
        }),
      },
      PAYMENT_API_TIMEOUT_MS,
      "Starting the charge timed out. Check your connection and try again."
    )
    const json = (await res.json()) as {
      error?: string
      data?: {
        clientSecret?: string
        client_secret?: string
        paymentIntentId?: string
        publishableKey?: string | null
        stripeConnectAccountId?: string | null
      }
    }
    if (!res.ok) throw new Error(json.error || "Could not start payment")
    const secret = json.data?.clientSecret || json.data?.client_secret
    if (!secret) throw new Error("No client_secret returned")
    setClientSecret(secret)
    setPaymentIntentId(json.data?.paymentIntentId ?? null)
    setPublishableKey(json.data?.publishableKey?.trim() || null)
    setStripeConnectAccountId(json.data?.stripeConnectAccountId?.trim() || null)
    return {
      clientSecret: secret,
      paymentIntentId: json.data?.paymentIntentId ?? null,
      publishableKey: json.data?.publishableKey?.trim() || null,
      stripeConnectAccountId: json.data?.stripeConnectAccountId?.trim() || null,
    }
  }

  async function confirmServer(piId: string) {
    const res = await fetchWithTimeout(
      "/api/payments/confirm",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          paymentIntentId: piId,
          stripeConnectAccountId: stripeConnectAccountId || undefined,
        }),
      },
      PAYMENT_API_TIMEOUT_MS,
      "Payment confirmation timed out. Check Stripe before retrying."
    )
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not confirm payment")
  }

  function selectedTipCents(): number {
    // Prefer tip-screen base (paidTotalCents); fall back to live job total before charge.
    const base = paidTotalCents > 0 ? paidTotalCents : totalCents
    return tipCentsFromChoice(tipChoice, base, customTipDollars)
  }

  /** Charge amount shown on tip screen = job total + tip (one swipe). */
  function chargeWithTipCents(): number {
    const base = paidTotalCents > 0 ? paidTotalCents : totalCents
    return base + selectedTipCents()
  }

  /**
   * Amount screen → pick how to pay → tip LAST (no money moves yet).
   * Confirm on the tip step creates one PaymentIntent (job + tip).
   */
  function enterTipStepWithMethod(next: PayMethod) {
    if (!requireChargeAmount()) return
    setPaidTotalCents(totalCents)
    setPaidPaymentIntentId(null)
    setPaidChargeChannel(null)
    setTipChoice("none")
    setCustomTipDollars("")
    setSignaturePng(null)
    setTipResult({ kind: "none" })
    setClientSecret(null)
    setPublishableKey(null)
    setPaymentIntentId(null)
    setMethod(next)
    setActivePopup(null)
    setPostPayStep("tip_sign")
    setError(null)
  }

  /** Tip Confirm — runs the method chosen on the amount step (single charge). */
  function confirmTipAndCharge() {
    if (method === "tap") {
      void runTapToPay()
      return
    }
    if (method === "card") {
      void startManualCard()
      return
    }
    if (method === "cash") {
      void payCash()
      return
    }
    if (method === "link") {
      setError(null)
      setLinkSentUrl(null)
      setActivePopup("link")
    }
  }

  /** Expire leftover Waiting pay links after an in-person charge succeeds. */
  function expireWaitingPayLinks() {
    if (waitingLinks.length === 0) return
    void (async () => {
      for (const link of waitingLinks) {
        try {
          await fetch("/api/payments/pay-links", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              token: link.token,
              sessionId: link.stripeSessionId,
            }),
          })
        } catch {
          /* best-effort */
        }
      }
      void refreshSentLinks({ sync: true })
    })()
  }

  /**
   * After the single charge succeeds: save tip on slip, then optional signature (Tap ≥ $25)
   * or go straight to receipt. Never creates a second PaymentIntent.
   */
  async function enterPostPaySignOrReceipt(
    piId: string | null,
    chargedBaseCents: number,
    channel: PaidChargeChannel,
    tipCents: number
  ) {
    setPaidPaymentIntentId(piId)
    setPaidTotalCents(chargedBaseCents)
    setPaidChargeChannel(channel)
    setClientSecret(null)
    setPublishableKey(null)
    setPaymentIntentId(null)
    setMethod(null)
    setActivePopup(null)
    setError(null)
    setSignaturePng(null)
    const tipOutcome: TipChargeResult =
      tipCents > 0 ? { kind: "charged", cents: tipCents } : { kind: "none" }
    setTipResult(tipOutcome)

    if (piId) {
      try {
        await saveSlip({
          paymentIntentId: piId,
          tipCents,
        })
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.message} Payment is still complete — continue to invoice.`
            : "Could not save tip / signature. Payment is still complete."
        )
      }
    }

    expireWaitingPayLinks()

    const totalCharged = chargedBaseCents + tipCents
    if (shouldOfferOptionalSignature(channel, totalCharged)) {
      setPostPayStep("sign")
    } else {
      setPostPayStep("receipt")
    }
  }

  const offerOptionalSignature = shouldOfferOptionalSignature(
    paidChargeChannel,
    paidTotalCents + (tipResult.kind === "charged" ? tipResult.cents : 0)
  )

  function goToReceipt(nextTip?: TipChargeResult) {
    if (nextTip) setTipResult(nextTip)
    setPostPayStep("receipt")
  }

  async function saveSlip(opts?: {
    paymentIntentId?: string | null
    tipCents?: number
  }) {
    const piId = opts?.paymentIntentId ?? paidPaymentIntentId
    if (!piId) return
    const tipCents = opts?.tipCents ?? selectedTipCents()
    const res = await fetch("/api/payments/complete-slip", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentIntentId: piId,
        tipCents,
        signaturePng,
        // Required for Connect direct charges (PI lives on the shop account).
        stripeConnectAccountId: stripeConnectAccountId || undefined,
      }),
    })
    const json = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(json.error || "Could not save tip / signature")
  }

  /** Optional signature step after the single charge — update slip then receipt. */
  async function continueFromSign() {
    setSlipBusy(true)
    setError(null)
    try {
      if (paidPaymentIntentId) {
        const tipCents = tipResult.kind === "charged" ? tipResult.cents : 0
        await saveSlip({ tipCents })
      }
      goToReceipt()
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Payment is still complete — continue to invoice.`
          : "Could not save signature. Payment is still complete."
      )
      goToReceipt()
    } finally {
      setSlipBusy(false)
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

  /** Line items for invoice writes — append tip when collecting tip-last. */
  function invoiceLineItemsWithTip(tipCents: number) {
    const items = lineItemsPayload()
    if (tipCents > 0) items.push({ label: "Tip", amountCents: tipCents })
    return items
  }

  async function saveCashInvoice(tipCents = 0) {
    const lineItems = invoiceLineItemsWithTip(tipCents)
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
      const StripeTerminal = await withTimeout(
        loadStripeTerminal(),
        TERMINAL_DISCOVER_TIMEOUT_MS,
        "Tap to Pay SDK timed out. Use Manual Card Entry or a pay link."
      )
      if (!StripeTerminal) throw new Error("Stripe Terminal SDK failed to load")

      terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => {
          const res = await fetchWithTimeout(
            "/api/payments/terminal/connection-token",
            {
              method: "POST",
              credentials: "include",
            },
            PAYMENT_API_TIMEOUT_MS,
            "Terminal connection timed out. Use Manual Card Entry."
          )
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

      let discover = await withTimeout(
        terminal.discoverReaders({ simulated: false }),
        TERMINAL_DISCOVER_TIMEOUT_MS,
        tapToPayNoReaderMessage(liveMode || !allowSimulator)
      )
      const noRealReader =
        "error" in discover ||
        !("discoveredReaders" in discover) ||
        !discover.discoveredReaders?.length
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
        "Could not connect to the reader in time. Use Manual Card Entry."
      )
      if ("error" in connected) {
        throw new Error(formatPaymentCatchError(connected.error, "Could not connect to the reader."))
      }

      const collected = await withTimeout(
        terminal.collectPaymentMethod(intent.clientSecret),
        TERMINAL_COLLECT_TIMEOUT_MS,
        "No tap received in time. Try again or use Manual Card Entry."
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
          formatPaymentCatchError(processed.error, "Tap charge failed — try Manual Card Entry.")
        )
      }

      const piId = String(processed.paymentIntent?.id || intent.paymentIntentId || "")
      if (piId) await confirmServer(piId)

      const tipCents = selectedTipCents()
      const baseCents = paidTotalCents > 0 ? paidTotalCents : totalCents

      // Persist invoice line items (incl. tip); wallet already credited via PaymentIntent confirm.
      await fetch("/api/tech/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: props.job.id,
          lineItems: invoiceLineItemsWithTip(tipCents),
          taxCents,
          paymentMethod: "card",
          collectNow: true,
          skipWalletCredit: true,
        }),
      }).catch(() => {})

      await enterPostPaySignOrReceipt(
        piId || intent.paymentIntentId,
        baseCents,
        "tap",
        tipCents
      )
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
      const tipCents = selectedTipCents()
      const baseCents = paidTotalCents > 0 ? paidTotalCents : totalCents
      // Cash records job + tip in one invoice — no second card tip charge.
      await saveCashInvoice(tipCents)
      await enterPostPaySignOrReceipt(null, baseCents, "cash", tipCents)
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
    // Warn when another unpaid link is still Waiting — offer replace.
    if (waitingLinks.length > 0) {
      const ok = window.confirm(
        `There ${waitingLinks.length === 1 ? "is already 1 unpaid pay link" : `are already ${waitingLinks.length} unpaid pay links`} for this job.\n\nOK = cancel the old Waiting link(s) and send this new amount.\nCancel = go back without sending.`
      )
      if (!ok) return
    }
    setBusy(true)
    setMethod("link")
    try {
      // Pay-link API has no tipCents — bake tip into amount when sending from tip screen.
      const tipCents = postPayStep === "tip_sign" ? selectedTipCents() : 0
      const linkLineItems = invoiceLineItemsWithTip(tipCents)
      // When tip is included, send all-in dollars (job+tax+tip) with tax off so tip is not taxed twice.
      const linkAmountDollars =
        tipCents > 0 ? (totalCents + tipCents) / 100 : subtotalCents / 100
      const linkTaxEnabled = tipCents > 0 ? false : taxEnabled
      const res = await fetch("/api/payments/send-pay-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel,
          jobId: props.job.id,
          // API expects pre-tax dollars; tax is re-applied server-side (unless tip baked in).
          amount: linkAmountDollars,
          taxEnabled: linkTaxEnabled,
          taxRatePercent: linkTaxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
          customerName: linkName.trim() || undefined,
          phone: channel === "sms" ? linkPhone.trim() : undefined,
          email: channel === "email" ? linkEmail.trim() : undefined,
          cancelWaitingLinks: waitingLinks.length > 0,
          lineItems: linkLineItems,
          note: linkLineItems
            .map((l) => l.label)
            .join(", ")
            .slice(0, 120),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { url?: string; sent?: boolean; canceledWaiting?: number }
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
      void refreshSentLinks({ sync: false })
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
      className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Charge"
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
          <p className="mt-4 font-mono text-xl font-bold text-emerald-300">{fmt(chargeWithTipCents())}</p>
        </div>
      ) : null}

      <div
        className={cn(
          // Content-height sheet — tip+sign hugs content (no empty full-screen void).
          "flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-zinc-800 bg-[#101018] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-md",
          postPayStep === "tip_sign" || postPayStep === "sign"
            ? "h-auto max-h-[min(88dvh,40rem)]"
            : "max-h-[92dvh]"
        )}
      >
        {/* Mobile drag affordance — matches Just finished / Scheduler sheets. */}
        <div className="flex shrink-0 justify-center pb-0.5 pt-2.5" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-zinc-600/80" />
        </div>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 pb-3 pt-1">
          <div>
            <h2 className="text-base font-bold text-white">
              {postPayStep === "tip_sign"
                ? tipSignSheetTitle(false)
                : postPayStep === "sign"
                  ? postPaySignSheetTitle()
                  : postPayStep === "receipt"
                    ? "Send receipt"
                    : showPaidSummary
                      ? "Payment received"
                      : "Charge"}
            </h2>
            <p className="text-xs text-zinc-500">
              {postPayStep === "tip_sign"
                ? tipLastSheetSubtitle(fmt(paidTotalCents))
                : postPayStep === "sign"
                  ? postPaySignSheetSubtitle()
                  : props.job.customer_name || props.job.customer_phone || "Customer"}
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
          <div className="flex flex-col gap-2.5 overflow-y-auto px-4 py-3">
            <button
              type="button"
              onClick={() => {
                setPostPayStep(null)
                setPaidTotalCents(0)
                setMethod(null)
                setActivePopup(null)
                setClientSecret(null)
                setPublishableKey(null)
                setPaymentIntentId(null)
                setError(null)
              }}
              disabled={busy || tapListening}
              className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to amount
            </button>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-100">Service</p>
                <p className="text-[10px] text-emerald-200/70">
                  Job + tax · pay with{" "}
                  {method === "tap"
                    ? "Tap to Pay"
                    : method === "card"
                      ? "Card"
                      : method === "cash"
                        ? "Cash"
                        : method === "link"
                          ? "Pay link"
                          : "—"}
                </p>
              </div>
              <p className="text-base font-bold tabular-nums text-emerald-300">
                {fmt(paidTotalCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Add a tip
              </p>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
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
                  "mt-1.5 w-full rounded-xl border py-2 text-xs font-semibold transition-colors",
                  tipChoice === "custom"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                    : "border-zinc-700 bg-zinc-900 text-slate-400"
                )}
              >
                Custom tip
              </button>
              {tipChoice === "custom" ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
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
              <p className="mt-1.5 text-xs leading-snug text-emerald-200/90">
                {tipLastTotalNote({
                  totalAmountLabel: fmt(chargeWithTipCents()),
                  tipCents: selectedTipCents(),
                  tipAmountLabel: fmt(selectedTipCents()),
                  baseAmountLabel: fmt(paidTotalCents),
                })}
              </p>
            </div>
            {error && !activePopup ? (
              <p className="text-sm text-red-300">{error}</p>
            ) : null}
            <button
              type="button"
              disabled={busy || tapListening || !method}
              onClick={() => confirmTipAndCharge()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy || tapListening ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : method === "tap" ? (
                <Nfc className="h-4 w-4" aria-hidden />
              ) : method === "card" ? (
                <CreditCard className="h-4 w-4" aria-hidden />
              ) : method === "cash" ? (
                <Banknote className="h-4 w-4" aria-hidden />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden />
              )}
              {method === "link"
                ? `Send pay link · ${fmt(chargeWithTipCents())}`
                : tipLastPrimaryCta({
                    totalAmountLabel: fmt(chargeWithTipCents()),
                    tipCents: selectedTipCents(),
                  })}
            </button>

            {activePopup === "link" ? (
              <NestedPayPopup title="Text / email pay link" onClose={closePayPopup}>
                <p className="text-xs text-emerald-100/90">
                  Texts a short lyncr.app link for {fmt(chargeWithTipCents())}. Customer pays on a
                  branded page — when they finish, the job is marked collected.
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
                {clientSecret && publishableKey && stripeConnectAccountId ? (
                  <Elements
                    key={`${clientSecret}:${stripeConnectAccountId}`}
                    stripe={getStripePromise(publishableKey, stripeConnectAccountId)}
                    options={{
                      clientSecret,
                      appearance: {
                        theme: "night",
                        variables: { colorPrimary: "#6366f1", borderRadius: "10px" },
                      },
                      loader: "auto",
                    }}
                  >
                    <ManualCardForm
                      totalLabel={fmt(chargeWithTipCents())}
                      paymentIntentId={paymentIntentId}
                      lineItems={invoiceLineItemsWithTip(selectedTipCents())}
                      jobId={props.job.id}
                      taxCents={taxCents}
                      stripeConnectAccountId={stripeConnectAccountId}
                      onError={setError}
                      onSuccess={(piId) => {
                        const tipCents = selectedTipCents()
                        const baseCents = paidTotalCents > 0 ? paidTotalCents : totalCents
                        void enterPostPaySignOrReceipt(
                          piId || paymentIntentId,
                          baseCents,
                          "manual_card",
                          tipCents
                        )
                      }}
                      onBack={closePayPopup}
                    />
                  </Elements>
                ) : clientSecret && publishableKey && !stripeConnectAccountId ? (
                  <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    Missing connected Stripe account. Finish Get paid in Settings, then try again.
                  </p>
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
          </div>
        ) : postPayStep === "sign" ? (
          <div className="flex flex-col gap-2.5 overflow-y-auto px-4 py-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-100">Payment received</p>
                <p className="text-[10px] text-emerald-200/70">
                  Optional signature — not required by card networks
                </p>
              </div>
              <p className="text-base font-bold tabular-nums text-emerald-300">
                {fmt(
                  paidTotalCents + (tipResult.kind === "charged" ? tipResult.cents : 0)
                )}
              </p>
            </div>
            {offerOptionalSignature ? (
              <>
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
              </>
            ) : null}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
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
        ) : postPayStep === "receipt" ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            <ChargeResultSummary
              baseCents={paidTotalCents}
              tip={tipResult}
              baseKind={paidPaymentIntentId ? "card" : "cash"}
            />
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
                Cash payment recorded (job + tip in one total).
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
        ) : showPaidSummary && paidLink ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-5 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-emerald-100">
                This job is already paid
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">
                {fmt(paidLink.chargeCents)}
              </p>
              <p className="mt-1 text-xs text-emerald-200/80">
                {paidLink.walletSettled
                  ? "Included in your balance (header total)."
                  : "Marked paid — Refresh if the header still looks low."}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Pay link
              </p>
              <p className="mt-1 break-all text-[11px] text-zinc-400">{paidLink.url}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(paidLink.url)}
                  className="flex-1 rounded-lg border border-zinc-700 py-2 text-xs font-semibold text-slate-200"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  disabled={linksSyncing}
                  onClick={() => void refreshSentLinks({ sync: true })}
                  className="flex-1 rounded-lg border border-sky-500/40 py-2 text-xs font-semibold text-sky-200 disabled:opacity-50"
                >
                  {linksSyncing ? "Checking…" : "Refresh status"}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => props.onCompleted()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => setForceNewCharge(true)}
              className="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-slate-400 hover:text-slate-200"
            >
              Collect another payment
            </button>
          </div>
        ) : awaitingLinkStatus ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden />
            <p className="text-sm">Checking payment status…</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {props.showBack && !postPayStep ? (
                <button
                  type="button"
                  onClick={props.onClose}
                  disabled={busy || tapListening || slipBusy}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-40"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>
              ) : null}
              {forceNewCharge && paidLink ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs font-medium text-amber-100">
                    Already paid {fmt(paidLink.chargeCents)}. Starting a new charge.
                  </p>
                  <button
                    type="button"
                    onClick={() => setForceNewCharge(false)}
                    className="mt-1 text-[11px] font-semibold text-amber-200 underline"
                  >
                    Back to paid status
                  </button>
                </div>
              ) : null}

              {/* Open / unpaid pay links — compact while still collecting. */}
              {(linksLoading || sentLinks.length > 0) && !forceNewCharge && (
                <section className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-sky-200">
                      {linksLoading && sentLinks.length === 0
                        ? "Checking links…"
                        : `${sentLinks.length} pay link${sentLinks.length === 1 ? "" : "s"}`}
                    </p>
                    <button
                      type="button"
                      disabled={linksSyncing}
                      onClick={() => void refreshSentLinks({ sync: true })}
                      className="shrink-0 text-[11px] font-semibold text-sky-300 disabled:opacity-50"
                    >
                      {linksSyncing ? "…" : "Refresh"}
                    </button>
                  </div>
                  {sentLinks.length > 0 ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {sentLinks.map((link) => {
                        const paid = link.paymentStatus === "paid" || link.walletSettled
                        const expired = link.paymentStatus === "expired"
                        return (
                          <li
                            key={link.token}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="min-w-0 flex-1 tabular-nums text-sky-100">
                              {fmt(link.chargeCents)}
                              <span
                                className={cn(
                                  "ml-1.5 font-semibold",
                                  paid
                                    ? "text-emerald-300"
                                    : expired
                                      ? "text-zinc-500"
                                      : "text-amber-200/90"
                                )}
                              >
                                {paid ? "Paid" : expired ? "Canceled" : "Waiting"}
                              </span>
                            </span>
                            {!paid && !expired ? (
                              <button
                                type="button"
                                disabled={linkCancelBusy === link.token || busy}
                                onClick={() => void cancelPayLink(link)}
                                className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 disabled:opacity-50"
                              >
                                {linkCancelBusy === link.token ? "…" : "Cancel"}
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                  {waitingLinks.length > 0 ? (
                    <p className="mt-1.5 text-[10px] leading-snug text-sky-200/75">
                      Wrong amount? Cancel the Waiting link, turn Tax on if needed, then send a new
                      link — or send again and choose Replace when asked.
                    </p>
                  ) : null}
                </section>
              )}

              {/* One compact amount card — lines tucked under a short toggle. */}
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
                        ref={amountInputRef}
                        value={amountInput}
                        onChange={(e) => {
                          setAmountEdited(true)
                          setError(null)
                          setAmountInput(e.target.value.replace(/[^\d.]/g, ""))
                        }}
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={busy || activePopup !== null}
                        aria-label="Amount before tax"
                        className={cn(
                          "w-full rounded-lg border bg-zinc-950 py-2 pr-2.5 pl-6 text-right text-xl font-bold tabular-nums text-white outline-none focus:border-emerald-500 disabled:opacity-60",
                          totalCents < 50 ? "border-amber-500/60" : "border-zinc-700"
                        )}
                      />
                    </div>
                  </label>
                  <div className="shrink-0 pb-0.5 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      Total
                    </p>
                    <p className="text-lg font-bold tabular-nums text-emerald-300">{fmt(totalCents)}</p>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-800/80 pt-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={taxEnabled}
                    disabled={busy || activePopup !== null}
                    onClick={() => setTaxEnabled((v) => !v)}
                    className="flex items-center gap-2 text-left disabled:opacity-50"
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
                      Tax{taxEnabled ? ` ${breakdown.ratePercent.toFixed(0)}%` : ""}
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
                      disabled={busy || activePopup !== null}
                      aria-label="Tax rate percent"
                      className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-xs tabular-nums text-white outline-none disabled:opacity-60"
                    />
                  ) : null}
                </div>

                <details className="group mt-2 border-t border-zinc-800/80 pt-2">
                  <summary className="cursor-pointer list-none text-[11px] font-medium text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">
                      Line items ({lines.length}) · edit
                    </span>
                    <span className="hidden group-open:inline">Hide line items</span>
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {lines.map((line) => (
                      <div key={line.id} className="flex items-center gap-1.5">
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
                          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500 disabled:opacity-60"
                        />
                        <div className="relative w-20 shrink-0">
                          <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-xs text-zinc-500">
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
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950 py-1.5 pr-1.5 pl-5 text-right text-xs text-white outline-none focus:border-emerald-500 disabled:opacity-60"
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
                          className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={busy || activePopup !== null}
                      onClick={() => setLines((prev) => [...prev, newLine()])}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" /> Add line
                    </button>
                  </div>
                </details>
              </section>

              <section>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  How to pay
                </p>
                {error && !postPayStep && !activePopup ? (
                  <div className="mb-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5">
                    <p className="text-xs leading-snug text-red-300">{error}</p>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                  <PayOptionButton
                    compact
                    disabled={busy}
                    dimmed={totalCents < 50}
                    onClick={() => enterTipStepWithMethod("tap")}
                    title="Tap to Pay"
                    subtitle="NFC"
                    icon={<Nfc className="h-4 w-4" />}
                  />
                  <PayOptionButton
                    compact
                    disabled={busy}
                    dimmed={totalCents < 50}
                    onClick={() => enterTipStepWithMethod("card")}
                    title="Card"
                    subtitle="Key in · ZIP"
                    icon={<CreditCard className="h-4 w-4" />}
                  />
                  <PayOptionButton
                    compact
                    disabled={busy}
                    dimmed={totalCents < 50}
                    onClick={() => enterTipStepWithMethod("link")}
                    title="Pay link"
                    subtitle="Text / email"
                    icon={<Link2 className="h-4 w-4" />}
                  />
                  <PayOptionButton
                    compact
                    disabled={busy}
                    dimmed={totalCents < 50}
                    onClick={() => enterTipStepWithMethod("cash")}
                    title="Cash"
                    subtitle="Mark paid"
                    icon={<Banknote className="h-4 w-4" />}
                  />
                </div>
                <p className="mt-1.5 text-center text-[10px] text-zinc-500">
                  Tip is last — one charge for job + tip.
                </p>
              </section>
            </div>
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
  /** 2×2 grid cell — shorter than full-width rows. */
  compact?: boolean
  onClick: () => void
}) {
  if (props.compact) {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
        className={cn(
          "flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] disabled:opacity-50",
          props.active
            ? "border-emerald-500/50 bg-emerald-500/15"
            : "border-zinc-700 bg-zinc-800/40 hover:border-zinc-600",
          props.dimmed && !props.disabled && "opacity-70"
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950/60 text-emerald-300">
          {props.icon}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-white">{props.title}</span>
          <span className="block text-[10px] text-zinc-500">{props.subtitle}</span>
        </span>
      </button>
    )
  }

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
  stripeConnectAccountId?: string | null
  onError: (msg: string | null) => void
  onSuccess: (paymentIntentId: string | null) => void
  onBack: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [elementReady, setElementReady] = useState(false)
  // When Stripe.js / Payment Element never mounts — unlock instead of endless Loading…
  const [loadFailed, setLoadFailed] = useState(false)
  // Invalidate in-flight submit so a late Stripe resolve cannot re-stick the spinner.
  const payGenRef = useRef(0)
  const elementReadyRef = useRef(false)

  useEffect(() => {
    elementReadyRef.current = elementReady
  }, [elementReady])

  useEffect(() => {
    props.onError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear once when form mounts
  }, [])

  // Fail visibly if the card iframe never becomes ready (Connect / Safari blockers).
  useEffect(() => {
    if (elementReady || loadFailed) return
    const t = window.setTimeout(() => {
      if (elementReadyRef.current) return
      setLoadFailed(true)
      props.onError(CARD_FORM_LOAD_TIMEOUT_MESSAGE)
    }, ELEMENTS_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once load watchdog
  }, [elementReady, loadFailed])

  // Backup watchdog: clear spinner even if Promise.race never fires (Safari quirks).
  useEffect(() => {
    if (!submitting) return
    const genAtStart = payGenRef.current
    const watchdog = window.setTimeout(() => {
      if (payGenRef.current !== genAtStart) return
      payGenRef.current += 1
      setSubmitting(false)
      props.onError(CARD_CHARGE_TIMEOUT_MESSAGE)
    }, PAYMENT_CONFIRM_TIMEOUT_MS + 1_500)
    return () => window.clearTimeout(watchdog)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm when submitting flips
  }, [submitting])

  function forceCancelCharge() {
    payGenRef.current += 1
    setSubmitting(false)
    props.onError(null)
    props.onBack()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loadFailed) {
      forceCancelCharge()
      return
    }
    if (!stripe || !elements || !elementReady) {
      props.onError("Card form is still loading — wait a second and try again.")
      return
    }
    const gen = ++payGenRef.current
    setSubmitting(true)
    props.onError(null)
    try {
      const { error: submitError } = await withTimeout(
        elements.submit(),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        CARD_CHARGE_TIMEOUT_MESSAGE
      )
      if (payGenRef.current !== gen) return
      if (submitError) {
        props.onError(
          formatStripeCardFailure(submitError, "Check the card details and try again.")
        )
        return
      }
      const { error, paymentIntent } = await withTimeout(
        stripe.confirmPayment({
          elements,
          redirect: "if_required",
          confirmParams: {
            return_url:
              typeof window !== "undefined"
                ? `${window.location.origin}/tech/dashboard`
                : undefined,
          },
        }),
        PAYMENT_CONFIRM_TIMEOUT_MS,
        CARD_CHARGE_TIMEOUT_MESSAGE
      )
      if (payGenRef.current !== gen) return
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
        const res = await fetchWithTimeout(
          "/api/payments/confirm",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              paymentIntentId: piId,
              stripeConnectAccountId: props.stripeConnectAccountId || undefined,
            }),
          },
          PAYMENT_API_TIMEOUT_MS,
          "Card may have charged, but Lyncr confirmation timed out. Check Stripe before retrying."
        )
        if (payGenRef.current !== gen) return
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
      if (payGenRef.current !== gen) return
      props.onSuccess(piId ?? null)
    } catch (err) {
      if (payGenRef.current !== gen) return
      props.onError(formatPaymentCatchError(err, "Card payment failed — try another card."))
    } finally {
      if (payGenRef.current === gen) setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
          Charging
        </p>
        <p className="text-lg font-bold tabular-nums text-emerald-100">{props.totalLabel}</p>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Card details</p>
      <div className="min-h-[12rem] rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
        {!elementReady && !loadFailed ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading card form…
          </div>
        ) : null}
        {!loadFailed ? (
          <PaymentElement
            onReady={() => {
              setElementReady(true)
              setLoadFailed(false)
            }}
            onLoadError={(event) => {
              setLoadFailed(true)
              const raw = event?.error?.message || "Stripe could not show the card form."
              props.onError(`${raw} Go Back and try again, or send a pay link.`)
            }}
            options={{
              layout: "tabs",
              wallets: { applePay: "never", googlePay: "never" },
              // Always collect ZIP for AVS — keyed cards authenticate with postal code, not a signature.
              fields: {
                billingDetails: {
                  address: {
                    postalCode: "always",
                    country: "never",
                  },
                },
              },
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-sm font-semibold text-rose-300">Card form unavailable</p>
            <p className="max-w-xs text-xs leading-snug text-zinc-400">
              Stripe never finished loading. Tap Try again, or send a pay link.
            </p>
          </div>
        )}
      </div>
      {submitting ? (
        <button
          type="button"
          onClick={forceCancelCharge}
          className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm font-semibold text-amber-100"
        >
          Cancel charge — unlock form
        </button>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={forceCancelCharge}
          className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-3 text-sm font-semibold text-zinc-200"
        >
          Back
        </button>
        <button
          type={loadFailed ? "button" : "submit"}
          disabled={!loadFailed && (!stripe || !elements || !elementReady || submitting)}
          onClick={loadFailed ? forceCancelCharge : undefined}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Charging…
            </>
          ) : loadFailed ? (
            "Try again"
          ) : !elementReady ? (
            "Loading…"
          ) : (
            `Pay ${props.totalLabel}`
          )}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">
        If charge hangs on Safari or an in-app browser, go Back and send a pay link instead.
      </p>
    </form>
  )
}
