"use client"

// Compact platform admin shell — desktop sidebar + mobile bottom tabs (no duplicate Menu).

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Building2,
  FlaskConical,
  Headphones,
  Home,
  LogOut,
  MessageSquareWarning,
  MoreHorizontal,
  Network,
  Settings,
  Shield,
  SquareKanban,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { Button } from "@/components/ui/button"
import { BrandWordmark } from "@/components/brand-wordmark"

const NAV = [
  { href: "/admin", label: "Home", icon: Home, match: (p: string) => p === "/admin" },
  {
    href: "/admin/businesses",
    label: "Businesses",
    icon: Building2,
    match: (p: string) => p.startsWith("/admin/businesses"),
  },
  {
    href: "/admin/support",
    label: "Support",
    icon: MessageSquareWarning,
    match: (p: string) => p.startsWith("/admin/support"),
  },
  {
    href: "/admin/people",
    label: "People",
    icon: Users,
    match: (p: string) => p.startsWith("/admin/people") || p.startsWith("/admin/receptionists"),
  },
  {
    href: "/admin/network",
    label: "Network",
    icon: Network,
    match: (p: string) => p.startsWith("/admin/network"),
  },
  {
    href: "/admin/payouts",
    label: "Payouts",
    icon: Wallet,
    match: (p: string) => p.startsWith("/admin/payouts") || p.startsWith("/admin/dashboard/operators"),
  },
  {
    href: "/admin/tools",
    label: "Tools",
    icon: FlaskConical,
    match: (p: string) => p.startsWith("/admin/tools") || p.startsWith("/admin/sandbox"),
  },
  {
    href: "/admin/improvements",
    label: "Improvements",
    icon: SquareKanban,
    match: (p: string) => p.startsWith("/admin/improvements"),
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    match: (p: string) => p.startsWith("/admin/settings"),
  },
] as const

// Home + Support on the bar. Businesses lives under More (open it from Home → See all).
const PRIMARY_HREFS = new Set(["/admin", "/admin/support"])
const PRIMARY_NAV = NAV.filter((item) => PRIMARY_HREFS.has(item.href))
const MORE_LINKS = NAV.filter((item) => !PRIMARY_HREFS.has(item.href))

/** Primary mobile bottom tabs — extra pages live under More. */
const MOBILE_TABS = PRIMARY_NAV

function moreIsActive(pathname: string) {
  return MORE_LINKS.some((item) => item.match(pathname))
}

/** Poll unread chat + email + open feedback for the Support tab badge. */
function useAdminSupportPulse() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/admin/support-pulse", { credentials: "include" })
        const json = (await res.json().catch(() => ({}))) as { data?: { attention_count?: number } }
        if (!cancelled && res.ok) setCount(Number(json.data?.attention_count ?? 0))
      } catch {
        // Badge is optional — ignore network blips.
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])
  return count
}

