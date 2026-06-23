"use client"

// Floating hover card anchored to a Leaflet map marker.

import { Car, Phone, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMapPhone, type MapMarkerTooltipModel } from "@/lib/scheduler-map-markers"
import type { SchedulerLifecyclePhase } from "@/lib/scheduler-job-status"

const BADGE_CLASS: Record<SchedulerLifecyclePhase, string> = {
  unassigned: "bg-orange-500/20 text-orange-200 ring-orange-500/40",
  scheduled: "bg-teal-500/20 text-teal-100 ring-teal-500/40",
  en_route: "bg-sky-500/20 text-sky-200 ring-sky-500/40",
  on_site: "bg-amber-500/20 text-amber-100 ring-amber-500/40",
  completed: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/35",
}

type MapMarkerHoverCardProps = {
  model: MapMarkerTooltipModel
  x: number
  y: number
}

export function MapMarkerHoverCard({ model, x, y }: MapMarkerHoverCardProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 w-[min(240px,calc(100%-16px))] -translate-x-1/2 -translate-y-[calc(100%+14px)]"
      style={{ left: x, top: y }}
    >
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
              BADGE_CLASS[model.phase]
            )}
          >
            {model.statusLabel}
          </span>
          {model.kind === "pool" ? (
            <span className="text-[10px] text-zinc-500">Pool #{model.routeOrder}</span>
          ) : (
            <span className="text-[10px] text-zinc-500">Stop #{model.routeOrder}</span>
          )}
        </div>
        <div className="space-y-1.5 px-3 py-2.5 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <User className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
            {model.customerName || "Customer"}
          </p>
          {model.customerPhone ? (
            <p className="flex items-center gap-1.5 text-zinc-300">
              <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              {formatMapPhone(model.customerPhone)}
            </p>
          ) : null}
          {model.vehicleLine ? (
            <p className="flex items-center gap-1.5 text-zinc-400">
              <Car className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              {model.vehicleLine}
            </p>
          ) : null}
          {model.keyTypeLine ? (
            <p className="text-[11px] text-zinc-500">
              {model.jobType && model.keyTypeLine !== model.jobType ? (
                <>
                  <span className="text-zinc-400">{model.jobType}</span>
                  <span className="mx-1 text-zinc-600">·</span>
                </>
              ) : null}
              {model.keyTypeLine}
            </p>
          ) : model.jobType ? (
            <p className="text-[11px] text-zinc-500">{model.jobType}</p>
          ) : null}
        </div>
      </div>
      <div
        className="mx-auto h-2 w-2 -translate-y-px rotate-45 border-b border-r border-border/70 bg-card/95"
        aria-hidden
      />
    </div>
  )
}
