"use client"

// Profile avatar opens Settings; shows today’s collected $ and a Collect Payment shortcut.

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
import { OwnerCollectPaymentSheet } from "@/components/dashboard/owner-collect-payment-sheet"

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
  const [busy, setBusy] = useState(false)
  const [todayCents, setTodayCents] = useState<number | null>(null)
  const isMobile = useIsMobile()

  const refreshCollected = useCallback(() => {
    fetch("/api/owner/collected", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { todayCents?: number } } | null) => {
        if (typeof j?.data?.todayCents === "number") setTodayCents(j.data.todayCents)
      })
      .catch(() => {
        /* keep last known */
      })
  }, [])

  useEffect(() => {
    refreshCollected()
    const id = window.setInterval(refreshCollected, 60_000)
    return () => window.clearInterval(id)
  }, [refreshCollected])

  const collectedLabel =
    todayCents == null ? "…" : formatCollectedDollars(todayCents)

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* One-tap collect — always visible on phones for on-the-go charging */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCollectOpen(true)}
          className="h-11 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 text-emerald-200 shadow-sm hover:bg-emerald-500/20 sm:h-9"
          aria-label="Collect payment"
          title="Collect payment"
        >
          <CreditCard className="h-4 w-4" aria-hidden />
          <span className="hidden text-xs font-semibold sm:inline">Collect</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className={cn(
            "border-border/80 bg-card/80 shadow-sm",
            // Mobile: auto height so name + $ chip are never clipped by h-11
            "h-auto min-h-11 min-w-[3.25rem] flex-col gap-0.5 overflow-visible px-1.5 py-1",
            // Desktop: wide row with full name + collected line
            "sm:h-9 sm:w-[14rem] sm:max-w-[14rem] sm:flex-row sm:gap-2 sm:overflow-hidden sm:px-2 sm:py-0"
          )}
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
              {initialsFromName(name)}
            </AvatarFallback>
          </Avatar>
          {/* Mobile: short name + collected $ (leading-none so glyphs aren’t cut off) */}
          <span className="flex max-w-[4.5rem] flex-col items-center gap-0.5 sm:hidden">
            <span className="w-full truncate text-center text-[10px] font-medium leading-none text-foreground">
              {name.trim().split(/\s+/)[0] || name}
            </span>
            <span className="inline-flex items-center justify-center rounded-md bg-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums text-emerald-200 ring-1 ring-emerald-400/50">
              {collectedLabel}
            </span>
          </span>
          {/* Desktop: name + amount collected */}
          <span className="hidden min-w-0 flex-1 flex-col items-start text-left sm:flex">
            <span className="w-full truncate text-xs font-medium leading-tight text-foreground">{name}</span>
            <span className="w-full truncate text-[11px] font-bold leading-tight tabular-nums text-emerald-300">
              {todayCents === 0 ? "Collected $0 today" : `${collectedLabel} today`}
            </span>
          </span>
          <ChevronDown className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
        </Button>
      </div>

      <OwnerCollectPaymentSheet
        open={collectOpen}
        onOpenChange={setCollectOpen}
        onCollected={refreshCollected}
      />

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
                <p className="mt-1 text-[11px] font-semibold tabular-nums text-emerald-400">
                  Collected today: {collectedLabel}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setCollectOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden />
                  Collect
                </button>
                <Link
                  href={DASHBOARD_PAGE_HREF.help}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-900"
                >
                  <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                  Help
                </Link>
              </div>
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
