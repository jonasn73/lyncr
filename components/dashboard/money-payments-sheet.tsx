"use client"

// Money → View all payments: search settled charges, open detail, send receipt/invoice.
// Also: Invoices tab for paid-outside (Venmo/cash) history — search, view, PDF, resend.

import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import {
  collectedChargeWalletLabel,
  collectedChargeWalletStatus,
  formatCollectedDollars,
  type CollectedChargeWalletStatus,
  type OwnerCollectedTransaction,
} from "@/lib/owner-collected"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { estimateLyncrNetFromGrossCents } from "@/lib/header-money-cache"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { RecordInvoicesPanel } from "@/components/dashboard/record-invoices-panel"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { DASHBOARD_PAGE_HREF } from "@/lib/dashboard-nav"
import Link from "next/link"

type View = "list" | "detail" | "invoice"
type ListTab = "payments" | "invoices"

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function methodLabel(method: OwnerCollectedTransaction["paymentMethod"]): string {
  if (method === "TAP_TO_PAY") return "Tap to Pay"
  if (method === "CASH") return "Cash"
  return "Card"
}

function walletStatusClass(status: CollectedChargeWalletStatus): string {
  if (status === "paid") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
  if (status === "failed") return "border-rose-500/35 bg-rose-500/10 text-rose-300"
  return "border-amber-500/35 bg-amber-500/10 text-amber-200"
}

function rowTitle(tx: OwnerCollectedTransaction): string {
  return (
    tx.customerName ||
    (tx.customerPhone ? formatPhoneDisplay(tx.customerPhone) : null) ||
    (tx.jobId ? "Job payment" : "Walk-up charge")
  )
}

