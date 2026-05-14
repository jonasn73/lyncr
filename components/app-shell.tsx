"use client"

import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
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
  LogOut,
  Loader2,
  ChevronDown,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"
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

/** Session snapshot for the header: name/email plus whether this login may open /admin (operator console). */
export type AccountHeaderState =
  | { kind: "loading" }
  | { kind: "ready"; name: string; email: string; operator_access: boolean }

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

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function HeaderAccountMenu({ name, email, operatorAccess }: { name: string; email: string; operatorAccess: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 max-w-[min(100vw-8rem,14rem)] gap-2 border-border/80 bg-card/80 px-2 shadow-sm",
            operatorAccess && "border-violet-500/35 ring-1 ring-violet-500/20"
          )}
          aria-label="Open account menu"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback
              className={cn(
                "text-[11px] font-semibold",
                operatorAccess ? "bg-violet-600/25 text-violet-200" : "bg-primary/15 text-primary"
              )}
            >
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
            {operatorAccess && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-violet-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                <Shield className="size-3" aria-hidden />
                Platform operator
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {operatorAccess && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/admin" className="cursor-pointer text-violet-200 focus:text-violet-100">
                <Shield className="size-4" />
                Operator console
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
}

export function AppShell({
  activePage,
  pathname,
  accountHeader,
  onNavigate,
  children,
}: {
  activePage: PageId
  /** Set on real routes (e.g. /dashboard/*) — bottom nav uses Link for correct App Router transitions */
  pathname?: string
  /** Dashboard: session for header menu (settings, help, sign out). */
  accountHeader?: AccountHeaderState
  /** Set on the marketing / root in-memory shell — tab switches without changing URL */
  onNavigate?: (page: PageId) => void
  children: ReactNode
}) {
  const useLinks = Boolean(pathname)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!pathname) return
    const el = mainRef.current
    if (el) el.scrollTop = 0
  }, [pathname])

  const isOperator =
    useLinks && accountHeader?.kind === "ready" && accountHeader.operator_access

  return (
    <div
      className={cn(
        "flex h-dvh max-h-dvh flex-col overflow-hidden bg-background",
        isOperator && "shadow-[inset_0_3px_0_0] shadow-violet-500/55"
      )}
    >
      <header className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 py-2.5 sm:px-4 sm:py-3">
        {useLinks ? (
          <Link
            href="/dashboard"
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
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
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            aria-label="Go to routing"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Phone className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-foreground">Zing</span>
          </button>
        )}

        <div className="min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {isOperator && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5 border-violet-500/40 bg-violet-950/40 px-2 text-violet-100 hover:bg-violet-900/50 hover:text-violet-50 sm:px-2.5"
            >
              <Link href="/admin" title="Fleet tools, credits, and support queue">
                <Shield className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden text-xs font-semibold sm:inline">Operator</span>
              </Link>
            </Button>
          )}
          {useLinks && accountHeader?.kind === "loading" && (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          )}
          {useLinks && accountHeader?.kind === "ready" && (
            <HeaderAccountMenu
              name={accountHeader.name}
              email={accountHeader.email}
              operatorAccess={accountHeader.operator_access}
            />
          )}
          <div className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-1 sm:gap-2 sm:px-2.5">
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
            <span className="hidden text-[11px] font-medium text-success sm:inline">Live</span>
          </div>
        </div>
      </header>

      {isOperator && (
        <div className="flex shrink-0 flex-col items-stretch gap-2 border-b border-violet-500/35 bg-violet-950/45 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-center text-xs leading-snug text-violet-100/95 sm:text-left">
            Member dashboard (your lines). Fleet tools live in the operator console.
          </p>
          <Link
            href="/admin"
            className="shrink-0 rounded-md bg-violet-600 px-2.5 py-1.5 text-center text-xs font-semibold text-white hover:bg-violet-500"
          >
            Open operator console
          </Link>
        </div>
      )}

      <main
        ref={mainRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background pb-[max(env(safe-area-inset-bottom),0px)]"
      >
        {children}
      </main>

      <nav
        className="sticky bottom-0 z-40 shrink-0 border-t border-border/70 bg-background pb-[max(env(safe-area-inset-bottom),0px)]"
        role="navigation"
        aria-label="Main navigation"
      >
        <p className="sr-only">
          Use the tabs below to switch sections. Account, sign out, help, and settings are also in the menu at the top
          right.
        </p>
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
    </div>
  )
}
