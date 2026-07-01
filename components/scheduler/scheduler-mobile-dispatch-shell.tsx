"use client"

import dynamic from "next/dynamic"
import { type RefObject, useState } from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import { ChevronUp, LayoutGrid, Map as MapIcon, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { Button } from "@/components/ui/button"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import { DispatchOperationsMetricStrip } from "@/components/scheduler/dispatch-operations-metric-strip"
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

/** Collapsed peek — pixels from bottom; shows handle, date, and swipe hint. */
const SHEET_PEEK = "220px"
/** Expanded — fraction of the shell height (not viewport). */
const SHEET_EXPANDED = 0.88

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
}

/** Mobile dispatch — full-bleed map with a draggable bottom sheet for the job list. */
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
}: SchedulerMobileDispatchShellProps) {
  const [sheetContainer, setSheetContainer] = useState<HTMLElement | null>(null)
  const [sheetSnap, setSheetSnap] = useState<string | number | null>(SHEET_PEEK)
  const isExpanded = sheetSnap === SHEET_EXPANDED
  const jobCount = activePipelineJobs.length
  const poolCount = poolJobs.length

  return (
    <div
      ref={setSheetContainer}
      className="fixed inset-x-0 top-[var(--shell-header-h)] bottom-[var(--shell-dock-h)] z-[45] flex flex-col overflow-hidden md:hidden"
      data-scheduler-mobile-map=""
      style={{ ["--scheduler-chrome-h" as string]: "9.25rem" }}
    >
      {/* Map fills the shell; chrome and sheet float above it. */}
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

      {/* Single top card — title, view toggle, and metrics in one stack (no overlap). */}
      <div className="pointer-events-none relative z-20 shrink-0 px-2 pt-2">
        <div className="pointer-events-auto overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/92 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2 border-b border-zinc-800/70 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Dispatch</p>
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">Scheduler</h1>
            </div>
            <div className="flex shrink-0 rounded-lg border border-border/70 bg-zinc-900/80 p-0.5">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "map" ? "default" : "ghost"}
                className={cn("h-9 gap-1 px-2.5 text-xs", MOBILE_TAP_TARGET)}
                onClick={() => onViewModeChange("map")}
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden />
                Map
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "grid" ? "default" : "ghost"}
                className={cn("h-9 gap-1 px-2.5 text-xs", MOBILE_TAP_TARGET)}
                onClick={() => onViewModeChange("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                Grid
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              className={cn("h-9 shrink-0 gap-1 px-2.5", MOBILE_TAP_TARGET)}
              onClick={onCreate}
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Create</span>
            </Button>
          </div>
          <DispatchOperationsMetricStrip
            embedded
            poolJobs={poolJobs}
            activePipelineJobs={activePipelineJobs}
            dayEvents={dayEvents}
            className="w-full"
          />
        </div>
      </div>

      {/* Bottom sheet — rendered inside the shell (no portal) so it sits above the nav, not under it. */}
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
              "fixed inset-x-0 bottom-0 z-[46] flex flex-col outline-none",
              "border-t border-zinc-700/80 bg-zinc-950/98 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md",
              "rounded-t-2xl"
            )}
          >
            <DrawerPrimitive.Handle className="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 pb-1 pt-3">
              <div className="h-1.5 w-12 rounded-full bg-zinc-500" aria-hidden />
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <ChevronUp
                  className={cn("h-4 w-4 transition-transform duration-200", isExpanded && "rotate-180")}
                  aria-hidden
                />
                {isExpanded ? "Pull down for map" : "Pull up for jobs"}
              </div>
            </DrawerPrimitive.Handle>

            <div className="shrink-0 border-b border-zinc-800 px-4 pb-3">
              <h2 className="text-base font-semibold text-foreground">
                {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {jobCount} active job{jobCount === 1 ? "" : "s"}
                {poolCount > 0 ? ` · ${poolCount} in hopper` : ""}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain px-4 pb-4 pt-2">
              <ActivePipelinePanelStream
                jobs={activePipelineJobs}
                dayKey={pipelineDayKey}
                useStreamedInitialDay={useStreamedPipeline}
                highlightId={highlightId}
                onFocusJob={onFocusJob}
                onEditJob={onEditJob}
                layout="mobileSheet"
              />
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </div>
  )
}
