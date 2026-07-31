"use client"

// Compact platform admin shell — dense header + nav so ops content is visible first.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  Building2,
  FlaskConical,
  Headphones,
  Home,
  LogOut,
  Menu,
  MessageSquareWarning,
  Network,
  Settings,
  Shield,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { Button } from "@/components/ui/button"
import { BrandWordmark } from "@/components/brand-wordmark"

const NAV = [
  { href: "/admin", label: "Home", icon: Home, match: (p: string) => p === "/admin" },
  {
    href: "/admin/businesses",
    label: "Businesses",
    icon: Building2,
    match: (p: string) => p.startsWith("/admin/businesses"),
  },
  {
    href: "/admin/people",
    label: "People",
    icon: Users,
    match: (p: string) => p.startsWith("/admin/people") || p.startsWith("/admin/receptionists"),
  },
  {
    href: "/admin/network",
    label: "Network",
    icon: Network,
    match: (p: string) => p.startsWith("/admin/network"),
  },
  {
    href: "/admin/payouts",
    label: "Payouts",
    icon: Wallet,
    match: (p: string) => p.startsWith("/admin/payouts") || p.startsWith("/admin/dashboard/operators"),
  },
  {
    href: "/admin/support",
    label: "Support",
    icon: MessageSquareWarning,
    match: (p: string) => p.startsWith("/admin/support"),
  },
  {
    href: "/admin/tools",
    label: "Tools",
    icon: FlaskConical,
    match: (p: string) => p.startsWith("/admin/tools") || p.startsWith("/admin/sandbox"),
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    match: (p: string) => p.startsWith("/admin/settings"),
  },
] as const

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? ""
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = item.match(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-violet-600/25 text-violet-100 ring-1 ring-violet-500/40"
                : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AdminChrome({
  children,
  userName,
  userEmail,
}: {
  children: React.ReactNode
  userName: string
  userEmail: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pathname = usePathname() ?? ""
  const pageLabel = NAV.find((n) => n.match(pathname))?.label ?? "Admin"

  return (
    <div
      className="flex min-h-dvh flex-col bg-[#0b1120] text-slate-200 antialiased lg:flex-row"
      data-sigo-surface="operator"
    >
      {/* Desktop sidebar — compact */}
      <aside className="hidden w-48 shrink-0 flex-col border-r border-slate-800 bg-[#060a12] lg:flex">
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600">
            <Shield className="h-4 w-4 text-white" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <BrandWordmark size="xs" variant="onDark" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-violet-300/90">Admin</span>
            </div>
          </div>
        </div>
        <NavLinks />
        <div className="mt-auto border-t border-slate-800 p-3">
          <p className="truncate text-[11px] text-slate-500">{userEmail}</p>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-[#0b1120]/95 px-3 py-2 backdrop-blur-md sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-300 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Headphones className="hidden h-4 w-4 text-violet-300 sm:block" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">{pageLabel}</p>
              <p className="truncate text-[11px] text-slate-500 sm:hidden">{userName}</p>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <Link href="/dashboard">App</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className="border-slate-600 bg-slate-900/50 text-slate-200 hover:bg-red-950/40 hover:text-red-200"
            onClick={() => {
              setBusy(true)
              void signOutAndGoToLogin()
            }}
          >
            <LogOut className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </header>

        {menuOpen ? (
          <div className="border-b border-slate-800 bg-[#060a12] lg:hidden">
            <NavLinks onNavigate={() => setMenuOpen(false)} />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#0b1120_0%,#070b14_100%)]">
          {children}
        </div>
      </div>
    </div>
  )
}
