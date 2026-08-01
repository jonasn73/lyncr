"use client"

// Chrome for the receptionist portal — Home / Calls / Earnings + Sign out (no Training).

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
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Phone className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Receptionist</p>
              <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
              {businessName ? (
                <p className="truncate text-xs text-zinc-400">
                  Assigned to <span className="font-medium text-zinc-200">{businessName}</span>
                </p>
              ) : null}
            </div>
          </div>
          <div className="hidden items-center gap-1 sm:flex">
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
                    "text-zinc-400 hover:text-foreground",
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
              variant="outline"
              size="sm"
              className="ml-1 border-zinc-700"
              onClick={() => void handleLogout()}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" aria-hidden />
              Sign out
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-zinc-700 sm:hidden"
            onClick={() => void handleLogout()}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 backdrop-blur-sm sm:hidden pb-[env(safe-area-inset-bottom)]"
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
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium",
                  active ? "text-primary" : "text-zinc-500"
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
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium text-zinc-500"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Sign out
          </button>
        </div>
      </nav>
    </div>
  )
}