function SupportCountBadge({ count, className }: { count: number; className?: string }) {
  if (count < 1) return null
  return (
    <span
      className={cn(
        "min-w-[1.25rem] rounded-full bg-operator px-2 py-0.5 text-center text-2xs font-semibold leading-none text-operator-foreground",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

function NavLinks({ onNavigate, supportCount = 0 }: { onNavigate?: () => void; supportCount?: number }) {
  const pathname = usePathname() ?? ""
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {PRIMARY_NAV.map((item) => {
        const Icon = item.icon
        const active = item.match(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-operator/25 text-operator ring-1 ring-operator/40"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
            {item.href === "/admin/support" ? <SupportCountBadge count={supportCount} className="ml-auto" /> : null}
          </Link>
        )
      })}
      <p className="mt-3 px-3 text-micro font-semibold uppercase tracking-wide text-muted-foreground">More</p>
      {MORE_LINKS.map((item) => {
        const Icon = item.icon
        const active = item.match(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-operator/25 text-operator ring-1 ring-operator/40"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function MobileBottomTabs({
  moreOpen,
  onMoreToggle,
  supportCount = 0,
}: {
  moreOpen: boolean
  onMoreToggle: () => void
  supportCount?: number
}) {
  const pathname = usePathname() ?? ""
  const moreActive = moreIsActive(pathname) || moreOpen

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[#060a12]/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Admin primary navigation"
    >
      <div className="mx-auto grid max-w-lg grid-cols-3 gap-0.5 px-1 py-2">
        {MOBILE_TABS.map((item) => {
          const Icon = item.icon
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-2 text-center transition-colors",
                active
                  ? "bg-operator/25 text-operator"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              <span className="relative">
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.href === "/admin/support" ? (
                  <SupportCountBadge count={supportCount} className="absolute -right-3 -top-1" />
                ) : null}
              </span>
              <span className="w-full truncate text-2xs font-semibold leading-tight tracking-tight">
                {item.label}
              </span>
            </Link>
          )
        })}
        <button
          type="button"
          aria-label={moreOpen ? "Close more pages" : "More pages"}
          aria-expanded={moreOpen}
          onClick={onMoreToggle}
          className={cn(
            "flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-2 text-center transition-colors",
            moreActive
              ? "bg-operator/25 text-operator"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          )}
        >
          <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden />
          <span className="w-full truncate text-2xs font-semibold leading-tight tracking-tight">More</span>
        </button>
      </div>
    </nav>
  )
}

function MoreSheet({
  open,
  onClose,
  onLogout,
  logoutBusy,
  supportCount = 0,
}: {
  open: boolean
  onClose: () => void
  onLogout: () => void
  logoutBusy: boolean
  supportCount?: number
}) {
  const pathname = usePathname() ?? ""
  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label="Dismiss more menu"
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onClose}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-border bg-[#060a12] shadow-overlay lg:hidden"
        style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
        role="dialog"
        aria-label="More admin pages"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">More</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {MORE_LINKS.map((item) => {
            const Icon = item.icon
            const active = item.match(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-operator/25 text-operator ring-1 ring-operator/40"
                    : "text-foreground hover:bg-muted/80 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span>{item.label}</span>
                  {item.href === "/admin/businesses" ? (
                    <span className="text-2xs font-normal text-muted-foreground">Full shop list</span>
                  ) : null}
                </span>
                {item.href === "/admin/support" ? <SupportCountBadge count={supportCount} className="ml-auto" /> : null}
              </Link>
            )
          })}
      {/* Logout sits last in More */}
          <button
            type="button"
            disabled={logoutBusy}
            onClick={onLogout}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-60"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            Logout
          </button>
        </nav>
      </div>
    </>
  )
}

export function AdminChrome({
  children,
  userName,
  userEmail,
}: {
  children: React.ReactNode
  userName: string
  userEmail: string
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pathname = usePathname() ?? ""
  const supportCount = useAdminSupportPulse()

  // Close overflow sheet when the route changes (e.g. user tapped another bottom tab).
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  return (
    <div
      className="flex min-h-dvh flex-col bg-[#0b1120] text-foreground antialiased lg:flex-row"
      data-sigo-surface="operator"
    >
      {/* Desktop sidebar — full nav */}
      <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-[#060a12] lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-operator">
            <Shield className="h-4 w-4 text-white" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <BrandWordmark size="xs" variant="onDark" />
              <span className="text-micro font-bold uppercase tracking-wider text-operator/90">Admin</span>
            </div>
          </div>
        </div>
        <NavLinks supportCount={supportCount} />
        <div className="mt-auto space-y-2 border-t border-border p-3">
          <p className="truncate text-2xs text-muted-foreground">{userEmail}</p>
          {/* Desktop has no More sheet — keep Logout reachable in the sidebar footer */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="h-9 w-full justify-start gap-2 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              setBusy(true)
              void signOutAndGoToLogin()
            }}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Logout
          </Button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-[#0b1120]/95 px-3 py-2 backdrop-blur-md sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Headphones className="hidden h-4 w-4 text-operator sm:block" aria-hidden />
            <div className="min-w-0">
              {/* Page name lives in the big heading below — don’t repeat “Home” here. */}
              <p className="truncate text-sm font-semibold text-foreground">Lyncr Admin</p>
              <p className="truncate text-2xs text-muted-foreground sm:hidden">{userName}</p>
            </div>
          </div>
          {/* App link stays in the header; Logout moved to More (mobile) / sidebar (desktop) */}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:bg-muted hover:text-foreground">
            <Link href="/dashboard">App</Link>
          </Button>
        </header>

        {/* pb clears fixed mobile bottom tabs + safe area */}
        <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#0b1120_0%,#070b14_100%)] pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
          {children}
        </div>
      </div>

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        logoutBusy={busy}
        supportCount={supportCount}
        onLogout={() => {
          setBusy(true)
          void signOutAndGoToLogin()
        }}
      />
      <MobileBottomTabs
        moreOpen={moreOpen}
        onMoreToggle={() => setMoreOpen((o) => !o)}
        supportCount={supportCount}
      />
    </div>
  )
}
