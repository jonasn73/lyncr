"use client"

// Unified Dispatch Map tab — one Leaflet map + layer toggles + Job Pool / Live Roster drawer.

import { useCallback, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  MapPin,
  UsersRound,
} from "lucide-react"
import { TeamLiveRoster } from "@/components/workspace-views/team-live-roster"
import type { DispatchMapLayers } from "@/components/workspace-views/dispatch-live-map"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useJobPoolQuery } from "@/lib/hooks/use-job-pool-query"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { cn } from "@/lib/utils"

// Load Leaflet only in the browser (needs window / DOM).
const DispatchLiveMap = dynamic(
  () =>
    import("@/components/workspace-views/dispatch-live-map").then((m) => ({
      default: m.DispatchLiveMap,
    })),
  { ssr: false }
)

// Which side-panel list is open in the drawer.
type DrawerTab = "pool" | "roster"

// Default layer visibility for the unified map.
const INITIAL_LAYERS: DispatchMapLayers = {
  jobs: true,
  techs: true,
  you: true,
  leads: false,
}

export function MapTab() {
  // Active org scopes the hopper Job Pool list.
  const { activeOrganizationId } = useDashboardWorkspace()

  // Layer toggles (Show Techs / Jobs / Leads / You).
  const [layers, setLayers] = useState<DispatchMapLayers>(INITIAL_LAYERS)

  // Drawer open/closed on smaller screens; open by default on desktop-width.
  const [drawerOpen, setDrawerOpen] = useState(true)

  // Job Pool vs Live Roster inside the drawer.
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("pool")

  // When the user taps a Job Pool row, pan the map to that pin.
  const [focusJobId, setFocusJobId] = useState<string | null>(null)

  // Unassigned / hopper jobs for the Job Pool list.
  const { jobs: poolJobs, isLoading: poolLoading } = useJobPoolQuery(activeOrganizationId)

  // Flip one layer on/off without touching the others.
  const toggleLayer = useCallback((key: keyof DispatchMapLayers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  // Clear focus after the map consumes it (avoids re-panning every render).
  const onFocusJobConsumed = useCallback(() => {
    setFocusJobId(null)
  }, [])

  // Rows with coords first so “center on pin” works for most clicks.
  const sortedPool = useMemo(() => {
    return [...poolJobs].sort((a, b) => {
      const aPin = coerceMapCoord(a.latitude) != null && coerceMapCoord(a.longitude) != null
      const bPin = coerceMapCoord(b.latitude) != null && coerceMapCoord(b.longitude) != null
      if (aPin === bPin) return 0
      return aPin ? -1 : 1
    })
  }, [poolJobs])

  return (
    <div className="relative flex h-[calc(100dvh-7.5rem)] min-h-[28rem] w-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 sm:h-[calc(100dvh-6.5rem)]">
      {/* Page title strip above the map canvas */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/80 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
            Dispatch Map
          </h1>
          <p className="truncate text-[11px] text-slate-500 sm:text-xs">
            Jobs, techs, and your location — one map for dispatch.
          </p>
        </div>
        {/* Open / close the Job Pool + Roster drawer */}
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
          aria-expanded={drawerOpen}
          aria-controls="dispatch-map-drawer"
        >
          {drawerOpen ? (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          )}
          {drawerOpen ? "Hide panel" : "Job Pool & Roster"}
        </button>
      </header>

      {/* Map + overlays fill the rest of the tab */}
      <div className="relative min-h-0 flex-1">
        <DispatchLiveMap
          fillParent
          hideChrome
          layers={layers}
          focusJobId={focusJobId}
          onFocusJobConsumed={onFocusJobConsumed}
          className="absolute inset-0 h-full w-full"
        />

        {/* Layer toggle bar — top-left over the map */}
        <div
          className="pointer-events-auto absolute left-2 top-2 z-[2000] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-xl border border-zinc-700/80 bg-slate-950/90 p-1.5 shadow-lg backdrop-blur sm:left-3 sm:top-3"
          role="group"
          aria-label="Map layers"
        >
          <span className="hidden items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:inline-flex">
            <Layers className="h-3 w-3" aria-hidden />
            Layers
          </span>
          {(
            [
              { key: "jobs" as const, label: "Show Jobs" },
              { key: "techs" as const, label: "Show Techs" },
              { key: "leads" as const, label: "Show Leads" },
              { key: "you" as const, label: "Show You" },
            ] as const
          ).map(({ key, label }) => {
            const on = layers[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLayer(key)}
                aria-pressed={on}
                className={cn(
                  "rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors",
                  on
                    ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40"
                    : "bg-zinc-900/80 text-slate-500 ring-1 ring-zinc-800 hover:text-slate-300"
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Collapsible side drawer: Job Pool + Live Roster */}
        <aside
          id="dispatch-map-drawer"
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 top-0 z-[2000] flex w-[min(22rem,100%)] flex-col border-l border-zinc-800 bg-slate-950/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out",
            drawerOpen ? "translate-x-0" : "translate-x-full"
          )}
          aria-hidden={!drawerOpen}
        >
          {/* Drawer tab switcher */}
          <div className="flex shrink-0 border-b border-zinc-800 p-1.5">
            <button
              type="button"
              onClick={() => setDrawerTab("pool")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                drawerTab === "pool"
                  ? "bg-zinc-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
              Job Pool
            </button>
            <button
              type="button"
              onClick={() => setDrawerTab("roster")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                drawerTab === "roster"
                  ? "bg-zinc-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <UsersRound className="h-3.5 w-3.5" aria-hidden />
              Live Roster
            </button>
          </div>

          {/* Scrollable list body */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {drawerTab === "pool" ? (
              <div className="p-2">
                <p className="mb-2 px-1 text-[11px] text-slate-500">
                  Tap a job to center its pin on the map.
                </p>
                {poolLoading && sortedPool.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Loading job pool…
                  </div>
                ) : sortedPool.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-slate-500">
                    No unassigned jobs in the pool right now.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {sortedPool.map((job) => {
                      const hasPin =
                        coerceMapCoord(job.latitude) != null &&
                        coerceMapCoord(job.longitude) != null
                      const title =
                        (job.customer_name ?? "").trim() ||
                        (job.summary ?? "").trim() ||
                        "Open job"
                      const place =
                        (job.neighborhood ?? "").trim() ||
                        (job.location ?? "").trim() ||
                        "No address"
                      return (
                        <li key={job.id}>
                          <button
                            type="button"
                            disabled={!hasPin}
                            onClick={() => {
                              if (!hasPin) return
                              // Ensure job pins are visible when focusing from the pool.
                              setLayers((prev) => ({ ...prev, jobs: true }))
                              setFocusJobId(job.id)
                            }}
                            className={cn(
                              "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                              hasPin
                                ? "border-zinc-800 bg-zinc-900/60 hover:border-sky-500/40 hover:bg-zinc-900"
                                : "cursor-not-allowed border-zinc-900 bg-zinc-950/40 opacity-60"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-slate-100">
                                {title}
                              </span>
                              {hasPin ? (
                                <MapPin
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400"
                                  aria-hidden
                                />
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{place}</p>
                            {!hasPin ? (
                              <p className="mt-1 text-[10px] text-amber-500/80">
                                Needs address to pin
                              </p>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ) : (
              // Reuse the same Live Roster used on Team — compact in the drawer.
              <TeamLiveRoster className="rounded-none border-0 bg-transparent" />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
