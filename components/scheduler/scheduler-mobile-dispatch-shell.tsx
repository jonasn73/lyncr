"use client"

import dynamic from "next/dynamic"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { mergeSchedulerListJobs } from "@/lib/scheduler-upcoming-jobs"
import { Drawer as DrawerPrimitive } from "vaul"
import { ChevronDown, ChevronUp, Clock3, LayoutGrid, Map as MapIcon, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { SCHEDULER_GLASS_CARD, SCHEDULER_MOBILE_SHEET, SCHEDULER_MOBILE_TOOLBAR } from "@/lib/scheduler-ui-tokens"
import { Button } from "@/components/ui/button"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import { DispatchOperationsMetricStrip } from "@/components/scheduler/dispatch-operations-metric-strip"
import { SchedulerDispatchLiveStatus } from "@/components/scheduler/scheduler-dispatch-live-status"
import { formatSchedulerLiveClock, useLiveClock } from "@/lib/hooks/use-live-clock"
import type { SchedulerRouteMapHandle } from "@/components/scheduler-route-map"
import type {
  ActivePipelineJob,
  SchedulerEvent,
  TechLiveLocation,
  UnassignedPoolJob,
} from "@/lib/types"

const MapLoadingSkeleton = () => (
  <div className="absolute inset-0 animate-pulse bg-zinc-950/80" aria-hidden />
)

const SchedulerRouteMap = dynamic(
  () => import("@/components/scheduler-route-map").then((m) => ({ default: m.SchedulerRouteMap })),
  { ssr: false, loading: MapLoadingSkeleton }
)

/** Collapsed peek — handle, day summary, and one upcoming chip. */
const SHEET_PEEK = "11rem"
/** Expanded — most of the shell for the full job list. */
const SHEET_EXPANDED = 0.92

export type SchedulerMobileDispatchShellProps = {
  mapRef: RefObject<SchedulerRouteMapHandle | null>
  dayEvents: SchedulerEvent[]
  activePipelineJobs: ActivePipelineJob[]
  poolJobs: UnassignedPoolJob[]
  techLocations: TechLiveLocation[]
  selectedDayLabel: string
  selectedDay: Date
  highlightId: string | null
  pipelineDayKey: string
  useStreamedPipeline: boolean
  viewMode: "grid" | "map"
  onViewModeChange: (mode: "grid" | "map") => void
  onCreate: () => void
  onFocusJob: (job: ActivePipelineJob) => void
  onEditJob: (job: ActivePipelineJob) => void
  onSelectEvent: (event: SchedulerEvent) => void
  onSelectPoolJob: (job: UnassignedPoolJob | ActivePipelineJob) => void
  onSelectUpcomingJob?: (jobId: string) => void
  onMarkComplete?: (jobId: string) => void
  completingJobId?: string | null
}

/** Mobile dispatch — full-screen map with a slim top toolbar and draggable job sheet. */
export function SchedulerMobileDispatchShell({
  mapRef,
  dayEvents,
  activePipelineJobs,
  poolJobs,
  techLocations,
  selectedDayLabel,
  selectedDay,
  highlightId,
  pipelineDayKey,
  useStreamedPipeline,
  viewMode,
  onViewModeChange,
  onCreate,
  onFocusJob,
  onEditJob,
  onSelectEvent,
  onSelectPoolJob,
  onSelectUpcomingJob,
  onMarkComplete,
  completingJobId,
}: SchedulerMobileDispatchShellProps) {
  const [sheetContainer, setSheetContainer] = useState<HTMLElement | null>(null)
  const [sheetSnap, setSheetSnap] = useState<string | number | null>(SHEET_PEEK)
  const [toolbarExpanded, setToolbarExpanded] = useState(false)
  const autoExpandedRef = useRef(false)
  const now = useLiveClock()
  const clockLabel = formatSchedulerLiveClock(now)
  const isExpanded = sheetSnap === SHEET_EXPANDED
  const poolCount = poolJobs.length
  const listJobs = useMemo(
    () => mergeSchedulerListJobs(activePipelineJobs, poolJobs),
    [activePipelineJobs, poolJobs]
  )
  const jobCount = listJobs.length

  useEffect(() => {
    if (autoExpandedRef.current || jobCount === 0) return
    autoExpandedRef.current = true
    setSheetSnap(SHEET_EXPANDED)
  }, [jobCount])

  useEffect(() => {
    if (poolCount > 0) setToolbarExpanded(true)
  }, [poolCount])

  function handleFocusJob(job: ActivePipelineJob) {
    onFocusJob(job)
    setSheetSnap(SHEET_PEEK)
  }

  return (
    <div
      ref={setSheetContainer}
      className="fixed inset-x-0 top-[var(--shell-header-h)] bottom-[var(--shell-dock-h)] z-[45] flex flex-col overflow-hidden md:hidden"
      data-scheduler-mobile-map=""
    >
      <div className="absolute inset-0 z-0">
        <SchedulerRouteMap
          key="mobile-dispatch-map"
          ref={mapRef}
          events={dayEvents}
          pipelineJobs={activePipelineJobs}
          poolJobs={poolJobs}
          techLocations={techLocations}
          selectedDayLabel={selectedDayLabel}
          highlightId={highlightId}
          routeFocus={null}
          embedded
          mobileFullBleed
          disableHoverTooltips
          onSelectEvent={onSelectEvent}
          onSelectPoolJob={onSelectPoolJob}
        />
      </div>

      {/* Collapsible floating toolbar — collapsed by default for maximum map area. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-2">
        <div className={cn("pointer-events-auto", SCHEDULER_MOBILE_TOOLBAR)}>
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              onClick={() => setToolbarExpanded((open) => !open)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 pl-1 text-left touch-manipulation",
                MOBILE_TAP_TARGET
              )}
              aria-expanded={toolbarExpanded}
              aria-label={toolbarExpanded ? "Collapse dispatch stats" : "Expand dispatch stats"}
            >
              <Clock3 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <time
                dateTime={now.toISOString()}
                className="truncate text-xs font-bold tabular-nums text-zinc-100"
              >
                {clockLabel}
              </time>
              {!toolbarExpanded && poolCount > 0 ? (
                <span className="shrink-0 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                  {poolCount} in pool
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200",
                  toolbarExpanded && "rotate-180"
                )}
                aria-hidden
              />
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <div className={cn("flex rounded-lg p-0.5", SCHEDULER_GLASS_CARD)}>
                <Button
                  type="button"
                  size="icon"
                  variant={viewMode === "map" ? "default" : "ghost"}
                  className={cn("h-9 w-9", MOBILE_TAP_TARGET)}
                  onClick={() => onViewModeChange("map")}
                  aria-label="Map view"
                >
                  <MapIcon className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  className={cn("h-9 w-9", MOBILE_TAP_TARGET)}
                  onClick={() => onViewModeChange("grid")}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button
                type="button"
                size="icon"
                className={cn("h-9 w-9 shrink-0", MOBILE_TAP_TARGET)}
                onClick={onCreate}
                aria-label="Create appointment"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
              toolbarExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="overflow-hidden px-2 pb-2">
              <DispatchOperationsMetricStrip
                embedded
                compact
                poolJobs={poolJobs}
                activePipelineJobs={activePipelineJobs}
                dayEvents={dayEvents}
              />
              {poolCount > 0 ? (
                <button
                  type="button"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100"
                  onClick={() => setSheetSnap(SHEET_EXPANDED)}
                >
                  {poolCount} unassigned job{poolCount === 1 ? "" : "s"} in hopper — tap to assign
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <DrawerPrimitive.Root
        open
        modal={false}
        dismissible={false}
        noBodyStyles
        container={sheetContainer}
        snapPoints={[SHEET_PEEK, SHEET_EXPANDED]}
        activeSnapPoint={sheetSnap}
        setActiveSnapPoint={setSheetSnap}
        fadeFromIndex={0}
      >
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Content
            className={cn(
              "fixed inset-x-0 bottom-[var(--shell-dock-h)] z-[46] flex max-h-[calc(100dvh-var(--shell-dock-h))] flex-col outline-none rounded-t-2xl",
              SCHEDULER_MOBILE_SHEET
            )}
          >
            <DrawerPrimitive.Handle className="flex w-full shrink-0 flex-col items-center gap-1 px-4 pb-1 pt-2.5">
              <div className="h-1 w-10 rounded-full bg-zinc-500" aria-hidden />
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <ChevronUp
                  className={cn("h-3.5 w-3.5 text-primary transition-transform duration-200", isExpanded && "rotate-180")}
                  aria-hidden
                />
                {isExpanded ? "Swipe down for map" : "Swipe up for jobs"}
              </div>
            </DrawerPrimitive.Handle>

            <div className="h-[calc(100vh-220px)] max-h-[calc(100vh-220px)] overflow-y-auto overscroll-y-contain pb-24">
              <div className="shrink-0 border-b border-zinc-800 px-4 pb-3">
                <h2 className="text-base font-semibold text-foreground">
                  {selectedDay.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {jobCount} job{jobCount === 1 ? "" : "s"}
                  {poolCount > 0 ? ` · ${poolCount} unassigned` : ""}
                </p>
                {!isExpanded ? (
                  <div className="mt-2">
                    <SchedulerDispatchLiveStatus
                      upcomingOnly
                      selectedDay={selectedDay}
                      poolJobs={poolJobs}
                      activePipelineJobs={activePipelineJobs}
                      dayEvents={dayEvents}
                      onSelectJob={(jobId) => {
                        onSelectUpcomingJob?.(jobId)
                        setSheetSnap(SHEET_EXPANDED)
                      }}
                      onMarkComplete={onMarkComplete}
                      completingJobId={completingJobId}
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 px-4 pt-2">
                <ActivePipelinePanelStream
                  jobs={listJobs}
                  dayKey={pipelineDayKey}
                  useStreamedInitialDay={useStreamedPipeline}
                  highlightId={highlightId}
                  onFocusJob={handleFocusJob}
                  onEditJob={onEditJob}
                  onMarkComplete={onMarkComplete}
                  completingJobId={completingJobId}
                  layout="mobileSheet"
                />
              </div>
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </div>
  )
}
