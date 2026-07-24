"use client"

import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  memo,
} from "react"
import Link from "next/link"
import { Loader2, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { Button } from "@/components/ui/button"
import { AppNavCommandPalette } from "@/components/app-nav-command-palette"
import { CommandDock } from "@/components/layout/command-dock"
import { GlobalLineCommunicationBar } from "@/components/layout/global-line-communication-bar"
import { HeaderAccountMenu } from "@/components/layout/header-settings-sheet"
import { NotificationCenter } from "@/components/layout/notification-center"
import { useGlobalKeyPress } from "@/lib/hooks/use-global-key-press"
import { type PageId } from "@/lib/dashboard-nav"
import { SHELL_ACRYLIC_SURFACE } from "@/lib/shell-chrome-styles"

export type { PageId }

/** Session snapshot for the header account menu (dashboard only). */
export type AccountHeaderState =
  | { kind: "loading" }
  | { kind: "ready"; name: string; email: string; answeredCallCustomerPopupEnabled: boolean }

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
    <header
      className={cn(
        // Above map body / Leaflet chrome; notification popover portals at z-[9999].
        "sticky top-0 z-50 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b px-2.5 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top,0px))] sm:grid-cols-[1fr_auto_1fr] sm:gap-3 sm:px-5 sm:py-3.5",
        SHELL_ACRYLIC_SURFACE
      )}
    >
      {/* Logo stays above the workspace chip so a long business name never covers it. */}
      <div className="relative z-30 flex shrink-0 items-center justify-self-start">
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
      </div>

      {headerCenter ? (
        <div className="relative z-10 flex min-w-0 max-w-full justify-center justify-self-center overflow-hidden pointer-events-auto px-0.5 sm:px-2">
          {headerCenter}
        </div>
      ) : (
        <div aria-hidden />
      )}

      <div className="relative z-20 flex shrink-0 items-center justify-self-end gap-1 sm:gap-2">
        {useLinks && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground sm:h-9 sm:w-9"
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
        {useLinks && accountHeader?.kind === "loading" && <HeaderAccountMenuSkeleton />}
        {useLinks && accountHeader?.kind === "ready" && (
          <HeaderAccountMenu name={accountHeader.name} email={accountHeader.email} />
        )}
      </div>
    </header>
  )
})

/** Same footprint as HeaderAccountMenu while session loads — wallet + avatar. */
const HeaderAccountMenuSkeleton = memo(function HeaderAccountMenuSkeleton() {
  return (
    <div className="flex items-center gap-1.5" aria-busy="true" aria-label="Loading account">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="h-9 shrink-0 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-2.5 shadow-sm"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300/70" aria-hidden />
        <span className="h-2.5 w-10 animate-pulse rounded bg-emerald-500/25" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="h-9 shrink-0 gap-1.5 border-border/80 bg-card/80 px-1.5 shadow-sm sm:px-2"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        </span>
        <span className="hidden h-2.5 w-12 animate-pulse rounded bg-muted/70 sm:inline-block" aria-hidden />
      </Button>
    </div>
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

  useGlobalKeyPress({
    enabled: useLinks,
    metaOrCtrl: true,
    key: "k",
    onPress: (event) => {
      event.preventDefault()
      setCommandOpen((prev) => !prev)
    },
  })

  return (
    <div
      data-app-shell=""
      className="flex h-dvh max-h-dvh overflow-hidden bg-background [--shell-header-h:3.25rem] [--shell-dock-h:calc(4rem+env(safe-area-inset-bottom,0px))] md:[--shell-dock-h:0px]"
    >
      <CommandDock useLinks={useLinks} onNavigate={onNavigate} />

      <div className="flex min-w-0 flex-1 flex-col pl-0 md:pl-[4.25rem]">
        <AppShellHeader
          useLinks={useLinks}
          accountHeader={accountHeader}
          onNavigate={onNavigate}
          commandOpen={commandOpen}
          onCommandOpenChange={handleCommandOpenChange}
          headerCenter={headerCenter}
        />

        {/* Cross-tab Dynamic Island — driven by useLyncEngine primary call state. */}
        <GlobalLineCommunicationBar />

        <main
          ref={mainRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y",
            "bg-gradient-to-b from-background to-muted/15",
            // Clear the fixed mobile dock + Safari home-indicator so last content stays tappable
            "pb-[calc(env(safe-area-inset-bottom,0px)+4rem)] md:pb-0"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export const AppShell = memo(AppShellInner)
