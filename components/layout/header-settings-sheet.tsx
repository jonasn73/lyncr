"use client"

// Profile avatar opens Settings; wallet chip opens Collect Payment.

import { memo, useCallback, useEffect, useState, Suspense } from "react"
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
} from "@/lib/settings-modals-events"
import { prefetchCollectJobs } from "@/lib/hooks/use-collect-jobs-query"
import { useToast } from "@/hooks/use-toast"
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"

/** Keep the wallet chip the same width while $0 → real total hydrates (avoids header collapse). */
const WALLET_AMOUNT_SLOT_CLASS = "flex min-w-[4.75rem] flex-col items-end leading-none"

const COLLECTED_SUMMARY_CACHE_KEY = persistedCacheKey("collected-summary", "header")

type CollectedHeaderCache = { todayCents: number; monthCents: number }

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

/** Client-safe currency label for the header chip. */
function formatCollectedDollars(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

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
  // Keep sheets mounted after first open so re-open is instant (chunk already loaded).
  const [collectMounted, setCollectMounted] = useState(false)
  const [getPaidMounted, setGetPaidMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  // Live totals from API only (session seeds disabled — React #185).
  const [liveTodayCents, setLiveTodayCents] = useState<number | null>(null)
  const [liveMonthCents, setLiveMonthCents] = useState<number | null>(null)
  const todayCents = liveTodayCents
  const monthCents = liveMonthCents
  // Prefer last-known cached total over an empty skeleton on refresh.
  const amountReady = todayCents != null || monthCents != null
  const isMobile = useIsMobile()

  const refreshCollected = useCallback(() => {
    fetch("/api/owner/collected", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { todayCents?: number; monthCents?: number } } | null) => {
        const today = j?.data?.todayCents
        const month = j?.data?.monthCents
        if (typeof today !== "number" || typeof month !== "number") {
          return
        }
        setLiveTodayCents(today)
        setLiveMonthCents(month)
        writePersistedCache(COLLECTED_SUMMARY_CACHE_KEY, {
          todayCents: today,
          monthCents: month,
        } satisfies CollectedHeaderCache)
      })
      .catch(() => {
        /* keep last-known cache / live values */
      })
  }, [])

  useEffect(() => {
    refreshCollected()
    // Refresh when visible; skip background polls that pile up while phone is locked.
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      refreshCollected()
    }, 120_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCollected()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refreshCollected])

  // Collect jobs warm on wallet chip hover (onPointerEnter below) — not on every dashboard load.

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

  const openCollect = useCallback(() => {
    setCollectMounted(true)
    setCollectOpen(true)
  }, [])

  // Month-to-date on the chip so yesterday’s take doesn’t “vanish” at midnight.
  const monthLabel =
    monthCents != null || todayCents != null
      ? formatCollectedDollars(monthCents ?? todayCents ?? 0)
      : null
  const todayLabel = formatCollectedDollars(todayCents ?? 0)

  const firstName = name.trim().split(/\s+/)[0] || name

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Collect — month total (primary) + today’s take (caption). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openCollect}
          onPointerEnter={() => prefetchCollectJobs()}
          // Keep teal amount readable on dark theme — outline variant's hover:text-accent-foreground is dark.
          className="h-9 shrink-0 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 text-emerald-200 shadow-sm hover:bg-emerald-500/20 hover:text-emerald-100 focus-visible:text-emerald-100"
          aria-label={
            monthLabel
              ? `Collect payment — ${monthLabel} this month, ${todayLabel} today. Open for history.`
              : "Collect payment — loading month total"
          }
          title={monthLabel ? `This month ${monthLabel} · Today ${todayLabel}` : "Loading month total"}
        >
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
          <span className={WALLET_AMOUNT_SLOT_CLASS}>
            {monthLabel && amountReady ? (
              <span className="text-xs font-bold tabular-nums">{monthLabel}</span>
            ) : (
              <span
                className="inline-block h-3 w-14 animate-pulse rounded bg-emerald-500/25"
                aria-hidden
              />
            )}
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300/70">
              month
            </span>
          </span>
        </Button>

        {/* Account / Settings — avatar (+ name on larger screens), no dollar amount. */}
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          // Explicit hover surface: muted (not primary/accent teal). Initials stay
          // text-primary on a dark muted chip — never teal-on-teal or dark-on-dark.
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
            onCollected={refreshCollected}
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
                // Light label on slightly lifted slate — avoid accent (was dark-on-teal).
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
