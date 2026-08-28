"use client"

// Profile avatar opens Settings; wallet chip shows account balance + period picker.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, Suspense } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChevronDown, ChevronRight, CreditCard, Landmark, LifeBuoy, Loader2, LogOut, Receipt } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { openOwnerHelpSheet } from "@/lib/owner-help-events"
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
import { SendToBankPanel } from "@/components/dashboard/send-to-bank-panel"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  estimateLyncrNetFromGrossCents,
  formatHeaderMoneyCents,
  readHeaderMoneyCache,
  resolveHeaderWalletChipDisplay,
  writeHeaderMoneyCache,
  type HeaderMoneyCache,
} from "@/lib/header-money-cache"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"

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

type CollectedPeriod = "today" | "yesterday" | "week" | "month" | "all"

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
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
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
  const [paymentsDayFilter, setPaymentsDayFilter] = useState<"today" | "yesterday" | "week" | "all">(
    "all"
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
  const [yesterdayCents, setYesterdayCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache(undefined, moneyPaint)
    return cached ? cached.yesterdayCents : null
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
  // Wallet chip = Stripe balance only (not “sales today”).
  const amountReady = availableCents != null
  // Recent bank transfers — loaded when Money opens.
  const [bankTransfers, setBankTransfers] = useState<
    {
      amountCents: number
      status: string
      createdLabel: string
      arrivalDateLabel: string
    }[]
  >([])
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
    setYesterdayCents((prev) => (prev == null ? cached.yesterdayCents : prev))
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

    const tz = encodeURIComponent(resolveBrowserTimezone())
    const collectedP = fetch(`/api/owner/collected?timezone=${tz}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          data?: {
            todayCents?: number
            yesterdayCents?: number
            weekCents?: number
            monthCents?: number
            allTimeCents?: number
          }
        } | null) => {
          const today = j?.data?.todayCents
          const yesterday = j?.data?.yesterdayCents
          const week = j?.data?.weekCents
          const month = j?.data?.monthCents
          const all = j?.data?.allTimeCents
          if (typeof today !== "number" || typeof month !== "number") return null
          const next = {
            todayCents: today,
            yesterdayCents: typeof yesterday === "number" ? yesterday : 0,
            weekCents: typeof week === "number" ? week : 0,
            monthCents: month,
            allTimeCents: typeof all === "number" ? all : 0,
          }
          setTodayCents(next.todayCents)
          setYesterdayCents(next.yesterdayCents)
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
        yesterdayCents: col?.yesterdayCents ?? prev?.yesterdayCents ?? 0,
        weekCents: col?.weekCents ?? prev?.weekCents ?? 0,
        monthCents: col?.monthCents ?? prev?.monthCents ?? 0,
        allTimeCents: col?.allTimeCents ?? prev?.allTimeCents ?? 0,
      })
    })
    // moneyPaint is request-stable; omit from deps (#185).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Last bank payout when Money opens (answers “where did $ go?”). */
  const refreshMoneyExtras = useCallback(() => {
    void fetch("/api/payments/connect/payouts?limit=3", {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          j: {
            data?: {
              payouts?: {
                amountCents: number
                status: string
                createdLabel: string
                arrivalDateLabel: string
              }[]
            }
          } | null
        ) => {
          setBankTransfers(Array.isArray(j?.data?.payouts) ? j.data!.payouts! : [])
        }
      )
      .catch(() => setBankTransfers([]))
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
    refreshMoneyExtras()
  }, [refreshMoney, refreshMoneyExtras])

  const openCollect = useCallback(() => {
    setCollectPrefill(null)
    setMoneyOpen(false)
    setCollectMounted(true)
    setCollectOpen(true)
  }, [])

  const openPayments = useCallback((day: "today" | "yesterday" | "week" | "all" = "all") => {
    // Keep Money underneath so closing Transactions returns here.
    setPaymentsInitialTab("payments")
    setPaymentsDayFilter(day)
    setPaymentsMounted(true)
    setPaymentsOpen(true)
  }, [])

  const openInvoices = useCallback(() => {
    setPaymentsInitialTab("invoices")
    setPaymentsDayFilter("all")
    setPaymentsMounted(true)
    setPaymentsOpen(true)
  }, [])

  // Wallet chip = Stripe Available (or Pending) — never “sales today”.
  const chipDisplay = amountReady
    ? resolveHeaderWalletChipDisplay(availableCents ?? 0, pendingCents, todayCents)
    : null
  const chipAmountLabel = chipDisplay ? formatMoneyCents(chipDisplay.amountCents) : null

  const periodCents = (id: CollectedPeriod): number | null => {
    if (!periodsReady) return null
    if (id === "today") return todayCents
    if (id === "yesterday") return yesterdayCents
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
      <div className="flex items-center gap-2">
        {/* Wallet chip: Stripe Available (or Pending). Tap → Money sheet. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openMoneyPicker}
          onPointerEnter={() => prefetchCollectJobs()}
          className="h-9 shrink-0 gap-2 border-success/40 bg-success/10 px-3 text-success shadow-resting hover:bg-success/20 hover:text-success focus-visible:text-success"
          aria-label={
            chipAmountLabel && chipDisplay
              ? `Wallet ${chipAmountLabel}. ${chipDisplay.label}. Tap for Money — Collect, bank, or Lyncr bill.`
              : "Wallet — loading balance"
          }
          title={
            chipAmountLabel && chipDisplay
              ? `${chipAmountLabel} · ${chipDisplay.label}`
              : "Loading account balance"
          }
        >
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
          {chipAmountLabel && amountReady && chipDisplay ? (
            <span className="text-xs font-bold tabular-nums" suppressHydrationWarning>
              {chipAmountLabel}
            </span>
          ) : (
            // Reserved width only — never pulse bars that look like broken "...." data.
            <span className="inline-block h-3 w-10" aria-hidden />
          )}
        </Button>

        {/* Account / Settings — avatar (+ name on larger screens), no dollar amount. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className={cn(
            "group h-9 shrink-0 gap-2 border-border/80 bg-card/80 px-2 text-foreground shadow-resting",
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
                "bg-primary/15 text-2xs font-semibold text-primary",
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
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-border bg-[#101018] p-0"
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
            <SheetTitle className="text-base text-foreground">Money</SheetTitle>
            <p className="text-xs text-muted-foreground">
              Collect = charge customers. Bank = your payouts. Lyncr bill = your subscription.
            </p>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            {/* One hero number: ready-to-send if any, else still-clearing */}
            <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-4">
              {(() => {
                const ready = availableCents ?? 0
                const clearing = pendingCents
                const heroIsReady = ready >= 100
                return (
                  <>
                    <p className="text-micro font-semibold uppercase tracking-wide text-success/70">
                      {heroIsReady ? "Ready to send" : clearing > 0 ? "Still clearing" : "In Stripe"}
                    </p>
                    <p className="mt-0.5 text-3xl font-bold tabular-nums text-success">
                      {formatMoneyCents(heroIsReady ? ready : clearing)}
                    </p>
                    <p className="mt-1 text-2xs leading-snug text-success/65">
                      {heroIsReady
                        ? "Tap Send all when you want this in your bank. Lyncr will not auto-transfer."
                        : clearing > 0
                          ? "Customers already paid. Stripe holds it 1–2 days, then Send to bank appears here."
                          : connectReady
                            ? "No card money in the wallet yet. Collect a payment and it shows up here."
                            : "Set up your bank once, then card money can land here."}
                    </p>
                    {heroIsReady && clearing > 0 ? (
                      <p className="mt-2 text-2xs text-success/60">
                        Also still clearing: {formatMoneyCents(clearing)}
                      </p>
                    ) : null}
                    {!heroIsReady && clearing > 0 && ready > 0 ? (
                      <p className="mt-2 text-2xs text-success/60">
                        Ready to send: {formatMoneyCents(ready)} (under $1 — wait for more to clear)
                      </p>
                    ) : null}
                  </>
                )
              })()}
              {connectReady && (availableCents ?? 0) >= 100 ? (
                <SendToBankPanel
                  availableCents={availableCents ?? 0}
                  onSent={() => {
                    refreshMoney()
                    refreshMoneyExtras()
                  }}
                />
              ) : null}
              {!connectReady ? (
                <Button
                  type="button"
                  onClick={() => {
                    setMoneyOpen(false)
                    openGetPaidModal()
                  }}
                  className="mt-3 h-11 w-full bg-success text-sm font-semibold text-success-foreground hover:bg-success"
                >
                  Set up bank for payouts
                </Button>
              ) : null}
              {bankTransfers.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <p className="text-micro font-semibold uppercase tracking-wide text-sky-200/70">
                    Sent to bank
                  </p>
                  {bankTransfers.slice(0, 3).map((p, i) => (
                    <div
                      key={`${p.createdLabel}-${i}`}
                      className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2"
                    >
                      <p className="text-sm font-bold tabular-nums text-sky-50">
                        {formatMoneyCents(p.amountCents)}
                        <span className="ml-1.5 text-micro font-semibold uppercase tracking-wide text-sky-200/70">
                          {p.status.replace(/_/g, " ")}
                        </span>
                      </p>
                      <p className="mt-0.5 text-micro text-sky-100/60">
                        {p.createdLabel}
                        {p.arrivalDateLabel !== "—" ? ` · arrives ${p.arrivalDateLabel}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {connectReady ? (
                <button
                  type="button"
                  onClick={() => {
                    setMoneyOpen(false)
                    openGetPaidModal()
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 text-2xs font-semibold text-success/80 hover:text-success"
                >
                  <Landmark className="h-3.5 w-3.5" aria-hidden />
                  Bank &amp; payouts
                </button>
              ) : null}
            </div>

            {/* Compact sales glance — tap a day to open the transactions popup */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "today" as const, label: "Today" },
                  { id: "yesterday" as const, label: "Yesterday" },
                  { id: "week" as const, label: "This week" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => openPayments(opt.id)}
                  className="rounded-xl border border-border bg-background/60 px-2 py-3 text-center hover:border-teal-500/40 hover:bg-card/70"
                >
                  <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    {opt.label}
                  </p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-success">
                    {periodCents(opt.id) != null ? formatMoneyCents(periodCents(opt.id)!) : "—"}
                  </p>
                </button>
              ))}
            </div>
            {todayNetCents != null ? (
              <p className="text-2xs leading-snug text-muted-foreground">
                Today after Lyncr fees ~{formatMoneyCents(todayNetCents)} (2.9% + $0.30 per card).
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => openPayments("all")}
              className="flex h-11 w-full items-center justify-between rounded-xl border border-border bg-background/70 px-4 text-left hover:border-teal-500/40 hover:bg-card"
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                <Receipt className="h-4 w-4 text-teal-300" aria-hidden />
                Transactions
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>

            {/* Collect = charge the customer (not Lyncr bill, not bank setup). */}
            <Button
              type="button"
              onClick={openCollect}
              className="flex h-auto min-h-12 w-full flex-col items-center justify-center gap-0.5 bg-success px-4 py-3 text-success-foreground hover:bg-success"
            >
              <span className="text-sm font-semibold">Collect from customer</span>
              <span className="text-2xs font-medium text-success/85">
                Charge a job — card, tap, or pay link
              </span>
            </Button>
            {/* Invoices = outside-Lyncr records (Venmo/cash), not card charging. */}
            <Button
              type="button"
              onClick={openInvoices}
              variant="outline"
              className="mt-2 flex h-auto min-h-11 w-full flex-col items-center justify-center gap-0.5 border-border bg-background/50 px-4 py-2 text-foreground hover:bg-card hover:text-white"
            >
              <span className="text-sm font-semibold">Outside payments</span>
              <span className="text-2xs font-medium text-muted-foreground">
                Record Venmo / cash already paid
              </span>
            </Button>
            <Link
              href="/dashboard/pay"
              onClick={() => setMoneyOpen(false)}
              className="mt-2 flex h-auto min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-background/40 px-4 py-2 text-center hover:border-border hover:bg-card/70"
            >
              <span className="text-sm font-semibold text-foreground">Lyncr bill</span>
              <span className="text-2xs font-medium text-muted-foreground">
                Your app subscription — not customer charges
              </span>
            </Link>
          </div>
        </SheetContent>
      </Sheet>

      {collectMounted ? (
        <Suspense
          fallback={
            collectOpen ? (
              <div className="fixed inset-0 z-[7000] flex items-end justify-center bg-black/50 p-0 sm:items-center">
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden />
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
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden />
                  Opening bank setup…
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
                <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-t-2xl bg-[#101018] px-4 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-success" aria-hidden />
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
            initialDayFilter={paymentsDayFilter}
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
          <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
            <div className="flex items-center justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle className="text-base text-foreground">Settings</SheetTitle>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  openOwnerHelpSheet("chat")
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-2xs font-semibold text-foreground hover:bg-muted/80 hover:text-foreground focus-visible:bg-muted/80 focus-visible:text-foreground"
              >
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                Help
              </button>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                  Loading…
                </div>
              }
            >
              <SettingsWorkspaceView embedded />
            </Suspense>
          </div>

          <div className="shrink-0 border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signOutAndGoToLogin()
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-3 text-sm font-semibold text-rose-300 hover:bg-rose-950/50 disabled:opacity-50"
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
