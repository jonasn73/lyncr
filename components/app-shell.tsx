"use client"

import { type ReactNode, useLayoutEffect, useRef } from "react"
import Link from "next/link"
import {
  Phone,
  Users,
  BarChart3,
  Settings,
  Zap,
  ClipboardList,
  Inbox,
  LifeBuoy,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { id: "dashboard", label: "Routing", icon: Zap },
  { id: "activity", label: "Activity", icon: ClipboardList },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "contacts", label: "Team", icon: Users },
  { id: "analytics", label: "Pay", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "help", label: "Help", icon: LifeBuoy },
] as const

export type PageId = (typeof navItems)[number]["id"]

/** Href for each tab — use Link (not router.push) so App Router always swaps the page under this client layout. */
const PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  leads: "/dashboard/leads",
  contacts: "/dashboard/contacts",
  analytics: "/dashboard/analytics",
  settings: "/dashboard/settings",
  help: "/dashboard/help",
}

export function AppShell({
  activePage,
  pathname,
  onNavigate,
  children,
}: {
  activePage: PageId
  /** Set on real routes (e.g. /dashboard/*) — bottom nav uses Link for correct App Router transitions */
  pathname?: string
  /** Set on the marketing / root in-memory shell — tab switches without changing URL */
  onNavigate?: (page: PageId) => void
  children: ReactNode
}) {
  const useLinks = Boolean(pathname)
  // Scroll container for dashboard pages — Next only resets `window` scroll; we must reset this on tab change.
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!pathname) return
    const el = mainRef.current
    if (el) el.scrollTop = 0
  }, [pathname])

  return (
    // h-dvh + overflow-hidden caps height so flex-1 main can scroll; min-h-dvh alone grows with content and breaks overflow-y-auto.
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background">
      {/* Header — mostly opaque so you do not see the previous route “through” the bar during navigation */}
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-border/70 bg-background px-4 py-3">
        {useLinks ? (
          <Link
            href="/dashboard"
            className="flex cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            aria-label="Go to home"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Phone className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-foreground">Zing</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate?.("dashboard")}
            className="flex cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            aria-label="Go to routing"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Phone className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-foreground">Zing</span>
          </button>
        )}
        <div className="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/10 px-2.5 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="text-[11px] font-medium text-success">Live</span>
        </div>
      </header>

      {/* min-h-0 is required so this flex child can shrink and show its own scrollbar */}
      <main
        ref={mainRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background pb-[max(env(safe-area-inset-bottom),0px)]"
      >
        {children}
      </main>

      {/* Bottom navigation */}
      <nav
        className="sticky bottom-0 z-40 shrink-0 border-t border-border/70 bg-background pb-[max(env(safe-area-inset-bottom),0px)]"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="mx-1 my-2 flex max-w-full items-center justify-around gap-0.5 overflow-x-auto rounded-2xl border border-border/60 bg-card/70 px-1 py-1.5 sm:mx-2 sm:gap-1 sm:px-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activePage === item.id
            const className = cn(
              "flex min-h-11 min-w-[52px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 sm:min-w-[58px] sm:px-3",
              "transition-all duration-200 ease-out motion-safe:active:scale-[0.96]",
              isActive
                ? "bg-primary/12 text-primary shadow-[0_0_20px_-8px_var(--primary)]"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )
            const inner = (
              <>
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform duration-200 ease-out",
                    isActive && "scale-105 drop-shadow-[0_0_6px_var(--primary)]"
                  )}
                />
                <span className="text-[11px] font-medium">{item.label}</span>
              </>
            )
            if (useLinks) {
              return (
                <Link
                  key={item.id}
                  href={PAGE_HREF[item.id]}
                  prefetch
                  scroll={false}
                  className={className}
                  aria-current={isActive ? "page" : undefined}
                >
                  {inner}
                </Link>
              )
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate?.(item.id)}
                className={className}
                aria-current={isActive ? "page" : undefined}
              >
                {inner}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
