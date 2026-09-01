"use client"

// Chrome for the tech console — mobile-only bottom tab bar, capability-gated exactly like
// components/receptionist-portal-chrome.tsx, styled to the tech console's own dark palette
// instead of the receptionist's. No top nav mirror: the tech console has never supported a
// desktop breakpoint (max-w-md throughout), so there's nothing to mirror there.
//
// Deliberately does NOT render a shared header — TechConsole (the Jobs tab) already renders
// its own header with the business name, greeting, refresh, and sign out. Duplicating that
// here would either fight it or force changes to an existing, working page. New tabs (Keys,
// Inventory) carry their own lightweight in-page header instead.

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, KeyRound, LogOut, ScanBarcode } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FieldTechnicianCapabilities } from "@/lib/types"

type NavItem = {
  href: string
  label: string
  icon: typeof Home
  match: (p: string) => boolean
  /** Shown only when the owner has turned this capability on. Always shown when absent. */
  requires?: keyof FieldTechnicianCapabilities
}

export const TECH_NAV_ITEMS: NavItem[] = [
  { href: "/tech/dashboard", label: "Jobs", icon: Home, match: (p) => p === "/tech/dashboard" },
  {
    href: "/tech/dashboard/keys",
    label: "Keys",
    icon: KeyRound,
    match: (p) => p.startsWith("/tech/dashboard/keys"),
    requires: "key_lookup",
  },
  {
    href: "/tech/dashboard/inventory",
    label: "Inventory",
    icon: ScanBarcode,
    match: (p) => p.startsWith("/tech/dashboard/inventory"),
    requires: "inventory_control",
  },
]

export function TechPortalChrome({
  capabilities,
  children,
}: {
  /** Owner-configurable access — decides which extra tabs appear. */
  capabilities: FieldTechnicianCapabilities
  children: React.ReactNode
}) {
  const pathname = usePathname() || "/tech/dashboard"
  const router = useRouter()
  const NAV = TECH_NAV_ITEMS.filter((item) => !item.requires || capabilities[item.requires] === true)
  // Only one non-Jobs tab (or none) is the common case — no bottom bar needed then, the
  // Jobs page's own header already carries sign out.
  const showNav = NAV.length > 1

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      /* ignore */
    }
    router.replace("/tech/login")
  }

  return (
    <div className={cn("min-h-[100dvh] bg-[#0b0b12] text-foreground", showNav && "pb-[calc(env(safe-area-inset-bottom)+4.5rem)]")}>
      {children}

      {showNav ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-[#0b0b12]/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
          aria-label="Tech console sections"
        >
          <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1">
            {NAV.map((item) => {
              const active = item.match(pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-2xs font-medium",
                    active ? "text-operator" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              )
            })}
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-2xs font-medium text-muted-foreground"
            >
              <LogOut className="h-5 w-5" aria-hidden />
              Sign out
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
