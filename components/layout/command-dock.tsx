"use client"

import Link from "next/link"
import { memo, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from "react"
import { cn } from "@/lib/utils"
import {
  DASHBOARD_PAGE_HREF,
  dashboardNavItems,
  mobileBottomNavItems,
  type DashboardNavItem,
  type PageId,
} from "@/lib/dashboard-nav"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import { COMMAND_DOCK_ACCENT, SHELL_ACRYLIC_SURFACE } from "@/lib/shell-chrome-styles"

type DockOrientation = "vertical" | "horizontal"

type DockIndicator = {
  offset: number
  size: number
  visible: boolean
}

function useDockIndicator(
  navRef: RefObject<HTMLElement | null>,
  itemRefs: MutableRefObject<(HTMLAnchorElement | HTMLButtonElement | null)[]>,
  activePage: PageId,
  orientation: DockOrientation,
  items: DashboardNavItem[]
) {
  const [indicator, setIndicator] = useState<DockIndicator>({ offset: 0, size: 44, visible: true })

  useLayoutEffect(() => {
    const idx = items.findIndex((item) => item.id === activePage)
    const el = itemRefs.current[idx]
    const nav = navRef.current
    if (!el || !nav || idx < 0) {
      setIndicator((prev) => ({ ...prev, visible: false }))
      return
    }
    const navRect = nav.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (orientation === "vertical") {
      setIndicator({
        offset: elRect.top - navRect.top,
        size: elRect.height,
        visible: true,
      })
      return
    }
    setIndicator({
      offset: elRect.left - navRect.left,
      size: elRect.width,
      visible: true,
    })
  }, [activePage, itemRefs, items, navRef, orientation])

  return indicator
}

const DockNavItems = memo(function DockNavItems({
  items,
  activePage,
  useLinks,
  onNavigate,
  orientation,
  navRef,
  itemRefs,
}: {
  items: DashboardNavItem[]
  activePage: PageId
  useLinks: boolean
  onNavigate?: (page: PageId) => void
  orientation: DockOrientation
  navRef: RefObject<HTMLElement | null>
  itemRefs: MutableRefObject<(HTMLAnchorElement | HTMLButtonElement | null)[]>
}) {
  const isVertical = orientation === "vertical"
  const indicator = useDockIndicator(navRef, itemRefs, activePage, orientation, items)

  return (
    <>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute rounded-full transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          COMMAND_DOCK_ACCENT,
          isVertical ? "left-0 w-0.5" : "top-0 h-0.5",
          indicator.visible ? "opacity-100" : "opacity-0"
        )}
        style={
          isVertical
            ? { transform: `translateY(${indicator.offset}px)`, height: indicator.size }
            : { transform: `translateX(${indicator.offset}px)`, width: indicator.size }
        }
      />

      {items.map((item, index) => {
        const Icon = item.icon
        const isActive = activePage === item.id
        const className = cn(
          "group relative flex shrink-0 items-center justify-center rounded-xl",
          "transition-[background-color,color,transform,box-shadow] duration-200 ease-out",
          "motion-safe:active:scale-[0.96]",
          isVertical
            ? "h-11 w-11 flex-col"
            : "min-h-11 min-w-[4.5rem] flex-col gap-0.5 px-2 py-1.5",
          isActive
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
        )
        const inner = (
          <>
            <Icon
              className={cn(
                "shrink-0 transition-transform duration-200",
                isVertical ? "h-[1.35rem] w-[1.35rem]" : "h-5 w-5",
                isActive && "scale-105"
              )}
              aria-hidden
            />
            {isVertical ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span
                className={cn(
                  "max-w-full truncate text-[10px] font-medium leading-none",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
            )}
            {isVertical ? (
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
            ) : null}
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
  const desktopNavRef = useRef<HTMLElement>(null)
  const mobileNavRef = useRef<HTMLElement>(null)
  const desktopItemRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([])
  const mobileItemRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([])

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
          ref={desktopNavRef}
          className="relative flex flex-1 flex-col items-center gap-1.5 px-2 py-4"
          role="navigation"
          aria-label="Main navigation"
        >
          <DockNavItems
            items={dashboardNavItems}
            activePage={activePage}
            useLinks={useLinks}
            onNavigate={onNavigate}
            orientation="vertical"
            navRef={desktopNavRef}
            itemRefs={desktopItemRefs}
          />
        </nav>
      </aside>

      <nav
        ref={mobileNavRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-zinc-900 bg-zinc-950 md:hidden",
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
            navRef={mobileNavRef}
            itemRefs={mobileItemRefs}
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
