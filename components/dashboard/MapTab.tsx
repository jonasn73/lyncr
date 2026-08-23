"use client"

// Unified Dispatch Map — full-bleed map; desktop side drawer; mobile bottom sheet.

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Layers,
  MapPin,
  UsersRound,
} from "lucide-react"
import { TeamLiveRoster } from "@/components/workspace-views/team-live-roster"
import type { DispatchMapLayers } from "@/components/workspace-views/dispatch-live-map"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { IntakeMapDestinationBanner } from "@/components/dashboard/intake-map-destination-banner"
import {
  clearActiveDispatchMapDestination,
  emitReturnToIntakeFromMap,
  getActiveDispatchMapDestination,
  LYNCR_CLEAR_DISPATCH_MAP_DESTINATION_EVENT,
  LYNCR_FOCUS_DISPATCH_MAP_EVENT,
  type FocusDispatchMapDetail,
} from "@/lib/dispatch-map-focus"
import { useIntakeDestinationTravel } from "@/lib/hooks/use-intake-destination-travel"
import { useJobPoolQuery } from "@/lib/hooks/use-job-pool-query"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { cn } from "@/lib/utils"

// Load Leaflet only in the browser (needs window / DOM). MapTab chrome SSRs around this.
const DispatchLiveMap = dynamic(
  () =>
    import("@/components/workspace-views/dispatch-live-map").then((m) => ({
      default: m.DispatchLiveMap,
    })),
  {
    ssr: false,
    // Parent MapTab already paints the well — null avoids a second flash layer.
    loading: () => null,
  }
)

/** Shared chrome for the two pool toggles (sheet on mobile+tablet, drawer on lg+). */
const POOL_TOGGLE_CLASS =
  "shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800"

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

