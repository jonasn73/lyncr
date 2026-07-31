"use client"

// Profile avatar opens Settings; wallet chip shows account balance + period picker.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, Suspense } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChevronDown, CreditCard, LifeBuoy, Loader2, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DASHBOARD_PAGE_HREF } from "@/lib/dashboard-nav"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  CLOSE_HEADER_SETTINGS_EVENT,
  OPEN_GET_PAID_MODAL_EVENT,
  SETTINGS_CHILD_OPEN_EVENTS,
  openGetPaidModal,
} from "@/lib/settings-modals-events"
import { prefetchCollectJobs } from "@/lib/hooks/use-collect-jobs-query"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Keep the wallet chip the same width while $0 → real total hydrates (avoids header collapse). */
const WALLET_AMOUNT_SLOT_CLASS = "flex min-w-[4.75rem] flex-col items-end leading-none"

const HEADER_MONEY_CACHE_KEY = persistedCacheKey("header-money", "balance")

type HeaderMoneyCache = {
  availableCents: number
  todayCents: number
  weekCents: number
  monthCents: number
  allTimeCents: number
  connectReady: boolean
}

function readHeaderMoneyCache(): HeaderMoneyCache | null {
  const cached = readPersistedCache<HeaderMoneyCache>(HEADER_MONEY_CACHE_KEY)
  if (!cached || typeof cached.availableCents !== "number") return null
  return cached
}

/** Last-known wallet for header skeleton / first paint (sessionStorage). */
export function peekHeaderMoneyCache(): HeaderMoneyCache | null {
  return readHeaderMoneyCache()
}

