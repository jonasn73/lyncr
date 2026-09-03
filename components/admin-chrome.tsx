"use client"

// Compact platform admin shell — desktop sidebar + mobile bottom tabs (no duplicate Menu).

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Bell,
  Building2,
  FileText,
  Headphones,
  Home,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquareWarning,
  MoreHorizontal,
  Settings,
  Shield,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { BrandWordmark } from "@/components/brand-wordmark"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"

// Home is Finance — money, every business's balance, and the transaction ledger in one
// place. Businesses/Support stay reachable for directory browsing and the full ticket
// queue; Settings is the only other thing left. Everything else (operator workforce
// management, ad-hoc tools, the improvements board) was removed — not finance- or
// business-specific, and unused.
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
  const canPoll = usePollBudget()
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
    if (!canPoll) return
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [canPoll])
  return count
}

const NOTIFICATIONS_SEEN_KEY = "lyncr_admin_notifications_seen"

type AdminNotificationItemRow = {
  id: string
  kind: "pending_shop" | "chat" | "email" | "feedback"
  title: string
  subtitle: string
  timestamp: string
  href: string
}

type AdminNotificationFeedResponse = {
  total_count: number
  items: AdminNotificationItemRow[]
}

/**
 * Poll the unified admin notification feed — pending shop approvals + unread support chat,
 * unread support email, and open in-app feedback — and toast on any newly-pending shop this
 * browser hasn't seen yet (tracked in localStorage, so a refresh doesn't re-toast the same
 * backlog). Support items don't toast individually — new chats/emails are too frequent for
 * that to stay useful — they just show up in the badge count and the dropdown.
 */
function useAdminNotificationFeed() {
  const router = useRouter()
  const [feed, setFeed] = useState<AdminNotificationFeedResponse>({ total_count: 0, items: [] })
  const seenPendingShopIds = useRef<Set<string> | null>(null)
  const canPoll = usePollBudget()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/admin/notification-feed", { credentials: "include" })
        const json = (await res.json().catch(() => ({}))) as { data?: AdminNotificationFeedResponse }
        if (cancelled || !res.ok) return
        const data = json.data ?? { total_count: 0, items: [] }
        setFeed(data)

        if (seenPendingShopIds.current === null) {
          try {
            const raw = window.localStorage.getItem(NOTIFICATIONS_SEEN_KEY)
            const parsed = raw ? JSON.parse(raw) : []
            seenPendingShopIds.current = new Set(Array.isArray(parsed) ? parsed.map(String) : [])
          } catch {
            seenPendingShopIds.current = new Set()
          }
        }

        const pendingShops = data.items.filter((item) => item.kind === "pending_shop")
        const unseen = pendingShops.filter((item) => !seenPendingShopIds.current!.has(item.id))
        if (unseen.length > 0) {
          if (unseen.length === 1) {
            toast(`New signup pending approval`, {
              description: unseen[0].subtitle,
              action: { label: "Review", onClick: () => router.push("/admin") },
            })
          } else {
            toast(`${unseen.length} new signups pending approval`, {
              action: { label: "Review", onClick: () => router.push("/admin") },
            })
          }
          for (const item of unseen) seenPendingShopIds.current!.add(item.id)
          try {
            window.localStorage.setItem(
              NOTIFICATIONS_SEEN_KEY,
              JSON.stringify([...seenPendingShopIds.current!].slice(-200))
            )
          } catch {
            // best effort — badge/toast still work without persistence
          }
        }
      } catch {
        // Badge is optional — ignore network blips.
      }
    }
    void load()
    if (!canPoll) return
    const timer = window.setInterval(() => void load(), 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [router, canPoll])

  return feed
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

function relativeTimeLabel(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const NOTIFICATION_ICON: Record<AdminNotificationItemRow["kind"], typeof Bell> = {
  pending_shop: Building2,
  chat: MessageCircle,
  email: Mail,
  feedback: FileText,
}

/**
 * The admin header bell — a dropdown over every notification category (pending shop
 * approvals, unread support chat/email, open feedback), not just one. Picking an item jumps
 * straight to it: pending shops scroll to the Home page's list (there's no dedicated route
 * for them), everything else deep-links into /admin/support via query params.
 */
function NotificationBell() {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const feed = useAdminNotificationFeed()
  const [open, setOpen] = useState(false)

  // Pending shops have no dedicated route — they live in a section on the Home page that
  // mounts (and keeps shifting) as the page's own data fetch fills in the cards above it, so
  // finding the element once isn't enough: keep re-correcting position for the whole budget
  // instead of stopping at the first hit, or an early attempt locks onto a too-early offset
  // (the section can still be pushed further down after it first appears). Scroll the window
  // directly rather than element.scrollIntoView(), whose ancestor-walk behavior is harder to
  // predict on a page with no separate internal scroll region.
  const scrollToPendingShops = () => {
    const scroll = () => {
      const target = document.getElementById("pending-shops")
      if (!target) return
      const top = target.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top })
    }
    if (pathname !== "/admin") router.push("/admin")
    let attempts = 0
    const tick = () => {
      scroll()
      attempts += 1
      if (attempts < 20) window.setTimeout(tick, 200)
    }
    window.setTimeout(tick, 200)
  }

  const handleSelect = (item: AdminNotificationItemRow) => {
    setOpen(false)
    if (item.kind === "pending_shop") {
      scrollToPendingShops()
      return
    }
    router.push(item.href)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            feed.total_count > 0
              ? `${feed.total_count} notification${feed.total_count === 1 ? "" : "s"}`
              : "No notifications"
          }
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="h-4 w-4" aria-hidden />
          <SupportCountBadge count={feed.total_count} className="absolute -right-0.5 -top-0.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
        </div>
        {feed.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">You&rsquo;re all caught up.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-auto">
            {feed.items.map((item) => {
              const Icon = NOTIFICATION_ICON[item.kind]
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(item)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60"
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-operator" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{item.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {relativeTimeLabel(item.timestamp)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
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
          <NotificationBell />
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
