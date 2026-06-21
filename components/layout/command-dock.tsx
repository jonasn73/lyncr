"use client"

import Link from "next/link"
import { memo } from "react"
import { cn } from "@/lib/utils"
import { DASHBOARD_PAGE_HREF, dashboardNavItems, type PageId } from "@/lib/dashboard-nav"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"

const CommandDockInner = memo(function CommandDockInner({
  activePage,
  useLinks,
  onNavigate,
}: {
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[4.25rem] flex-col",
        "border-r border-border/60 bg-background/75 backdrop-blur-md",
        "shadow-[4px_0_24px_-12px_rgba(0,0,0,0.45)]"
      )}
      aria-label="Command dock"
    >
      <nav className="flex flex-1 flex-col items-center gap-1.5 px-2 py-4" role="navigation" aria-label="Main navigation">
        {dashboardNavItems.map((item) => {
          const Icon = item.icon
          const isActive = activePage === item.id
          const className = cn(
            "group relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl",
            "transition-[background-color,color,transform,box-shadow] duration-200 ease-out",
            "motion-safe:active:scale-[0.96]",
            isActive
              ? "bg-primary/15 text-primary shadow-[var(--electric-glow)] ring-1 ring-primary/40"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )
          const inner = (
            <>
              <Icon
                className={cn(
                  "h-[1.35rem] w-[1.35rem] transition-transform duration-200",
                  isActive && "scale-105"
                )}
                aria-hidden
              />
              <span className="sr-only">{item.label}</span>
              <span
                className={cn(
                  "pointer-events-none absolute left-[calc(100%+0.65rem)] top-1/2 z-[60] -translate-y-1/2",
                  "whitespace-nowrap rounded-md border border-border/70 bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-lg",
                  "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                )}
                aria-hidden
              >
                {item.label}
              </span>
            </>
          )

          if (useLinks) {
            return (
              <Link
                key={item.id}
                href={DASHBOARD_PAGE_HREF[item.id]}
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
      </nav>
    </aside>
  )
})

export const CommandDock = memo(function CommandDock({
  useLinks,
  onNavigate,
}: {
  useLinks: boolean
  onNavigate?: (page: PageId) => void
}) {
  const activePage = useDashboardActivePage()
  return <CommandDockInner activePage={activePage} useLinks={useLinks} onNavigate={onNavigate} />
})
