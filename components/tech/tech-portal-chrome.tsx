"use client"

// Chrome for the tech console — dark-palette wrapper + a persistent bottom tab bar, mirroring
// components/receptionist-portal-chrome.tsx so the two staff consoles read as one product.
// The home tile grid (components/tech/tech-hub.tsx) stays as the richer, stat-carrying Home
// screen — this nav is the quick-jump layer on top of it, reachable from every sub-page instead
// of only via a single back arrow.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Award, Home, KeyRound, Route, ScanBarcode, Wallet } from "lucide-react"
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

// Same icons/labels/hrefs as tech-hub.tsx's own quickAccess tiles, so the nav and the hub agree.
export const TECH_NAV_ITEMS: NavItem[] = [
  { href: "/tech/dashboard", label: "Home", icon: Home, match: (p) => p === "/tech/dashboard" },
  {
    href: "/tech/dashboard/jobs",
    label: "Jobs",
    icon: Route,
    match: (p) => p.startsWith("/tech/dashboard/jobs"),
  },
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
  {
    href: "/tech/dashboard/wallet",
    label: "Wallet",
    icon: Wallet,
    match: (p) => p.startsWith("/tech/dashboard/wallet"),
    requires: "view_earnings",
  },
  {
    href: "/tech/dashboard/performance",
    label: "Performance",
    icon: Award,
    match: (p) => p.startsWith("/tech/dashboard/performance"),
  },
] as const

export function TechPortalChrome({
  children,
  capabilities,
}: {
  children: React.ReactNode
  /** Omitted for the "not linked yet" fallback screen — no nav without real capabilities to gate items. */
  capabilities?: FieldTechnicianCapabilities
}) {
  const pathname = usePathname() || "/tech/dashboard"
  // A hidden tab is courtesy, not protection — each route re-checks server-side.
  const nav = capabilities
    ? TECH_NAV_ITEMS.filter((item) => !item.requires || capabilities[item.requires] === true)
    : null

  return (
    <div className="min-h-[100dvh] bg-sidebar text-foreground">
      <div className={nav ? "pb-[calc(env(safe-area-inset-bottom)+4.5rem)]" : undefined}>{children}</div>

      {nav ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-sidebar/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
          aria-label="Tech console sections"
        >
          <div className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-1">
            {nav.map((item) => {
              const active = item.match(pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-2xs font-medium",
                    active ? "text-operator" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
