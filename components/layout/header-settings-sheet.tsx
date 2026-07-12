"use client"

// Profile avatar opens the Settings list in a sliding sheet (replaces mobile Settings tab).

import { memo, useState, Suspense } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChevronDown, LifeBuoy, Loader2, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DASHBOARD_PAGE_HREF } from "@/lib/dashboard-nav"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"
import { useIsMobile } from "@/hooks/use-mobile"

const SettingsWorkspaceView = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: m.SettingsWorkspaceView,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        Loading settings…
      </div>
    ),
  }
)

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const HeaderAccountMenu = memo(function HeaderAccountMenu({
  name,
  email,
}: {
  name: string
  email: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isMobile = useIsMobile()

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-11 w-[2.75rem] gap-2 border-border/80 bg-card/80 px-2 shadow-sm sm:h-9 sm:w-[14rem] sm:max-w-[14rem]"
        aria-label="Open settings"
        aria-haspopup="dialog"
        aria-expanded={open}
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
        <ChevronDown className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          variant={isMobile ? "default" : "drawer"}
          className={cn(
            WORKSPACE_SHEET_CLASS,
            isMobile
              ? "flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0"
              : "flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md"
          )}
        >
          <SheetHeader className="shrink-0 border-b border-slate-850 px-4 pb-3 pt-4 text-left">
            <div className="flex items-center justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle className="text-base text-slate-100">Settings</SheetTitle>
                <p className="truncate text-xs text-slate-500">{email}</p>
              </div>
              <Link
                href={DASHBOARD_PAGE_HREF.help}
                onClick={() => setOpen(false)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-900"
              >
                <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
                Help
              </Link>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
                  Loading…
                </div>
              }
            >
              <SettingsWorkspaceView embedded />
            </Suspense>
          </div>

          {/* Extra sign-out escape hatch if the nested Settings list is scrolled away */}
          <div className="shrink-0 border-t border-slate-850 px-4 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void signOutAndGoToLogin().finally(() => setBusy(false))
              }}
              className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-rose-400 hover:text-rose-300 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
})
