"use client"

// Unified Dispatch Map — full-bleed map; desktop side drawer; mobile bottom sheet.

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
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

// Which list is open in the drawer / bottom sheet.
type DrawerTab = "pool" | "roster"

// Default layer visibility for the unified map.
const INITIAL_LAYERS: DispatchMapLayers = {
  jobs: true,
  techs: true,
  you: true,
  leads: false,
}

// Short labels so chips fit on a phone without wrapping into the sheet.
const LAYER_TOGGLES = [
  { key: "jobs" as const, short: "Jobs", long: "Show Jobs" },
  { key: "techs" as const, short: "Techs", long: "Show Techs" },
  { key: "leads" as const, short: "Leads", long: "Show Leads" },
  { key: "you" as const, short: "You", long: "Show You" },
] as const

export function MapTab() {
  // Active org scopes the hopper Job Pool list.
  const { activeOrganizationId } = useDashboardWorkspace()

  // Layer toggles (Jobs / Techs / Leads / You).
  const [layers, setLayers] = useState<DispatchMapLayers>(INITIAL_LAYERS)

  // Start closed — phones must see the map first. Desktop opens via effect below.
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Job Pool vs Live Roster.
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("pool")

  // When the user taps a Job Pool row, pan the map to that pin.
  const [focusJobId, setFocusJobId] = useState<string | null>(null)

  // Unassigned / hopper jobs for the Job Pool list.
  const { jobs: poolJobs, isLoading: poolLoading } = useJobPoolQuery(activeOrganizationId)

  // Desktop: open side panel. Phone: keep the map clear (bottom sheet stays closed).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const sync = () => setDrawerOpen(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

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

  // Shared Job Pool / Roster list body (used by bottom sheet + side drawer).
  const panelBody = (
    <>
      <div className="flex shrink-0 gap-1 border-b border-zinc-800 p-1.5">
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
          {sortedPool.length > 0 ? (
            <span className="tabular-nums text-[10px] text-slate-400">({sortedPool.length})</span>
          ) : null}
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {drawerTab === "pool" ? (
          <div className="p-2">
            <p className="mb-2 px-1 text-[11px] text-slate-500">
              Tap a job to center its pin on the map.
            </p>
            {poolLoading && sortedPool.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading job pool…
              </div>
            ) : sortedPool.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-slate-500">
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
                          setLayers((prev) => ({ ...prev, jobs: true }))
                          setFocusJobId(job.id)
                          // On phones, peek the map after focusing a pin.
                          if (
                            typeof window !== "undefined" &&
                            window.matchMedia("(max-width: 767px)").matches
                          ) {
                            setDrawerOpen(false)
                          }
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
                          <p className="mt-1 text-[10px] text-amber-500/80">Needs address to pin</p>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <TeamLiveRoster className="rounded-none border-0 bg-transparent" />
        )}
      </div>
    </>
  )

  return (
    <div
      className={cn(
        // Fill the tab area above the bottom dock; avoid floating card over the nav.
        "relative flex w-full flex-col overflow-hidden bg-zinc-950",
        "h-[calc(100dvh-8.75rem)] min-h-[22rem]",
        "sm:h-[calc(100dvh-6.5rem)] sm:min-h-[28rem] sm:rounded-xl sm:border sm:border-zinc-800"
      )}
    >
      {/* Compact header */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
            Dispatch Map
          </h1>
          <p className="hidden truncate text-xs text-slate-500 sm:block">
            Jobs, techs, and your location — one map for dispatch.
          </p>
        </div>
        {/* Desktop-only panel toggle (phones use the bottom sheet handle). */}
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 md:inline-flex"
          aria-expanded={drawerOpen}
          aria-controls="dispatch-map-drawer"
        >
          {drawerOpen ? "Hide panel" : "Job Pool & Roster"}
        </button>
      </header>

      {/* Map fills remaining space; overlays sit on top */}
      <div className="relative min-h-0 flex-1">
        <DispatchLiveMap
          fillParent
          hideChrome
          layers={layers}
          focusJobId={focusJobId}
          onFocusJobConsumed={onFocusJobConsumed}
          className="absolute inset-0 h-full w-full"
        />

        {/* Layer chips — keep them above the bottom sheet on mobile */}
        <div
          className={cn(
            "pointer-events-auto absolute left-2 right-2 z-[2000] flex flex-wrap items-center gap-1 rounded-xl border border-zinc-700/80 bg-slate-950/90 p-1.5 shadow-lg backdrop-blur",
            // Sit under the top edge; when sheet is open leave room above it.
            drawerOpen ? "bottom-[min(46dvh,20rem)] top-auto md:bottom-auto md:top-3" : "top-2",
            "md:left-3 md:right-auto md:top-3 md:max-w-none"
          )}
          role="group"
          aria-label="Map layers"
        >
          <span className="hidden items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:inline-flex">
            <Layers className="h-3 w-3" aria-hidden />
            Layers
          </span>
          {LAYER_TOGGLES.map(({ key, short, long }) => {
            const on = layers[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLayer(key)}
                aria-pressed={on}
                aria-label={long}
                className={cn(
                  "rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors",
                  on
                    ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40"
                    : "bg-zinc-900/80 text-slate-500 ring-1 ring-zinc-800 hover:text-slate-300"
                )}
              >
                <span className="md:hidden">{short}</span>
                <span className="hidden md:inline">{long}</span>
              </button>
            )
          })}
        </div>

        {/* —— Mobile: bottom sheet (map stays full width above) —— */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2100] flex flex-col md:hidden">
          {/* Collapsed grabber when sheet is closed */}
          {!drawerOpen ? (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="pointer-events-auto mx-auto mb-2 flex items-center gap-1.5 rounded-full border border-zinc-700 bg-slate-950/95 px-4 py-2 text-xs font-semibold text-slate-100 shadow-lg backdrop-blur"
              aria-expanded={false}
              aria-controls="dispatch-map-sheet"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              Job Pool & Roster
              {sortedPool.length > 0 ? (
                <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] tabular-nums text-rose-300">
                  {sortedPool.length}
                </span>
              ) : null}
            </button>
          ) : null}

          <aside
            id="dispatch-map-sheet"
            className={cn(
              "pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-2xl border border-zinc-800 border-b-0 bg-slate-950/98 shadow-2xl backdrop-blur transition-transform duration-200 ease-out",
              // Cap height so most of the map stays visible.
              "max-h-[min(46dvh,22rem)]",
              drawerOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
            )}
            aria-hidden={!drawerOpen}
            inert={!drawerOpen ? true : undefined}
          >
            <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-800 px-3 py-2">
              <div className="h-1 w-10 rounded-full bg-zinc-700" aria-hidden />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-zinc-900 hover:text-slate-200"
                aria-label="Close job pool panel"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                Close
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{panelBody}</div>
          </aside>
        </div>

        {/* —— Desktop: side drawer (never 100% width) —— */}
        <aside
          id="dispatch-map-drawer"
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 top-0 z-[2000] hidden w-80 max-w-[40%] flex-col border-l border-zinc-800 bg-slate-950/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out md:flex",
            drawerOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
          )}
          aria-hidden={!drawerOpen}
          inert={!drawerOpen ? true : undefined}
        >
          {panelBody}
        </aside>
      </div>
    </div>
  )
}
