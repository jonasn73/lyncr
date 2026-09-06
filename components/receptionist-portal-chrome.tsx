"use client"

// Chrome for the receptionist portal — desk header + Home / Calls / Earnings.
// Sign out: header on desktop (sm+), bottom tab on mobile (no duplicate).

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDays, DollarSign, Home, LogOut, Phone, Truck, Users } from "lucide-react"
import { ReceptionistImpersonationBar } from "@/components/receptionist-impersonation-bar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ReceptionistCapabilities } from "@/lib/types"

type NavItem = {
  href: string
  label: string
  icon: typeof Home
  match: (p: string) => boolean
  /** Shown only when the owner has turned this capability on. Always shown when absent. */
  requires?: keyof ReceptionistCapabilities
}

// Same order the owner console uses, so the two consoles read as one product.
// Home / Calls / Earnings are the front desk itself and are never gated; the mirrored
// surfaces in between appear exactly when the owner opens them.
export const RECEPTIONIST_NAV_ITEMS: NavItem[] = [
  { href: "/receptionist", label: "Home", icon: Home, match: (p) => p === "/receptionist" },
  {
    href: "/receptionist/calls",
    label: "Calls",
    icon: Phone,
    match: (p) => p.startsWith("/receptionist/calls"),
  },
  {
    href: "/receptionist/customers",
    label: "Customers",
    icon: Users,
    match: (p) => p.startsWith("/receptionist/customers"),
    requires: "crm_access",
  },
  {
    href: "/receptionist/scheduler",
    label: "Scheduler",
    icon: CalendarDays,
    match: (p) => p.startsWith("/receptionist/scheduler"),
    requires: "scheduler",
  },
  {
    href: "/receptionist/dispatch",
    label: "Dispatch",
    icon: Truck,
    match: (p) => p.startsWith("/receptionist/dispatch"),
    requires: "dispatching",
  },
  {
    href: "/receptionist/earnings",
    label: "Earnings",
    icon: DollarSign,
    match: (p) => p.startsWith("/receptionist/earnings"),
  },
]

export function ReceptionistPortalChrome({
  userName,
  businessName,
  capabilities,
  children,
}: {
  userName: string
  businessName?: string | null
  /** Owner-configurable access — decides which mirrored tabs appear. */
  capabilities?: ReceptionistCapabilities
  children: React.ReactNode
}) {
  const pathname = usePathname() || "/receptionist"
  // A hidden tab is courtesy, not protection — each route re-checks server-side.
  const NAV = RECEPTIONIST_NAV_ITEMS.filter((item) => !item.requires || capabilities?.[item.requires] === true)
  // Scheduler stays desktop-only on the receptionist side too — the bottom bar is
  // already tight with Home/Calls/Customers/Dispatch/Earnings on a phone screen.
  const MOBILE_NAV = NAV.filter((item) => item.href !== "/receptionist/scheduler")

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    window.location.href = "/login"
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-8">
      <ReceptionistImpersonationBar />

      {/* Desk-style header: console label + name + company */}
      <header className="border-b border-border/50 bg-card/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Phone className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-micro font-semibold uppercase tracking-[0.14em] text-primary">
                Receptionist console
              </p>
              <p className="truncate text-sm font-semibold leading-tight text-foreground">
                {userName}
                {businessName ? (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    <span className="text-foreground">{businessName}</span>
                  </span>
                ) : null}
              </p>
            </div>
          </div>

        </div>

        {/* Nav gets its own row — the tab list grows with the owner's grants, and it
            scrolls rather than colliding with the name. Sign out lives here on sm+;
            the bottom bar carries it on mobile. */}
        <div className="mx-auto hidden max-w-6xl overflow-x-auto px-4 pb-2 sm:block sm:px-6">
          <div className="flex w-max items-center gap-0.5">
          {NAV.map((item) => {
            const active = item.match(pathname)
            const Icon = item.icon
            return (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 text-muted-foreground hover:text-foreground",
                  active && "bg-primary/10 text-primary hover:text-primary"
                )}
              >
                <Link href={item.href}>
                  <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {item.label}
                </Link>
              </Button>
            )
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleLogout()}
            className="h-9 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Sign out
          </Button>
        </div>
</div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>

      {/* Mobile bottom tabs — safe-area padding keeps controls above the browser chrome */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-card/95 backdrop-blur-sm sm:hidden pb-[env(safe-area-inset-bottom)]"
        aria-label="Receptionist sections"
      >
        <div className="mx-auto flex max-w-6xl items-stretch justify-around px-2 pt-1">
          {MOBILE_NAV.map((item) => {
            const active = item.match(pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-2xs font-medium",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {item.label}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-2xs font-medium text-muted-foreground"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Sign out
          </button>
        </div>
      </nav>
    </div>
  )
}