export function MoneyPaymentsSheet({
  open,
  onOpenChange,
  /** Open on Invoices tab (Venmo/cash history) instead of card payments. */
  initialTab = "payments",
  /**
   * Optional day filter for the payments list (Money → Yesterday / Today).
   * "all" = no date filter (default search list).
   */
  initialDayFilter = "all",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: ListTab
  initialDayFilter?: "today" | "yesterday" | "week" | "all"
}) {
  const { toast } = useToast()
  const [listTab, setListTab] = useState<ListTab>(initialTab)
  const [dayFilter, setDayFilter] = useState<"today" | "yesterday" | "week" | "all">(initialDayFilter)
  const [view, setView] = useState<View>("list")
  const [rows, setRows] = useState<OwnerCollectedTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [selected, setSelected] = useState<OwnerCollectedTransaction | null>(null)
  /** Remount invoices panel on Refresh so it refetches. */
  const [invoicesTick, setInvoicesTick] = useState(0)

  // Invoice / receipt send form (for already-paid charges = statement of payment).
  const [receiptName, setReceiptName] = useState("")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState("")
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("email")
  const [receiptBusy, setReceiptBusy] = useState(false)

  // Debounce search so we do not hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search.trim()), 280)
    return () => window.clearTimeout(t)
  }, [search])

  // When the sheet opens, honor initialTab + day filter (e.g. Money → Yesterday).
  useEffect(() => {
    if (!open) return
    setListTab(initialTab)
    setDayFilter(initialDayFilter)
  }, [open, initialTab, initialDayFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (debouncedQ) params.set("q", debouncedQ)
      const res = await fetch(`/api/owner/collected/transactions?${params}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as {
        data?: { transactions?: OwnerCollectedTransaction[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Could not load payments")
      let next = Array.isArray(json.data?.transactions) ? json.data!.transactions! : []
      // Client-side Today / Yesterday / Week filter using the phone’s local calendar.
      if (dayFilter === "today" || dayFilter === "yesterday") {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        if (dayFilter === "yesterday") {
          start.setDate(start.getDate() - 1)
        }
        const end = new Date(start)
        end.setDate(end.getDate() + 1)
        next = next.filter((tx) => {
          const t = new Date(tx.createdAt).getTime()
          return t >= start.getTime() && t < end.getTime()
        })
      } else if (dayFilter === "week") {
        // Local Monday 00:00 — matches the "week-to-date" definition used by the Money tile.
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const dayIndex = (start.getDay() + 6) % 7 // Mon=0 .. Sun=6
        start.setDate(start.getDate() - dayIndex)
        next = next.filter((tx) => new Date(tx.createdAt).getTime() >= start.getTime())
      }
      setRows(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payments")
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, dayFilter])

  useEffect(() => {
    if (!open) return
    if (listTab !== "payments") return
    void load()
  }, [open, load, listTab])

  // Reset when the sheet closes so the next open starts on the list.
  useEffect(() => {
    if (open) return
    setView("list")
    setSelected(null)
    setSearch("")
    setDebouncedQ("")
    setReceiptName("")
    setReceiptEmail("")
    setReceiptPhone("")
    setReceiptChannel("email")
    setReceiptBusy(false)
  }, [open])

  function openDetail(tx: OwnerCollectedTransaction) {
    setSelected(tx)
    setView("detail")
  }

  function openInvoice(tx: OwnerCollectedTransaction) {
    setSelected(tx)
    setReceiptName(tx.customerName || "")
    setReceiptPhone(tx.customerPhone || "")
    setReceiptEmail("")
    setReceiptChannel(tx.customerPhone ? "sms" : "email")
    setView("invoice")
  }

  async function sendInvoice() {
    if (!selected?.stripePaymentIntentId) return
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
          paymentIntentId: selected.stripePaymentIntentId,
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
        description: "Customer gets a paid invoice with a view link.",
      })
      setView("detail")
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

  const title =
    view === "invoice"
      ? "Send invoice"
      : view === "detail"
        ? "Payment"
        : "Transactions"

  const subtitle =
    view === "invoice"
      ? "This charge is already paid — send a receipt / invoice summary."
      : view === "detail"
        ? "Amount, method, and invoice options."
        : listTab === "invoices"
          ? "Venmo and cash invoices you recorded."
          : "Card and Tap charges."

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        overlayClassName="z-[7000]"
        // Same size on Cards and Invoices — don't hug 1 invoice into a tiny sheet.
        className="z-[7010] !h-[88dvh] !max-h-[88dvh] w-full max-w-none flex-col gap-0 rounded-t-2xl border-zinc-800 bg-[#101018] p-0"
      >
        <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {view !== "list" ? (
                <button
                  type="button"
                  onClick={() => setView(view === "invoice" ? "detail" : "list")}
                  className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-300/90 hover:text-teal-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Back
                </button>
              ) : null}
              <SheetTitle className="text-base font-bold text-slate-100">{title}</SheetTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-2 text-muted-foreground hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {view === "list" ? (
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
              <button
                type="button"
                onClick={() => setListTab("payments")}
                className={cn(
                  "rounded-lg py-2 text-xs font-semibold",
                  listTab === "payments"
                    ? "bg-teal-500/20 text-teal-100"
                    : "text-muted-foreground hover:text-slate-200"
                )}
              >
                Cards
              </button>
              <button
                type="button"
                onClick={() => setListTab("invoices")}
                className={cn(
                  "rounded-lg py-2 text-xs font-semibold",
                  listTab === "invoices"
                    ? "bg-teal-500/20 text-teal-100"
                    : "text-muted-foreground hover:text-slate-200"
                )}
              >
                Invoices
              </button>
            </div>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {view === "list" ? (
            <div className="space-y-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or phone"
                  className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 pl-10 pr-3 text-sm text-slate-100 placeholder:text-muted-foreground outline-none focus:border-teal-500/40"
                  autoComplete="off"
                  enterKeyHint="search"
                />
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
                {(
                  [
                    { id: "today" as const, label: "Today" },
                    { id: "yesterday" as const, label: "Yesterday" },
                    { id: "week" as const, label: "Week" },
                    { id: "all" as const, label: "All" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDayFilter(opt.id)}
                    className={cn(
                      "rounded-lg py-2 text-[11px] font-semibold",
                      dayFilter === opt.id
                        ? "bg-teal-500/20 text-teal-100"
                        : "text-muted-foreground hover:text-slate-200"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 px-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {listTab === "invoices"
                    ? debouncedQ
                      ? "Matching invoices"
                      : dayFilter === "today"
                        ? "Today’s invoices"
                        : dayFilter === "yesterday"
                          ? "Yesterday’s invoices"
                          : dayFilter === "week"
                            ? "This week’s invoices"
                            : "Invoices"
                    : debouncedQ
                      ? "Matching charges"
                      : dayFilter === "today"
                        ? "Today’s charges"
                        : dayFilter === "yesterday"
                          ? "Yesterday’s charges"
                          : dayFilter === "week"
                            ? "This week’s charges"
                            : "Charges"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (listTab === "invoices") setInvoicesTick((n) => n + 1)
                    else void load()
                  }}
                  disabled={listTab === "payments" && loading}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-teal-300/90 hover:bg-teal-500/10 disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      listTab === "payments" && loading && "animate-spin"
                    )}
                    aria-hidden
                  />
                  Refresh
                </button>
              </div>

              {listTab === "invoices" ? (
                <RecordInvoicesPanel
                  key={invoicesTick}
                  showSearch={false}
                  showToolbar={false}
                  externalSearch={debouncedQ}
                  dayFilter={dayFilter}
                />
              ) : loading && rows.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading payments…
                </div>
              ) : error ? (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-4 text-center text-sm text-rose-200">
                  {error}
                </p>
              ) : rows.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-300">
                    {debouncedQ ? "No matching payments" : "No payments yet"}
                  </p>
                  <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                    {debouncedQ
                      ? "Try another name or phone, or clear the search."
                      : "When you Collect a card, Tap to Pay, or cash charge, it shows up here."}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {rows.map((tx) => {
                    const walletStatus = collectedChargeWalletStatus(tx)
                    const subtitleParts = [
                      methodLabel(tx.paymentMethod),
                      tx.jobLabel,
                      tx.tipCents && tx.tipCents > 0
                        ? `Tip ${formatCollectedDollars(tx.tipCents)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                    return (
                      <li key={tx.id}>
                        <button
                          type="button"
                          onClick={() => openDetail(tx)}
                          className="flex w-full items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-left transition-colors hover:border-teal-500/40 hover:bg-zinc-900"
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                              walletStatus === "paid"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : walletStatus === "failed"
                                  ? "bg-rose-500/15 text-rose-300"
                                  : "bg-amber-500/15 text-amber-200"
                            )}
                          >
                            <CreditCard className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-slate-100">
                                {rowTitle(tx)}
                              </span>
                              <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-300">
                                {formatCollectedDollars(Math.round(tx.amount * 100))}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {formatWhen(tx.createdAt)}
                              {subtitleParts ? ` · ${subtitleParts}` : ""}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  walletStatusClass(walletStatus)
                                )}
                              >
                                {collectedChargeWalletLabel(walletStatus)}
                              </span>
                              {!tx.jobId ? (
                                <span className="inline-flex rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Quick
                                </span>
                              ) : null}
                              {tx.customerPhone ? (
                                <span className="text-[10px] text-muted-foreground">
                                  {formatPhoneDisplay(tx.customerPhone)}
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
          ) : null}

          {view === "detail" && selected ? (
            <PaymentDetail
              tx={selected}
              onSendInvoice={() => openInvoice(selected)}
              onClose={() => onOpenChange(false)}
            />
          ) : null}

          {view === "invoice" && selected ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-teal-500/25 bg-teal-500/10 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-200/70">
                  Already paid
                </p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-teal-50">
                  {formatCollectedDollars(Math.round(selected.amount * 100))}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-teal-200/60">
                  Sending an invoice here emails or texts a paid receipt (statement of payment) —
                  not a new bill to collect.
                </p>
              </div>

              {!selected.stripePaymentIntentId || selected.status !== "COMPLETED" ? (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                  {selected.paymentMethod === "CASH"
                    ? "Cash charges do not have a card receipt link. Note the amount for your records."
                    : "This charge cannot send a digital invoice yet (missing card payment id or not settled)."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
                    <button
                      type="button"
                      onClick={() => setReceiptChannel("email")}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-semibold transition-colors",
                        receiptChannel === "email"
                          ? "bg-teal-500/20 text-teal-100"
                          : "text-muted-foreground hover:text-slate-200"
                      )}
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptChannel("sms")}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-semibold transition-colors",
                        receiptChannel === "sms"
                          ? "bg-teal-500/20 text-teal-100"
                          : "text-muted-foreground hover:text-slate-200"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                      Text
                    </button>
                  </div>

                  <label className="block space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Customer name
                    </span>
                    <input
                      type="text"
                      value={receiptName}
                      onChange={(e) => setReceiptName(e.target.value)}
                      placeholder="Optional"
                      className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 text-sm text-slate-100 placeholder:text-muted-foreground outline-none focus:border-teal-500/40"
                    />
                  </label>

                  {receiptChannel === "email" ? (
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Email
                      </span>
                      <input
                        type="email"
                        value={receiptEmail}
                        onChange={(e) => setReceiptEmail(e.target.value)}
                        placeholder="customer@email.com"
                        className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 text-sm text-slate-100 placeholder:text-muted-foreground outline-none focus:border-teal-500/40"
                        autoComplete="email"
                      />
                    </label>
                  ) : (
                    <label className="block space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Phone
                      </span>
                      <input
                        type="tel"
                        value={receiptPhone}
                        onChange={(e) => setReceiptPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 text-sm text-slate-100 placeholder:text-muted-foreground outline-none focus:border-teal-500/40"
                        autoComplete="tel"
                      />
                    </label>
                  )}

                  <button
                    type="button"
                    disabled={receiptBusy}
                    onClick={() => void sendInvoice()}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {receiptBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : receiptChannel === "email" ? (
                      <Mail className="h-4 w-4" aria-hidden />
                    ) : (
                      <MessageSquare className="h-4 w-4" aria-hidden />
                    )}
                    {receiptChannel === "email" ? "Email invoice" : "Text invoice"}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function PaymentDetail({
  tx,
  onSendInvoice,
  onClose,
}: {
  tx: OwnerCollectedTransaction
  onSendInvoice: () => void
  onClose: () => void
}) {
  const amountCents = Math.round(tx.amount * 100)
  const canInvoice = tx.status === "COMPLETED" && Boolean(tx.stripePaymentIntentId)
  const feeNet =
    tx.paymentMethod !== "CASH" && tx.status === "COMPLETED"
      ? estimateLyncrNetFromGrossCents(amountCents)
      : null

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums text-emerald-200">
          {formatCollectedDollars(amountCents)}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-100">{rowTitle(tx)}</p>
        {tx.customerPhone ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Phone className="h-3 w-3" aria-hidden />
            {formatPhoneDisplay(tx.customerPhone)}
          </p>
        ) : null}
      </div>

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        <DetailRow
          label="Status"
          value={collectedChargeWalletLabel(collectedChargeWalletStatus(tx))}
        />
        <DetailRow label="Method" value={methodLabel(tx.paymentMethod)} />
        <DetailRow label="When" value={formatWhen(tx.createdAt)} />
        {tx.jobLabel ? <DetailRow label="Job" value={tx.jobLabel} /> : null}
        {tx.tipCents != null && tx.tipCents > 0 ? (
          <DetailRow label="Tip" value={formatCollectedDollars(tx.tipCents)} />
        ) : null}
        {tx.hasSignature ? <DetailRow label="Signature" value="On file" /> : null}
        {feeNet != null ? (
          <DetailRow
            label="Your cut (est.)"
            value={`~${formatCollectedDollars(feeNet)} after Lyncr fees`}
          />
        ) : tx.paymentMethod === "CASH" ? (
          <DetailRow label="Fees" value="None — cash stays with you" />
        ) : null}
      </ul>

      {tx.jobId ? (
        <Link
          href={`${DASHBOARD_PAGE_HREF.scheduler}?job=${encodeURIComponent(tx.jobId)}`}
          onClick={onClose}
          className="block rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm font-semibold text-teal-300 hover:border-teal-500/40"
        >
          Open related job
        </Link>
      ) : (
        <p className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-3 text-[11px] leading-snug text-muted-foreground">
          Walk-up / quick charge — not tied to a schedule job. Add the customer name when you send
          the invoice so you can find them later.
        </p>
      )}

      <button
        type="button"
        disabled={!canInvoice}
        onClick={onSendInvoice}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Mail className="h-4 w-4" aria-hidden />
        {canInvoice
          ? "Send invoice / receipt"
          : tx.paymentMethod === "CASH"
            ? "No digital invoice for cash"
            : "Invoice unavailable"}
      </button>
      {canInvoice ? (
        <p className="text-center text-[11px] leading-snug text-muted-foreground">
          Emails or texts a paid invoice page the customer can open.
        </p>
      ) : null}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-slate-200">{value}</span>
    </li>
  )
}
