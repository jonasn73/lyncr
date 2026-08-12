"use client"

// Profile avatar opens Settings; wallet chip shows account balance + period picker.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, Suspense } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChevronDown, CreditCard, LifeBuoy, Loader2, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DASHBOARD_PAGE_HREF } from "@/lib/dashboard-nav"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  CLOSE_HEADER_SETTINGS_EVENT,
  OPEN_COLLECT_PAYMENT_MODAL_EVENT,
  OPEN_GET_PAID_MODAL_EVENT,
  REFRESH_HEADER_MONEY_EVENT,
  SETTINGS_CHILD_OPEN_EVENTS,
  openGetPaidModal,
  type CollectPaymentModalOpenDetail,
} from "@/lib/settings-modals-events"
import { prefetchCollectJobs } from "@/lib/hooks/use-collect-jobs-query"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  estimateLyncrNetFromGrossCents,
  formatHeaderMoneyCents,
  readHeaderMoneyCache,
  resolveHeaderWalletChipDisplay,
  writeHeaderMoneyCache,
  type HeaderMoneyCache,
} from "@/lib/header-money-cache"

/** Keep the wallet chip the same width while $0 → real total hydrates (avoids header collapse). */
const WALLET_AMOUNT_SLOT_CLASS = "flex min-w-[5.25rem] items-center justify-end leading-none"

/**
 * Last-known wallet for header skeleton / first paint.
 * Prefer passing paint from useDashboardPaintSeeds() when inside the shell.
 */
export function peekHeaderMoneyCache(paint?: HeaderMoneyCache | null): HeaderMoneyCache | null {
  return readHeaderMoneyCache(undefined, paint)
}

export { formatHeaderMoneyCents }

function formatMoneyCents(cents: number): string {
  return formatHeaderMoneyCents(cents)
}

type CollectedPeriod = "today" | "week" | "month" | "all"

const PERIOD_OPTIONS: { id: CollectedPeriod; label: string; hint: string }[] = [
  { id: "today", label: "Today", hint: "Collected since midnight" },
  { id: "week", label: "This week", hint: "Monday through today" },
  { id: "month", label: "This month", hint: "From the 1st through today" },
  { id: "all", label: "All time", hint: "Every settled charge" },
]

// Heavy Stripe bundles — load only when Collect / Get paid actually open.
const OwnerCollectPaymentSheet = dynamic(
  () =>
    import("@/components/dashboard/owner-collect-payment-sheet").then((m) => ({
      default: m.OwnerCollectPaymentSheet,
    })),
  { ssr: false }
)

const GetPaidSheet = dynamic(
  () =>
    import("@/components/dashboard/get-paid-sheet").then((m) => ({
      default: m.GetPaidSheet,
    })),
  { ssr: false }
)

const MoneyPaymentsSheet = dynamic(
  () =>
    import("@/components/dashboard/money-payments-sheet").then((m) => ({
      default: m.MoneyPaymentsSheet,
    })),
  { ssr: false }
)

const SettingsWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: m.SettingsWorkspaceView,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        Loading settings…
      </div>
    ),
  }
)

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const HeaderAccountMenu = memo(function HeaderAccountMenu({
  name,
  email,
}: {
  name: string
  email: string
}) {
  const [open, setOpen] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)
  /** Optional CRM / deep-link prefill for Collect (name, phone, start on Add charge). */
  const [collectPrefill, setCollectPrefill] = useState<CollectPaymentModalOpenDetail | null>(null)
  const [getPaidOpen, setGetPaidOpen] = useState(false)
  // Lightweight sheet: balance + period collected totals (not the full Collect flow).
  const [moneyOpen, setMoneyOpen] = useState(false)
  // Money → View all payments (search + detail + send invoice).
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [paymentsInitialTab, setPaymentsInitialTab] = useState<"payments" | "invoices">(
    "payments"
  )
  // Keep sheets mounted after first open so re-open is instant (chunk already loaded).
  const [collectMounted, setCollectMounted] = useState(false)
  const [getPaidMounted, setGetPaidMounted] = useState(false)
  const [paymentsMounted, setPaymentsMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  // Cookie-backed seeds from layout — available on SSR first paint.
  const paintSeeds = useDashboardPaintSeeds()
  const moneyPaint = paintSeeds.money

  // Stripe available balance — sync-read session/cookie seed so first paint is not a pulse bar.
  const [availableCents, setAvailableCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached?.availableCents ?? null
  })
  // Funds Stripe still holds before they become transferable (often 1–2 days after a card pay).
  const [pendingCents, setPendingCents] = useState<number>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached?.pendingCents ?? 0
  })
  const [connectReady, setConnectReady] = useState(
    () => readHeaderMoneyCache(undefined, moneyPaint)?.connectReady === true
  )
  // Collected period totals — null until a real cache/fetch (never paint fake $0).
  const [todayCents, setTodayCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached ? cached.todayCents : null
  })
  const [weekCents, setWeekCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached ? cached.weekCents : null
  })
  const [monthCents, setMonthCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached ? cached.monthCents : null
  })
  const [allTimeCents, setAllTimeCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached ? cached.allTimeCents : null
  })
  const [periodsReady, setPeriodsReady] = useState(
    () => readHeaderMoneyCache(undefined, moneyPaint) != null
  )
  // Chip can show Today from collected periods even while Stripe balance is still loading.
  const amountReady = availableCents != null || (periodsReady && todayCents != null)
  // Quiet “Get paid” details — collapsed unless they already have transferable cash.
  const [getPaidDetailsOpen, setGetPaidDetailsOpen] = useState(false)
  const isMobile = useIsMobile()

  // SSR hydration: re-read session/cookie once before paint (org/key lag).
  useLayoutEffect(() => {
    // No paint arg — allow sessionStorage upgrade after hydrate (safe; HTML already matched).
    const cached = readHeaderMoneyCache()
    if (!cached) return
    setAvailableCents((prev) => (prev == null ? cached.availableCents : prev))
    setPendingCents((prev) => (prev === 0 && cached.pendingCents ? cached.pendingCents : prev))
    setConnectReady((prev) => prev || cached.connectReady === true)
    setTodayCents((prev) => (prev == null ? cached.todayCents : prev))
    setWeekCents((prev) => (prev == null ? cached.weekCents : prev))
    setMonthCents((prev) => (prev == null ? cached.monthCents : prev))
    setAllTimeCents((prev) => (prev == null ? cached.allTimeCents : prev))
    setPeriodsReady(true)
    // moneyPaint is stable per layout; do not depend on object identity (#185).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshMoney = useCallback(() => {
    // Balance (Stripe Connect) + collected periods in parallel.
    const balanceP = fetch("/api/payments/connect/status", {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          data?: { availableCents?: number; pendingCents?: number; ready?: boolean }
        } | null) => {
          const avail = j?.data?.availableCents
          const pend = j?.data?.pendingCents
          const ready = j?.data?.ready === true
          // Missing Connect → treat as $0 in account (empty / not onboarded).
          const cents = typeof avail === "number" && Number.isFinite(avail) ? avail : 0
          const pending = typeof pend === "number" && Number.isFinite(pend) ? pend : 0
          setAvailableCents(cents)
          setPendingCents(pending)
          setConnectReady(ready)
          return { availableCents: cents, pendingCents: pending, connectReady: ready }
        }
      )
      .catch(() => {
        setAvailableCents((prev) => (prev == null ? 0 : prev))
        return null as {
          availableCents: number
          pendingCents: number
          connectReady: boolean
        } | null
      })

    const collectedP = fetch("/api/owner/collected", {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          data?: {
            todayCents?: number
            weekCents?: number
            monthCents?: number
            allTimeCents?: number
          }
        } | null) => {
          const today = j?.data?.todayCents
          const week = j?.data?.weekCents
          const month = j?.data?.monthCents
          const all = j?.data?.allTimeCents
          if (typeof today !== "number" || typeof month !== "number") return null
          const next = {
            todayCents: today,
            weekCents: typeof week === "number" ? week : 0,
            monthCents: month,
            allTimeCents: typeof all === "number" ? all : 0,
          }
          setTodayCents(next.todayCents)
          setWeekCents(next.weekCents)
          setMonthCents(next.monthCents)
          setAllTimeCents(next.allTimeCents)
          setPeriodsReady(true)
          return next
        }
      )
      .catch(() => null)

    void Promise.all([balanceP, collectedP]).then(([bal, col]) => {
      if (!bal && !col) return
      // Merge — never wipe seeded periods when only balance returns (or vice versa).
      const prev = readHeaderMoneyCache(undefined, moneyPaint)
      writeHeaderMoneyCache({
        availableCents: bal?.availableCents ?? prev?.availableCents ?? 0,
        pendingCents: bal?.pendingCents ?? prev?.pendingCents ?? 0,
        connectReady: bal?.connectReady ?? prev?.connectReady ?? false,
        todayCents: col?.todayCents ?? prev?.todayCents ?? 0,
        weekCents: col?.weekCents ?? prev?.weekCents ?? 0,
        monthCents: col?.monthCents ?? prev?.monthCents ?? 0,
        allTimeCents: col?.allTimeCents ?? prev?.allTimeCents ?? 0,
      })
    })
    // moneyPaint is request-stable; omit from deps (#185).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshMoney()
    // When money is still clearing (Pending > 0), poll more often so the chip updates sooner.
    const intervalMs = pendingCents > 0 ? 45_000 : 120_000
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      refreshMoney()
    }, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshMoney()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refreshMoney, pendingCents])

  // After Get paid closes (e.g. bank transfer), refresh so the chip drops.
  const wasGetPaidOpen = useRef(false)
  useEffect(() => {
    if (wasGetPaidOpen.current && !getPaidOpen) {
      refreshMoney()
    }
    wasGetPaidOpen.current = getPaidOpen
  }, [getPaidOpen, refreshMoney])

  // Child Settings screens open as dialogs/sheets — close this sheet so they are not tucked under.
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(CLOSE_HEADER_SETTINGS_EVENT, close)
    for (const event of SETTINGS_CHILD_OPEN_EVENTS) {
      window.addEventListener(event, close)
    }
    return () => {
      window.removeEventListener(CLOSE_HEADER_SETTINGS_EVENT, close)
      for (const event of SETTINGS_CHILD_OPEN_EVENTS) {
        window.removeEventListener(event, close)
      }
    }
  }, [])

  // Collect → Open Get paid (and Settings → Get paid) always opens from this header tree.
  useEffect(() => {
    const openGetPaid = () => {
      setCollectOpen(false)
      setMoneyOpen(false)
      setOpen(false)
      setGetPaidMounted(true)
      setGetPaidOpen(true)
    }
    window.addEventListener(OPEN_GET_PAID_MODAL_EVENT, openGetPaid)
    return () => window.removeEventListener(OPEN_GET_PAID_MODAL_EVENT, openGetPaid)
  }, [])

  // Collect can open from Money / Get paid / CRM (optional name+phone prefill).
  useEffect(() => {
    const openCollectFromEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<CollectPaymentModalOpenDetail>).detail
      setCollectPrefill(detail && typeof detail === "object" ? detail : null)
      setMoneyOpen(false)
      setOpen(false)
      setCollectMounted(true)
      setCollectOpen(true)
    }
    window.addEventListener(OPEN_COLLECT_PAYMENT_MODAL_EVENT, openCollectFromEvent)
    return () => window.removeEventListener(OPEN_COLLECT_PAYMENT_MODAL_EVENT, openCollectFromEvent)
  }, [])

  // After a pay-link / card settles, Latest asks the chip to refresh Available + Pending.
  useEffect(() => {
    const onRefresh = () => refreshMoney()
    window.addEventListener(REFRESH_HEADER_MONEY_EVENT, onRefresh)
    return () => window.removeEventListener(REFRESH_HEADER_MONEY_EVENT, onRefresh)
  }, [refreshMoney])

  // Return from hosted Stripe onboarding: /dashboard?tab=get-paid&connect=return
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get("tab")
      const connect = params.get("connect")
      if (tab === "get-paid" || tab === "payouts" || connect === "return" || connect === "refresh") {
        setGetPaidMounted(true)
        setGetPaidOpen(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const openMoneyPicker = useCallback(() => {
    setMoneyOpen(true)
    refreshMoney()
  }, [refreshMoney])

  const openCollect = useCallback(() => {
    setCollectPrefill(null)
    setMoneyOpen(false)
    setCollectMounted(true)
    setCollectOpen(true)
  }, [])

  const openPayments = useCallback(() => {
    setMoneyOpen(false)
    setPaymentsInitialTab("payments")
    setPaymentsMounted(true)
    setPaymentsOpen(true)
  }, [])

  const openInvoices = useCallback(() => {
    setMoneyOpen(false)
    setPaymentsInitialTab("invoices")
    setPaymentsMounted(true)
    setPaymentsOpen(true)
  }, [])

  // Daily glance chip — Today → Available → Pending → $0 (never lie that wallet is empty).
  const chipDisplay = amountReady
    ? resolveHeaderWalletChipDisplay(availableCents ?? 0, pendingCents, todayCents)
    : null
  const chipAmountLabel = chipDisplay ? formatMoneyCents(chipDisplay.amountCents) : null

  const periodCents = (id: CollectedPeriod): number | null => {
    if (!periodsReady) return null
    if (id === "today") return todayCents
    if (id === "week") return weekCents
    if (id === "month") return monthCents
    return allTimeCents
  }

  // Rough “your cut” for today’s sales (one-charge fee estimate — beginner-friendly).
  const todayNetCents =
    periodsReady && todayCents != null && todayCents > 0
      ? estimateLyncrNetFromGrossCents(todayCents)
      : null

  const firstName = name.trim().split(/\s+/)[0] || name

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Wallet chip: today’s collected first. Tap → Money sheet. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openMoneyPicker}
          onPointerEnter={() => prefetchCollectJobs()}
          className="h-9 shrink-0 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 text-emerald-200 shadow-sm hover:bg-emerald-500/20 hover:text-emerald-100 focus-visible:text-emerald-100"
          aria-label={
            chipAmountLabel
              ? `Wallet ${chipAmountLabel}. Tap for today’s sales, fees, and bank transfer.`
              : "Wallet — loading balance"
          }
          title={
            chipAmountLabel
              ? `${chipAmountLabel} — tap for details`
              : "Loading account balance"
          }
        >
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
          <span className={WALLET_AMOUNT_SLOT_CLASS}>
            {chipAmountLabel && amountReady ? (
              <span className="text-xs font-bold tabular-nums" suppressHydrationWarning>
                {chipAmountLabel}
              </span>
            ) : (
              // Reserved width only — never pulse bars that look like broken "...." data.
              <span className="inline-block h-3 w-14" aria-hidden />
            )}
          </span>
        </Button>

        {/* Account / Settings — avatar (+ name on larger screens), no dollar amount. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className={cn(
            "group h-9 shrink-0 gap-1.5 border-border/80 bg-card/80 px-1.5 text-foreground shadow-sm",
            "hover:bg-muted hover:text-foreground",
            "focus-visible:bg-muted focus-visible:text-foreground",
            "active:bg-muted/80 active:text-foreground",
            "sm:max-w-[11rem] sm:gap-2 sm:px-2"
          )}
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback
              className={cn(
                "bg-primary/15 text-[11px] font-semibold text-primary",
                "group-hover:bg-primary/20 group-hover:text-primary",
                "group-focus-visible:bg-primary/20 group-focus-visible:text-primary",
                "group-active:text-primary"
              )}
            >
              {initialsFromName(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 truncate text-xs font-medium text-foreground group-hover:text-foreground group-focus-visible:text-foreground sm:inline">
            {firstName}
          </span>
          <ChevronDown
            className="hidden h-4 w-4 shrink-0 text-muted-foreground group-hover:text-muted-foreground group-focus-visible:text-muted-foreground sm:block"
            aria-hidden
          />
        </Button>
      </div>

      {/* Today-first Money sheet (tap the header chip). */}
      <Sheet open={moneyOpen} onOpenChange={setMoneyOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-zinc-800 bg-[#101018] p-0"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
            <SheetTitle className="text-base text-slate-100">Money</SheetTitle>
            <p className="hidden text-xs text-slate-500 md:block">
              See what customers paid today, then transfer when you are ready.
            </p>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            {/* Section 1 — Today (hero): what you ran / getting paid */}
            <div className="rounded-xl border border-teal-500/25 bg-teal-500/10 px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-200/70">
                Customers paid today
              </p>
              <p className="mt-0.5 text-3xl font-bold tabular-nums text-teal-50">
                {periodsReady && todayCents != null ? formatMoneyCents(todayCents) : "—"}
              </p>

              {todayNetCents != null ? (
                <div className="mt-3 border-t border-teal-500/20 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-200/60">
                    Your cut after Lyncr fees
                  </p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-teal-100">
                    ~{formatMoneyCents(todayNetCents)}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-teal-200/55">
                    Lyncr takes about 2.9% + $0.30 per card payment. Cash stays with you — it does
                    not go through Get paid.
                  </p>
                </div>
              ) : null}

              <p className="mt-3 text-[11px] leading-snug text-teal-200/50">
                {periodsReady && todayCents != null && todayCents > 0
                  ? "Card money is clearing to your bank balance — usually 1–2 days."
                  : "Collect a card payment and it shows up here."}
              </p>
            </div>

            {/* Section 2 — Get paid (quiet / collapsed): Available vs Pending when withdrawing */}
            <Collapsible open={getPaidDetailsOpen} onOpenChange={setGetPaidDetailsOpen}>
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-zinc-900/60"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-200">Get paid</p>
                      <p className="text-[11px] text-slate-500">
                        Ready to transfer · still clearing
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-slate-500 transition-transform",
                        getPaidDetailsOpen && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 border-t border-zinc-800 px-3.5 pb-3.5 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                          Ready to transfer
                        </p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-200">
                          {availableCents != null ? formatMoneyCents(availableCents) : "—"}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                          Available now
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                          Still clearing
                        </p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-200">
                          {formatMoneyCents(pendingCents)}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                          Usually 1–2 days
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] leading-snug text-slate-500">
                      {connectReady
                        ? "Transfer when you need cash in the bank. Clearing money moves to Ready automatically."
                        : "Finish Get paid setup to hold and transfer card payments."}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setMoneyOpen(false)
                        openGetPaidModal()
                      }}
                      className="text-xs font-semibold text-teal-300 underline-offset-2 hover:underline"
                    >
                      {connectReady ? "Transfer to bank" : "Set up Get paid"}
                    </button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Section 3 — Sales history */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Sales history
                  </p>
                  <p className="hidden text-[11px] leading-snug text-slate-500 md:block">
                    Full amount customers paid — before Lyncr card fees.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openPayments}
                  className="shrink-0 text-xs font-semibold text-teal-300 underline-offset-2 hover:underline"
                >
                  View all payments
                </button>
              </div>
              <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
                {PERIOD_OPTIONS.map((opt) => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      onClick={openPayments}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-900/50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-100">{opt.label}</p>
                        <p className="text-[11px] text-slate-500">{opt.hint}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-200">
                        {periodCents(opt.id) != null
                          ? formatMoneyCents(periodCents(opt.id)!)
                          : "—"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                Tap a total or{" "}
                <button
                  type="button"
                  onClick={openPayments}
                  className="font-semibold text-teal-300 underline-offset-2 hover:underline"
                >
                  View all payments
                </button>{" "}
                to search charges and send invoices.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                onClick={openPayments}
                variant="outline"
                className="h-11 w-full border-zinc-700 bg-zinc-950/50 text-sm font-semibold text-slate-100 hover:bg-zinc-900 hover:text-white"
              >
                View all payments
              </Button>
              <Button
                type="button"
                onClick={openInvoices}
                variant="outline"
                className="h-11 w-full border-zinc-700 bg-zinc-950/50 text-sm font-semibold text-slate-100 hover:bg-zinc-900 hover:text-white"
              >
                Invoices
              </Button>
              <Button
                type="button"
                onClick={openCollect}
                className="h-11 w-full bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 sm:col-span-2"
              >
                Collect payment
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {collectMounted ? (
        <Suspense
          fallback={
            collectOpen ? (
              <div className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/50 p-0 sm:items-center">
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden />
                  Opening Collect…
                </div>
              </div>
            ) : null
          }
        >
          <OwnerCollectPaymentSheet
            open={collectOpen}
            onOpenChange={(next) => {
              setCollectOpen(next)
              if (!next) setCollectPrefill(null)
            }}
            onCollected={refreshMoney}
            prefill={collectPrefill}
          />
        </Suspense>
      ) : null}

      {getPaidMounted ? (
        <Suspense
          fallback={
            getPaidOpen ? (
              <div className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/50 sm:items-center">
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden />
                  Opening Get paid…
                </div>
              </div>
            ) : null
          }
        >
          <GetPaidSheet open={getPaidOpen} onOpenChange={setGetPaidOpen} />
        </Suspense>
      ) : null}

      {paymentsMounted ? (
        <Suspense
          fallback={
            paymentsOpen ? (
              <div className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/50 sm:items-center">
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden />
                  Opening payments…
                </div>
              </div>
            ) : null
          }
        >
          <MoneyPaymentsSheet
            open={paymentsOpen}
            onOpenChange={setPaymentsOpen}
            initialTab={paymentsInitialTab}
          />
        </Suspense>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          variant={isMobile ? "default" : "drawer"}
          className={cn(
            WORKSPACE_SHEET_CLASS,
            isMobile
              ? "flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0"
              : "flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md"
          )}
        >
          <SheetHeader className="shrink-0 border-b border-slate-850 px-4 pb-3 pt-4 text-left">
            <div className="flex items-center justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle className="text-base text-slate-100">Settings</SheetTitle>
                <p className="truncate text-xs text-slate-500">{email}</p>
              </div>
              <Link
                href={DASHBOARD_PAGE_HREF.help}
                onClick={() => setOpen(false)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800/80 hover:text-slate-100 focus-visible:bg-slate-800/80 focus-visible:text-slate-100"
              >
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                Help
              </Link>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                  Loading…
                </div>
              }
            >
              <SettingsWorkspaceView embedded />
            </Suspense>
          </div>

          <div className="shrink-0 border-t border-slate-850 px-4 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signOutAndGoToLogin()
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-950/50 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden />
              )}
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
})
