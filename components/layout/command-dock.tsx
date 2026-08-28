"use client"

import Link from "next/link"
import { memo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  DASHBOARD_PAGE_HREF,
  DASHBOARD_MOBILE_PAGE_HREF,
  dashboardNavItems,
  mobileBottomNavItems,
  type DashboardNavItem,
  type PageId,
} from "@/lib/dashboard-nav"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import { useLyncEngineOptional } from "@/lib/lync-engine-context"
import { SHELL_ACRYLIC_SURFACE } from "@/lib/shell-chrome-styles"

type DockOrientation = "vertical" | "horizontal"

const DockNavItems = memo(function DockNavItems({
  items,
  activePage,
  useLinks,
  onNavigate,
  orientation,
  hrefOverrides,
  badgeCounts,
}: {
  items: DashboardNavItem[]
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
  orientation: DockOrientation
  /** When set (mobile dock), overrides default tab hrefs. */
  hrefOverrides?: Partial<Record<PageId, string>>
  /** Optional unread / alert dots per tab (e.g. Activities missed). */
  badgeCounts?: Partial<Record<PageId, number>>
}) {
  const isVertical = orientation === "vertical"
  // Desktop + mobile docks stay mounted — separate layoutIds so pills don’t cross-animate.
  const activePillId = isVertical ? "lyncr-dock-active-v" : "lyncr-dock-active-h"
  const reduceMotion = useReducedMotion()

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon
        const isActive = activePage === item.id
        const badge = badgeCounts?.[item.id] ?? 0
        const className = cn(
          "group relative flex shrink-0 items-center justify-center rounded-xl",
          "transition-[color,transform] duration-200 ease-out",
          "motion-safe:active:scale-[0.96]",
          isVertical
            ? "h-11 w-11 flex-col"
            : // Four mobile tabs — flex-1 so icons stay even on narrow phones
              "min-h-11 min-w-0 flex-1 flex-col gap-0.5 px-1 py-2",
          isActive
            ? "text-primary"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
        )
        const inner = (
          <>
            {isActive ? (
              reduceMotion ? (
                <span className="absolute inset-0 rounded-xl bg-primary/12" aria-hidden />
              ) : (
                <motion.span
                  layoutId={activePillId}
                  className="absolute inset-0 rounded-xl bg-primary/12"
                  transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.55 }}
                  aria-hidden
                />
              )
            ) : null}
            <span className="relative z-10 inline-flex flex-col items-center gap-0.5">
              <span className="relative inline-flex">
                <Icon
                  className={cn(
                    "shrink-0 transition-transform duration-200",
                    isVertical ? "h-[1.35rem] w-[1.35rem]" : "h-5 w-5",
                    isActive && "scale-105"
                  )}
                  aria-hidden
                />
                {badge > 0 ? (
                  <span
                    className={cn(
                      "absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full",
                      "bg-amber-400 px-1 text-micro font-bold leading-none text-amber-950",
                      "shadow-[0_0_8px_rgba(251,191,36,0.7)]"
                    )}
                    aria-label={`${badge} new missed calls`}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              {isVertical ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span
                  className={cn(
                    "max-w-full truncate text-micro font-medium leading-none",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              )}
            </span>
            {isVertical ? (
              <span
                className={cn(
                  "pointer-events-none absolute left-[calc(100%+0.65rem)] top-1/2 z-[60] -translate-y-1/2",
                  "whitespace-nowrap rounded-md border border-white/10 bg-neutral-950/90 px-3 py-1 text-xs font-medium text-foreground shadow-lg backdrop-blur-md",
                  "opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
                  "translate-x-1 group-hover:translate-x-0 group-focus-visible:translate-x-0"
                )}
                aria-hidden
              >
                {item.label}
              </span>
            ) : null}
          </>
        )

        if (useLinks) {
          const href = hrefOverrides?.[item.id] ?? DASHBOARD_PAGE_HREF[item.id]
          return (
            <Link
              key={item.id}
              href={href}
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
    </>
  )
})

const CommandDockInner = memo(function CommandDockInner({
  activePage,
  useLinks,
  onNavigate,
}: {
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
}) {
  const engine = useLyncEngineOptional()
  const badgeCounts: Partial<Record<PageId, number>> | undefined =
    engine && engine.activityBadgeCount > 0
      ? { activity: engine.activityBadgeCount }
      : undefined

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 hidden w-[4.25rem] border-r md:flex md:flex-col",
          SHELL_ACRYLIC_SURFACE
        )}
        aria-label="Command dock"
      >
        <nav
          className="relative flex flex-1 flex-col items-center gap-2 px-2 py-4"
          role="navigation"
          aria-label="Main navigation"
        >
          <DockNavItems
            items={dashboardNavItems}
            activePage={activePage}
            useLinks={useLinks}
            onNavigate={onNavigate}
            orientation="vertical"
            badgeCounts={badgeCounts}
          />
        </nav>
      </aside>

      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-border bg-background md:hidden",
          "pb-[env(safe-area-inset-bottom,0px)]"
        )}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="relative flex h-16 w-full items-center justify-around">
          <DockNavItems
            items={mobileBottomNavItems}
            activePage={activePage}
            useLinks={useLinks}
            onNavigate={onNavigate}
            orientation="horizontal"
            hrefOverrides={DASHBOARD_MOBILE_PAGE_HREF}
            badgeCounts={badgeCounts}
          />
        </div>
      </nav>
    </>
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