/** Client-safe currency label for the header chip. */
export function formatHeaderMoneyCents(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

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
  const [getPaidOpen, setGetPaidOpen] = useState(false)
  // Lightweight sheet: balance + period collected totals (not the full Collect flow).
  const [moneyOpen, setMoneyOpen] = useState(false)
  // Keep sheets mounted after first open so re-open is instant (chunk already loaded).
  const [collectMounted, setCollectMounted] = useState(false)
  const [getPaidMounted, setGetPaidMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  // Stripe available balance — sync-read session cache so first paint is not a pulse bar.
  const [availableCents, setAvailableCents] = useState<number | null>(() => {
    const cached = readHeaderMoneyCache()
    return cached?.availableCents ?? null
  })
  const [connectReady, setConnectReady] = useState(() => readHeaderMoneyCache()?.connectReady === true)
  // Collected period totals — shown only in the picker, not as the default chip.
  const [todayCents, setTodayCents] = useState(() => readHeaderMoneyCache()?.todayCents ?? 0)
  const [weekCents, setWeekCents] = useState(() => readHeaderMoneyCache()?.weekCents ?? 0)
  const [monthCents, setMonthCents] = useState(() => readHeaderMoneyCache()?.monthCents ?? 0)
  const [allTimeCents, setAllTimeCents] = useState(() => readHeaderMoneyCache()?.allTimeCents ?? 0)
  const amountReady = availableCents != null
  const isMobile = useIsMobile()

  // SSR hydration: lazy init was skipped — re-read once before paint.
  useLayoutEffect(() => {
    const cached = readHeaderMoneyCache()
    if (!cached) return
    setAvailableCents((prev) => (prev == null ? cached.availableCents : prev))
    setConnectReady((prev) => prev || cached.connectReady === true)
    setTodayCents((prev) => (prev === 0 ? cached.todayCents ?? 0 : prev))
    setWeekCents((prev) => (prev === 0 ? cached.weekCents ?? 0 : prev))
    setMonthCents((prev) => (prev === 0 ? cached.monthCents ?? 0 : prev))
    setAllTimeCents((prev) => (prev === 0 ? cached.allTimeCents ?? 0 : prev))
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
          data?: { availableCents?: number; ready?: boolean }
        } | null) => {
          const avail = j?.data?.availableCents
          const ready = j?.data?.ready === true
          // Missing Connect → treat as $0 in account (empty / not onboarded).
          const cents = typeof avail === "number" && Number.isFinite(avail) ? avail : 0
          setAvailableCents(cents)
          setConnectReady(ready)
          return { availableCents: cents, connectReady: ready }
        }
      )
      .catch(() => {
        setAvailableCents((prev) => (prev == null ? 0 : prev))
        return null as { availableCents: number; connectReady: boolean } | null
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
          return next
        }
      )
      .catch(() => null)

    void Promise.all([balanceP, collectedP]).then(([bal, col]) => {
      if (!bal && !col) return
      writePersistedCache(HEADER_MONEY_CACHE_KEY, {
        availableCents: bal?.availableCents ?? 0,
        connectReady: bal?.connectReady ?? false,
        todayCents: col?.todayCents ?? 0,
        weekCents: col?.weekCents ?? 0,
        monthCents: col?.monthCents ?? 0,
        allTimeCents: col?.allTimeCents ?? 0,
      } satisfies HeaderMoneyCache)
    })
  }, [])

  useEffect(() => {
    refreshMoney()
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      refreshMoney()
    }, 120_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshMoney()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refreshMoney])

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
    setMoneyOpen(false)
    setCollectMounted(true)
    setCollectOpen(true)
  }, [])

  const balanceLabel =
    availableCents != null ? formatMoneyCents(availableCents) : null

  const periodCents = (id: CollectedPeriod): number => {
    if (id === "today") return todayCents
    if (id === "week") return weekCents
    if (id === "month") return monthCents
    return allTimeCents
  }

  const firstName = name.trim().split(/\s+/)[0] || name

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Account balance (ready to pay out). Tap → period collected totals + Collect. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openMoneyPicker}
          onPointerEnter={() => prefetchCollectJobs()}
          className="h-9 shrink-0 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 text-emerald-200 shadow-sm hover:bg-emerald-500/20 hover:text-emerald-100 focus-visible:text-emerald-100"
          aria-label={
            balanceLabel
              ? `In account ${balanceLabel}. Tap for collected totals or Collect payment.`
              : "In account — loading balance"
          }
          title={
            balanceLabel
              ? `In account ${balanceLabel} — tap for collected this week / month`
              : "Loading account balance"
          }
        >
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
          <span className={WALLET_AMOUNT_SLOT_CLASS}>
            {balanceLabel && amountReady ? (
              <span className="text-xs font-bold tabular-nums" suppressHydrationWarning>
                {balanceLabel}
              </span>
            ) : (
              // Reserved width only — never pulse bars that look like broken "...." data.
              <span className="inline-block h-3 w-14" aria-hidden />
            )}
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300/70">
              in account
            </span>
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

      {/* Balance + collected-period chooser (tap the header chip). */}
      <Sheet open={moneyOpen} onOpenChange={setMoneyOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-zinc-800 bg-[#101018] p-0"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
            <SheetTitle className="text-base text-slate-100">Money</SheetTitle>
            <p className="text-xs text-slate-500">
              Collected is what customers paid (sales). Bank transfers are usually less — Lyncr
              takes 2.9% + $0.30 per card payment, and cash never goes through Get paid.
            </p>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/70">
                In account
              </p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-100">
                {availableCents != null ? formatMoneyCents(availableCents) : "—"}
              </p>
              <p className="mt-1 text-xs text-emerald-200/60">
                {connectReady
                  ? "Card money ready to send to your bank (after fees). Goes to $0 after you transfer."
                  : "Finish Get paid setup to hold and transfer card payments."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMoneyOpen(false)
                  openGetPaidModal()
                }}
                className="mt-2 text-xs font-semibold text-emerald-300 underline-offset-2 hover:underline"
              >
                {connectReady ? "Transfer to bank (Get paid)" : "Set up Get paid"}
              </button>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Collected (sales total)
              </p>
              <p className="mb-2 text-[11px] leading-snug text-slate-500">
                Not the same as bank deposits — this is the full amount customers paid.
              </p>
              <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
                {PERIOD_OPTIONS.map((opt) => (
                  <li
                    key={opt.id}
                    className="flex items-center justify-between gap-3 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">{opt.label}</p>
                      <p className="text-[11px] text-slate-500">{opt.hint}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-200">
                      {formatMoneyCents(periodCents(opt.id))}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <Button
              type="button"
              onClick={openCollect}
              className="h-11 w-full bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Collect payment
            </Button>
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
            onOpenChange={setCollectOpen}
            onCollected={refreshMoney}
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
