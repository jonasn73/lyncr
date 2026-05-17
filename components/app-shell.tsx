"use client"

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  memo,
} from "react"
import Link from "next/link"
import {
  Users,
  BarChart3,
  Settings,
  Zap,
  ClipboardList,
  Inbox,
  LifeBuoy,
  LogOut,
  Loader2,
  ChevronDown,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { AppNavCommandPalette } from "@/components/app-nav-command-palette"

/** All dashboard segments we recognize for highlighting and deep links (Help is not a bottom tab). */
export type PageId =
  | "dashboard"
  | "activity"
  | "leads"
  | "customers"
  | "contacts"
  | "pay"
  | "settings"
  | "help"

/** Primary tabs only — fewer taps; Help stays in the account menu and ⌘K jump palette. */
const bottomNavItems = [
  { id: "dashboard" as const, label: "Routing", icon: Zap },
  { id: "activity" as const, label: "Activity", icon: ClipboardList },
  { id: "leads" as const, label: "Leads", icon: Inbox },
  { id: "contacts" as const, label: "Team", icon: Users },
  { id: "pay" as const, label: "Pay", icon: BarChart3 },
  { id: "settings" as const, label: "Settings", icon: Settings },
] as const

/** Session snapshot for the header account menu (dashboard only). */
export type AccountHeaderState =
  | { kind: "loading" }
  | { kind: "ready"; name: string; email: string; answeredCallCustomerPopupEnabled: boolean }

/** Href for each tab — use Link (not router.push) so App Router always swaps the page under this client layout. */
const PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  leads: "/dashboard/leads",
  customers: "/dashboard/customers",
  contacts: "/dashboard/contacts",
  pay: "/dashboard/pay",
  settings: "/dashboard/settings",
  help: "/dashboard/help",
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AppShellBottomNav = memo(function AppShellBottomNav({
  activePage,
  useLinks,
  onNavigate,
}: {
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
}) {
  return (
    <nav
      className="sticky bottom-0 z-40 shrink-0 border-t border-border/70 bg-background pb-[max(env(safe-area-inset-bottom),0px)]"
      role="navigation"
      aria-label="Main navigation"
    >
      <p className="sr-only">
        Use the tabs below for the main sections. Press ⌘K or Ctrl+K to jump anywhere. Account menu at the top right
        includes settings, help, and sign out.
      </p>
      <div className="mx-2 my-3 flex max-w-full items-center justify-around gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card px-1.5 py-2 shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.25)] sm:mx-3 sm:mb-4 sm:gap-1 sm:px-2.5">
        {bottomNavItems.map((item) => {
          const Icon = item.icon
          const isActive = activePage === item.id
          const className = cn(
            "flex min-h-11 min-w-[52px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 sm:min-w-[58px] sm:px-3",
            "transition-[background-color,color,transform] duration-200 ease-out motion-safe:active:scale-[0.96]",
            isActive
              ? "bg-primary/15 text-primary shadow-[var(--electric-glow)] ring-1 ring-primary/40"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          )
          const inner = (
            <>
              <Icon
                className={cn(
                  "h-5 w-5 transition-transform duration-200 ease-out",
                  isActive && "scale-105"
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
                title={item.label}
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
              title={item.label}
            >
              {inner}
            </button>
          )
        })}
      </div>
    </nav>
  )
})

const AppShellHeader = memo(function AppShellHeader({
  useLinks,
  accountHeader,
  onNavigate,
  commandOpen,
  onCommandOpenChange,
}: {
  useLinks: boolean
  accountHeader?: AccountHeaderState
  onNavigate?: (page: PageId) => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
}) {
  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 py-3 sm:px-5 sm:py-3.5">
      {useLinks ? (
        <Link
          href="/dashboard"
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Go to home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="h-4 w-4 text-primary-foreground" />
          </div>
          <BrandWordmark size="md" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate?.("dashboard")}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Go to routing"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="h-4 w-4 text-primary-foreground" />
          </div>
          <BrandWordmark size="md" />
        </button>
      )}

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {useLinks && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Jump to a page"
              title="Jump to page — ⌘K or Ctrl+K"
              onClick={() => onCommandOpenChange(true)}
            >
              <Search className="h-5 w-5" />
            </Button>
            <AppNavCommandPalette enabled={useLinks} open={commandOpen} onOpenChange={onCommandOpenChange} />
          </>
        )}
        {useLinks && accountHeader?.kind === "loading" && (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        )}
        {useLinks && accountHeader?.kind === "ready" && (
          <HeaderAccountMenu name={accountHeader.name} email={accountHeader.email} />
        )}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/45 bg-primary/12 px-2 py-1 shadow-[var(--electric-glow)] sm:gap-2 sm:px-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" aria-hidden />
          <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-primary sm:inline">Live</span>
        </div>
      </div>
    </header>
  )
})

const HeaderAccountMenu = memo(function HeaderAccountMenu({ name, email }: { name: string; email: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 max-w-[min(100vw-8rem,14rem)] gap-2 border-border/80 bg-card/80 px-2 shadow-sm"
          aria-label="Open account menu"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
              {initialsFromName(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-1 flex-col items-start text-left sm:flex">
            <span className="w-full truncate text-xs font-medium text-foreground">{name}</span>
            <span className="w-full truncate text-[10px] text-muted-foreground">{email}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings" className="cursor-pointer">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/help" className="cursor-pointer">
            <LifeBuoy className="size-4" />
            Help & feedback
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={busy}
          onSelect={(e) => {
            e.preventDefault()
            setBusy(true)
            void signOutAndGoToLogin()
          }}
        >
          <LogOut className="size-4" />
          {busy ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

function AppShellInner({
  activePage,
  pathname,
  accountHeader,
  onNavigate,
  children,
}: {
  activePage: PageId
  pathname?: string
  accountHeader?: AccountHeaderState
  onNavigate?: (page: PageId) => void
  children: ReactNode
}) {
  const useLinks = Boolean(pathname)
  const mainRef = useRef<HTMLElement>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const handleCommandOpenChange = useCallback((open: boolean) => setCommandOpen(open), [])

  useLayoutEffect(() => {
    if (!pathname) return
    const el = mainRef.current
    if (el) el.scrollTop = 0
  }, [pathname])

  useEffect(() => {
    if (!useLinks) return
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K"
      if (!isK || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      setCommandOpen((prev) => !prev)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [useLinks])

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background">
      <AppShellHeader
        useLinks={useLinks}
        accountHeader={accountHeader}
        onNavigate={onNavigate}
        commandOpen={commandOpen}
        onCommandOpenChange={handleCommandOpenChange}
      />

      <main
        ref={mainRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-gradient-to-b from-background to-muted/15 pb-[max(env(safe-area-inset-bottom),0px)]"
      >
        {children}
      </main>

      <AppShellBottomNav activePage={activePage} useLinks={useLinks} onNavigate={onNavigate} />
    </div>
  )
}

export const AppShell = memo(AppShellInner)
