"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { FlaskConical, Network, Shield, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { Button } from "@/components/ui/button"
import { BrandWordmark } from "@/components/brand-wordmark"

function AdminTopBar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-[#0b1120]/90 px-3 py-2.5 backdrop-blur-md sm:px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">{userName}</p>
        <p className="truncate text-xs text-slate-500">{userEmail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
          <LogOut className="mr-1 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </header>
  )
}

function AdminSidebar() {
  const pathname = usePathname()
  const nav = [
    { href: "/admin", label: "Dashboard", active: pathname === "/admin" },
    { href: "/admin/network", label: "Network agents", active: pathname?.startsWith("/admin/network") },
    { href: "/admin/sandbox", label: "Dev sandbox", active: pathname?.startsWith("/admin/sandbox") },
  ]

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-[#060a12] lg:w-56 lg:border-r lg:border-b-0">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-4 lg:px-3 lg:py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 shadow-[0_0_20px_-4px_rgba(139,92,246,0.7)]">
          <Shield className="h-5 w-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <BrandWordmark size="xs" variant="onDark" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300/90">Admin</span>
          </div>
          <p className="truncate text-sm font-semibold text-slate-100">Platform console</p>
        </div>
      </div>
      <nav className="space-y-1 px-4 py-3 lg:px-3">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              item.active
                ? "bg-violet-600/25 text-violet-100 ring-1 ring-violet-500/40"
                : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
            )}
          >
            {item.href.includes("sandbox") ? (
              <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
            ) : item.href.includes("network") ? (
              <Network className="h-4 w-4 shrink-0" aria-hidden />
            ) : null}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto hidden border-t border-slate-800 p-3 lg:block">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Restricted</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">Only admin@lyncr.app may access this console.</p>
      </div>
    </aside>
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
  return (
    <div
      className="flex min-h-dvh flex-col bg-[#0b1120] text-slate-200 antialiased lg:flex-row"
      data-sigo-surface="operator"
    >
      <AdminSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AdminTopBar userName={userName} userEmail={userEmail} />
        <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#0b1120_0%,#070b14_100%)]">{children}</div>
      </div>
    </div>
  )
}
