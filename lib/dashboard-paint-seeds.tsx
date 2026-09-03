/**
 * Request-safe SSR paint seeds for hard refresh (React context).
 *
 * Cookies mirror last-known session values; the layout reads them and this
 * provider passes them down. No module singleton — that leaked across SSR requests.
 */

"use client"

import { createContext, useContext, type ReactNode } from "react"
import {
  EMPTY_DASHBOARD_PAINT_SEEDS,
  type DashboardPaintSeeds,
} from "@/lib/dashboard-paint-seeds-types"

export type { DashboardPaintSeeds }

const DashboardPaintSeedsContext = createContext<DashboardPaintSeeds>(EMPTY_DASHBOARD_PAINT_SEEDS)

/** Install cookie-backed seeds for the dashboard tree (SSR + hydrate). */
export function DashboardPaintSeedsProvider({
  seeds,
  children,
}: {
  seeds: DashboardPaintSeeds | null | undefined
  children: ReactNode
}) {
  const value = seeds ?? EMPTY_DASHBOARD_PAINT_SEEDS
  return (
    <DashboardPaintSeedsContext.Provider value={value}>{children}</DashboardPaintSeedsContext.Provider>
  )
}

/** Read paint seeds from the nearest provider (empty outside the dashboard shell). */
export function useDashboardPaintSeeds(): DashboardPaintSeeds {
  return useContext(DashboardPaintSeedsContext)
}
