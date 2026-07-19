"use client"

// Full-viewport operational dispatch map for the Map bottom-nav tab.

import { memo } from "react"
import { DispatchLiveMap } from "@/components/workspace-views/dispatch-live-map"
import { TeamLiveRoster } from "@/components/workspace-views/team-live-roster"
import { FieldTechniciansPanel } from "@/components/workspace-views/field-technicians-panel"
import { cn } from "@/lib/utils"

export const MapWorkspaceView = memo(function MapWorkspaceView() {
  return (
    <div className="flex w-full flex-col gap-4 pb-4">
      <header className="px-1">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">Dispatch Map</h1>
        <p className="text-xs text-slate-500">
          Your live location, closest unassigned jobs, tech GPS, and intake pins.
        </p>
      </header>

      <DispatchLiveMap fullViewport className="mb-0" />

      <div className={cn("grid gap-4 lg:grid-cols-2")}>
        <TeamLiveRoster />
        <FieldTechniciansPanel />
      </div>
    </div>
  )
})