export function MapTab({ isActive = true }: { isActive?: boolean }) {
  // Active org scopes the hopper Job Pool list.
  const { activeOrganizationId } = useDashboardWorkspace()
  // Pause Map/hopper polls when this presence pane or the browser tab is hidden.
  const pollEnabled = usePollBudget(isActive)

  // Layer toggles (Jobs / Techs / Leads / You).
  const [layers, setLayers] = useState<DispatchMapLayers>(INITIAL_LAYERS)

  // CSS defaults: phones closed, desktop open — never snap with a mount effect.
  const [mobilePoolOpen, setMobilePoolOpen] = useState(false)
  const [desktopPoolCollapsed, setDesktopPoolCollapsed] = useState(false)

  // Job Pool vs Live Roster.
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("pool")

  // When the user taps a Job Pool row, pan the map to that pin.
  const [focusJobId, setFocusJobId] = useState<string | null>(null)

  // Intake "View on Map Layout" — rich Return card lives in Map chrome (Leaflet buries on-map UI).
  const [intakeDestination, setIntakeDestination] = useState<FocusDispatchMapDetail | null>(null)
  useEffect(() => {
    const sync = () => setIntakeDestination(getActiveDispatchMapDestination())
    sync()
    window.addEventListener(LYNCR_FOCUS_DISPATCH_MAP_EVENT, sync)
    window.addEventListener(LYNCR_CLEAR_DISPATCH_MAP_DESTINATION_EVENT, sync)
    return () => {
      window.removeEventListener(LYNCR_FOCUS_DISPATCH_MAP_EVENT, sync)
      window.removeEventListener(LYNCR_CLEAR_DISPATCH_MAP_DESTINATION_EVENT, sync)
    }
  }, [])

  // ETA / address / nearest tech for the chrome banner (same math as the old map overlay).
  const { travelMetrics, nearestTech } = useIntakeDestinationTravel(
    intakeDestination,
    activeOrganizationId,
    { enabled: pollEnabled || Boolean(intakeDestination) }
  )

  // Unassigned / hopper jobs for the Job Pool list — paused off-tab.
  const { jobs: poolJobs, isLoading: poolLoading } = useJobPoolQuery(
    activeOrganizationId,
    pollEnabled
  )

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
            <p className="mb-2 hidden px-1 text-[11px] text-slate-500 lg:block">
              Tap a job to center its pin on the map.
            </p>
            {sortedPool.length === 0 ? (
              poolLoading ? (
                <div className="min-h-[6rem] rounded-lg" aria-busy="true" aria-label="Loading jobs" />
              ) : (
                <p className="px-2 py-6 text-center text-sm text-slate-500">
                  No unassigned jobs in the pool right now.
                </p>
              )
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
                            window.matchMedia("(max-width: 1023px)").matches
                          ) {
                            setMobilePoolOpen(false)
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
          <TeamLiveRoster
            className="rounded-none border-0 bg-transparent"
            isActive={pollEnabled && drawerTab === "roster"}
          />
        )}
      </div>
    </>
  )

  return (
    <div
      className={cn(
        // Fill the tab area above the bottom dock; avoid floating card over the nav.
        "relative flex w-full flex-col overflow-hidden bg-background",
        "h-[calc(100dvh-8.75rem)] min-h-[22rem]",
        "sm:h-[calc(100dvh-6.5rem)] sm:min-h-[28rem] sm:rounded-xl sm:border sm:border-zinc-800"
      )}
    >
      {/* Compact header — layer chips live here so Leaflet panes can’t bury them after load */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-zinc-800/80 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg">
              Dispatch Map
            </h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">
              Jobs, techs, and your location — one map for dispatch.
            </p>
          </div>
          {/* Two CSS-gated buttons rather than one that branches on matchMedia: each owns the
              panel it actually controls, so aria-expanded is always truthful and the
              sheet/drawer boundary lives only in Tailwind (one place to change). */}
          <button
            type="button"
            onClick={() => setMobilePoolOpen((o) => !o)}
            className={cn(POOL_TOGGLE_CLASS, "inline-flex lg:hidden")}
            aria-expanded={mobilePoolOpen}
            aria-controls="dispatch-map-sheet"
          >
            {mobilePoolOpen ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                Close
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                Pool
                {sortedPool.length > 0 ? (
                  <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] tabular-nums text-rose-300">
                    {sortedPool.length}
                  </span>
                ) : null}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setDesktopPoolCollapsed((c) => !c)}
            className={cn(POOL_TOGGLE_CLASS, "hidden lg:inline-flex")}
            aria-expanded={!desktopPoolCollapsed}
            aria-controls="dispatch-map-drawer"
          >
            {desktopPoolCollapsed ? (
              <>
                Job Pool &amp; Roster
                {sortedPool.length > 0 ? (
                  <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] tabular-nums text-rose-300">
                    {sortedPool.length}
                  </span>
                ) : null}
              </>
            ) : (
              "Hide panel"
            )}
          </button>
        </div>
        {/* Jobs / Techs / Leads / You — in chrome, not over the map (Leaflet z-index was hiding them). */}
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Map layers"
        >
          <span className="inline-flex items-center gap-1 pr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
                  "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                  on
                    ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40"
                    : "bg-zinc-900/80 text-slate-500 ring-1 ring-zinc-800 hover:text-slate-300"
                )}
              >
                <span className="lg:hidden">{short}</span>
                <span className="hidden lg:inline">{long}</span>
              </button>
            )
          })}
        </div>
        {intakeDestination ? (
          <IntakeMapDestinationBanner
            variant="chrome"
            destination={intakeDestination}
            travelMetrics={travelMetrics}
            nearestTech={nearestTech}
            onClear={() => clearActiveDispatchMapDestination()}
            onReturn={() => emitReturnToIntakeFromMap()}
          />
        ) : null}
      </header>

      {/* Map fills remaining space; isolate so Leaflet panes stay under our overlays */}
      <div className="relative z-0 min-h-0 flex-1 isolate bg-background">
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_30%_40%,rgba(39,39,42,0.45),transparent_55%)]"
          aria-hidden
        />
        <DispatchLiveMap
          fillParent
          hideChrome
          layers={layers}
          focusJobId={focusJobId}
          onFocusJobConsumed={onFocusJobConsumed}
          pollEnabled={pollEnabled}
          className="absolute inset-0 z-0 h-full w-full"
        />

        {/* —— Mobile + tablet: bottom sheet (opened from header “Pool” button) —— */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[30] flex flex-col lg:hidden">
          <aside
            id="dispatch-map-sheet"
            className={cn(
              "pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-2xl border border-zinc-800 border-b-0 bg-slate-950/98 shadow-2xl backdrop-blur transition-transform duration-200 ease-out",
              // Cap height so most of the map stays visible.
              "max-h-[min(46dvh,22rem)]",
              mobilePoolOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
            )}
            aria-hidden={!mobilePoolOpen}
            inert={!mobilePoolOpen ? true : undefined}
          >
            <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-800 px-3 py-2">
              <div className="h-1 w-10 rounded-full bg-zinc-700" aria-hidden />
              <button
                type="button"
                onClick={() => setMobilePoolOpen(false)}
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

        {/* —— Desktop (lg+): side drawer — below 1024px it ate 40% of the map. —— */}
        <aside
          id="dispatch-map-drawer"
          className={cn(
            "pointer-events-auto absolute bottom-0 right-0 top-0 z-[30] hidden w-80 max-w-[40%] flex-col border-l border-zinc-800 bg-slate-950/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out lg:flex",
            // Open on desktop from CSS — no useEffect snap from full-bleed to sidebar.
            desktopPoolCollapsed
              ? "pointer-events-none translate-x-full"
              : "translate-x-0"
          )}
          aria-hidden={desktopPoolCollapsed}
          inert={desktopPoolCollapsed ? true : undefined}
        >
          {panelBody}
        </aside>
      </div>
    </div>
  )
}
