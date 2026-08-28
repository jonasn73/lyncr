"use client"

// Chrome for the receptionist portal — desk header + Home / Calls / Earnings.
// Sign out: header on desktop (sm+), bottom tab on mobile (no duplicate).

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DollarSign, Home, LogOut, Phone } from "lucide-react"
import { ReceptionistImpersonationBar } from "@/components/receptionist-impersonation-bar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/receptionist", label: "Home", icon: Home, match: (p: string) => p === "/receptionist" },
  {
    href: "/receptionist/calls",
    label: "Calls",
    icon: Phone,
    match: (p: string) => p.startsWith("/receptionist/calls"),
  },
  {
    href: "/receptionist/earnings",
    label: "Earnings",
    icon: DollarSign,
    match: (p: string) => p.startsWith("/receptionist/earnings"),
  },
] as const

export function ReceptionistPortalChrome({
  userName,
  businessName,
  children,
}: {
  userName: string
  businessName?: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname() || "/receptionist"

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
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Phone className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-micro font-semibold uppercase tracking-[0.14em] text-primary">
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

          {/* Desktop / tablet header nav — includes Sign out (bottom bar is sm:hidden) */}
          <div className="hidden items-center gap-0.5 sm:flex">
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
          {NAV.map((item) => {
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
