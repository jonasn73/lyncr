"use client"

import Link from "next/link"
import { memo, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { DASHBOARD_PAGE_HREF, dashboardNavItems, type PageId } from "@/lib/dashboard-nav"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import { COMMAND_DOCK_ACCENT, SHELL_ACRYLIC_SURFACE } from "@/lib/shell-chrome-styles"

const CommandDockInner = memo(function CommandDockInner({
  activePage,
  useLinks,
  onNavigate,
}: {
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
}) {
  const navRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ top: 0, height: 44, visible: true })

  useLayoutEffect(() => {
    const idx = dashboardNavItems.findIndex((item) => item.id === activePage)
    const el = itemRefs.current[idx]
    const nav = navRef.current
    if (!el || !nav || idx < 0) {
      setIndicator((prev) => ({ ...prev, visible: false }))
      return
    }
    const navRect = nav.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setIndicator({
      top: elRect.top - navRect.top,
      height: elRect.height,
      visible: true,
    })
  }, [activePage])

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[4.25rem] flex-col border-r",
        SHELL_ACRYLIC_SURFACE
      )}
      aria-label="Command dock"
    >
      <nav
        ref={navRef}
        className="relative flex flex-1 flex-col items-center gap-1.5 px-2 py-4"
        role="navigation"
        aria-label="Main navigation"
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-0 w-0.5 rounded-full transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            COMMAND_DOCK_ACCENT,
            indicator.visible ? "opacity-100" : "opacity-0"
          )}
          style={{
            transform: `translateY(${indicator.top}px)`,
            height: indicator.height,
          }}
        />

        {dashboardNavItems.map((item, index) => {
          const Icon = item.icon
          const isActive = activePage === item.id
          const className = cn(
            "group relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl",
            "transition-[background-color,color,transform,box-shadow] duration-200 ease-out",
            "motion-safe:active:scale-[0.96]",
            isActive
              ? "bg-primary/12 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
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
                  "whitespace-nowrap rounded-md border border-white/10 bg-neutral-950/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-lg backdrop-blur-md",
                  "opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
                  "translate-x-1 group-hover:translate-x-0 group-focus-visible:translate-x-0"
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
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
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
              ref={(node) => {
                itemRefs.current[index] = node
              }}
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
