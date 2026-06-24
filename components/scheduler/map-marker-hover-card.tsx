"use client"

// Optional React hover card — dispatch map uses native Leaflet tooltips for performance.

import { formatMapPhone, type MapMarkerTooltipModel } from "@/lib/scheduler-map-markers"

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
      <div className="rounded-md border border-zinc-800 bg-zinc-950/95 px-2.5 py-1.5 text-xs text-zinc-200 shadow-xl">
        <p className="font-semibold text-zinc-100">{model.customerName?.trim() || "Customer"}</p>
        <p>{formatMapPhone(model.customerPhone)}</p>
        <p>{model.vehicleLine?.trim() || "—"}</p>
        <p>{model.jobType?.trim() || "—"}</p>
      </div>
    </div>
  )
}
