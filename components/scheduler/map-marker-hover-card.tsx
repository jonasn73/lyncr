"use client"

// Optional React hover card — dispatch map uses native Leaflet tooltips for performance.

import { cn } from "@/lib/utils"
import { formatMapPhone, type MapMarkerTooltipModel } from "@/lib/scheduler-map-markers"
import { SCHEDULER_FIELD_STACK, SCHEDULER_MAP_TOOLTIP, SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"

type MapMarkerHoverCardProps = {
  model: MapMarkerTooltipModel
  x: number
  y: number
}

export function MapMarkerHoverCard({ model, x, y }: MapMarkerHoverCardProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+10px)] transition-opacity duration-150"
      style={{ left: x, top: y }}
    >
      <div className={SCHEDULER_MAP_TOOLTIP}>
        <p className="font-semibold text-slate-100">{model.customerName?.trim() || "Customer"}</p>
        <div className={cn(SCHEDULER_FIELD_STACK, "mt-1 text-slate-300")}>
          <p>{formatMapPhone(model.customerPhone)}</p>
          <p className={SCHEDULER_METADATA_LABEL}>{model.vehicleLine?.trim() || "—"}</p>
          <p className={SCHEDULER_METADATA_LABEL}>{model.jobType?.trim() || "—"}</p>
        </div>
      </div>
    </div>
  )
}
