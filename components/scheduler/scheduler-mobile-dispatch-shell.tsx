"use client"

import dynamic from "next/dynamic"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { mergeSchedulerListJobs } from "@/lib/scheduler-upcoming-jobs"
import { Drawer as DrawerPrimitive } from "vaul"
import { ChevronUp, LayoutGrid, Map as MapIcon, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { Button } from "@/components/ui/button"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import { SchedulerDispatchLiveStatus } from "@/components/scheduler/scheduler-dispatch-live-status"
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
  const autoExpandedRef = useRef(false)
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

      {/* Slim floating toolbar — clock + metrics, does not cover the whole map. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-2">
        <div className="pointer-events-auto rounded-2xl border border-zinc-800/70 bg-zinc-950/88 p-2 shadow-lg backdrop-blur-md">
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SchedulerDispatchLiveStatus
                embedded
                compact
                selectedDay={selectedDay}
                poolJobs={poolJobs}
                activePipelineJobs={activePipelineJobs}
                dayEvents={dayEvents}
                className="w-full"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex rounded-lg border border-border/70 bg-zinc-900/80 p-0.5">
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
          {poolCount > 0 ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100"
              onClick={() => setSheetSnap(SHEET_EXPANDED)}
            >
              {poolCount} unassigned job{poolCount === 1 ? "" : "s"} in hopper — tap to assign
            </button>
          ) : null}
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
              "fixed inset-x-0 bottom-[var(--shell-dock-h)] z-[46] flex max-h-[calc(100dvh-var(--shell-dock-h))] flex-col outline-none",
              "border-t border-zinc-700/80 bg-zinc-950/98 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md",
              "rounded-t-2xl"
            )}
          >
            <DrawerPrimitive.Handle className="flex w-full shrink-0 flex-col items-center gap-1 px-4 pb-1 pt-2.5">
              <div className="h-1 w-10 rounded-full bg-zinc-500" aria-hidden />
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
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
