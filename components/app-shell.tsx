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
  LifeBuoy,
  LogOut,
  Loader2,
  ChevronDown,
  Search,
  CalendarDays,
  Settings,
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
import { CommandDock } from "@/components/layout/command-dock"
import { NotificationCenter } from "@/components/layout/notification-center"
import { DASHBOARD_PAGE_HREF, type PageId } from "@/lib/dashboard-nav"

export type { PageId }

/** Session snapshot for the header account menu (dashboard only). */
export type AccountHeaderState =
  | { kind: "loading" }
  | { kind: "ready"; name: string; email: string; answeredCallCustomerPopupEnabled: boolean }

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AppShellHeader = memo(function AppShellHeader({
  useLinks,
  accountHeader,
  onNavigate,
  commandOpen,
  onCommandOpenChange,
  headerCenter,
}: {
  useLinks: boolean
  accountHeader?: AccountHeaderState
  onNavigate?: (page: PageId) => void
  commandOpen: boolean
  onCommandOpenChange: (open: boolean) => void
  /** Optional center slot (e.g. business workspace switcher). */
  headerCenter?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/80 px-3 py-3 backdrop-blur-md sm:px-5 sm:py-3.5">
      {useLinks ? (
        <Link
          href="/dashboard"
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          aria-label="Go to home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BrandMark className="h-4 w-4 text-primary-foreground" />
          </div>
          <BrandWordmark size="md" className="hidden sm:inline-flex" />
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
          <BrandWordmark size="md" className="hidden sm:inline-flex" />
        </button>
      )}

      {headerCenter ? <div className="flex min-w-0 flex-1 justify-center px-2">{headerCenter}</div> : <div className="min-w-0 flex-1" />}

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
        {useLinks ? <NotificationCenter /> : null}
        {useLinks && accountHeader?.kind === "loading" && (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        )}
        {useLinks && accountHeader?.kind === "ready" && (
          <HeaderAccountMenu name={accountHeader.name} email={accountHeader.email} />
        )}
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
          <Link href={DASHBOARD_PAGE_HREF.settings} className="cursor-pointer">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={DASHBOARD_PAGE_HREF.scheduler} className="cursor-pointer">
            <CalendarDays className="size-4" />
            Scheduler
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={DASHBOARD_PAGE_HREF.help} className="cursor-pointer">
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
  pathname,
  accountHeader,
  onNavigate,
  headerCenter,
  children,
}: {
  pathname?: string
  accountHeader?: AccountHeaderState
  onNavigate?: (page: PageId) => void
  headerCenter?: ReactNode
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
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-background">
      <CommandDock useLinks={useLinks} onNavigate={onNavigate} />

      <div className="flex min-w-0 flex-1 flex-col pl-[4.25rem]">
        <AppShellHeader
          useLinks={useLinks}
          accountHeader={accountHeader}
          onNavigate={onNavigate}
          commandOpen={commandOpen}
          onCommandOpenChange={handleCommandOpenChange}
          headerCenter={headerCenter}
        />

        <main
          ref={mainRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain",
            "bg-gradient-to-b from-background to-muted/15"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export const AppShell = memo(AppShellInner)
