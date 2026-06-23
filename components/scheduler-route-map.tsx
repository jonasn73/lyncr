"use client"

// Owner scheduler map — Louisville default, status-colored pins, live tech markers, panTo focus.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Loader2, MapPinned } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
import { MapMarkerHoverCard } from "@/components/scheduler/map-marker-hover-card"
import { loadLeafletClient } from "@/lib/leaflet-client"
import {
  distanceMeters,
  ensureUniquePoolPinPositions,
  expandBoundsForPins,
  spreadOverlappingPins,
} from "@/lib/map-pin-spread"
import {
  MAP_MARKER_ANIMATION_CSS,
  poolPinHtml,
  scheduledPinHtml,
  tooltipFromPoolJob,
  tooltipFromScheduledEvent,
  type MapMarkerTooltipModel,
} from "@/lib/scheduler-map-markers"
import {
  LOUISVILLE_DEFAULT_ZOOM,
  LOUISVILLE_MAP_CENTER,
  SCHEDULER_MAP_PIN_COLOR,
  isActiveMapJob,
  isCompletedMapJob,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import type { ActivePipelineJob, SchedulerEvent, TechLiveLocation, UnassignedPoolJob } from "@/lib/types"

type LeafletModule = typeof import("leaflet")

type RoutedStop = {
  order: number
  event: SchedulerEvent
  lat: number
  lng: number
  phase: ReturnType<typeof schedulerLifecyclePhase>
}

type PoolPin = {
  job: UnassignedPoolJob | ActivePipelineJob
  lat: number
  lng: number
  poolIndex: number
}

type HoveredPin = {
  lat: number
  lng: number
  model: MapMarkerTooltipModel
}

function routeStopIcon(L: LeafletModule, order: number, phase: RoutedStop["phase"]) {
  const color = SCHEDULER_MAP_PIN_COLOR[phase]
  return L.divIcon({
    className: "",
    html: scheduledPinHtml(order, color, phase),
    iconSize: phase === "completed" ? [24, 24] : [28, 28],
    iconAnchor: phase === "completed" ? [12, 12] : [14, 14],
  })
}

function poolHopperIcon(L: LeafletModule, label: string, color: string) {
  return L.divIcon({
    className: "",
    html: poolPinHtml(label, color),
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function techLiveIcon(L: LeafletModule, initials: string, status: string | null) {
  const color =
    status === "en_route" ? "#38bdf8" : status === "on_site" || status === "arrived" ? "#eab308" : "#a1a1aa"
  const pulse = status === "en_route" || status === "on_site" || status === "arrived"
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${color};border:2px solid #18181b;font-size:10px;font-weight:700;color:#0a0a0a;box-shadow:0 0 0 ${pulse ? "5px" : "2px"} ${color}44">${initials}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function techInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return (parts[0]?.slice(0, 2) ?? "T").toUpperCase()
}

export type SchedulerRouteMapHandle = {
  panTo: (lat: number, lng: number, zoom?: number) => void
}

type SchedulerRouteMapProps = {
  events: SchedulerEvent[]
  pipelineJobs?: ActivePipelineJob[]
  poolJobs?: UnassignedPoolJob[]
  techLocations?: TechLiveLocation[]
  selectedDayLabel: string
  highlightId?: string | null
  /** Hide the floating pin card (e.g. while the job detail drawer is open). */
  hideHoverCard?: boolean
  /** Hide top stats chrome so the map fills the split pane edge-to-edge. */
  embedded?: boolean
  onSelectEvent?: (event: SchedulerEvent) => void
  onSelectPoolJob?: (job: UnassignedPoolJob | ActivePipelineJob) => void
}

export const SchedulerRouteMap = forwardRef<SchedulerRouteMapHandle, SchedulerRouteMapProps>(
  function SchedulerRouteMap(
    {
      events,
      pipelineJobs = [],
      poolJobs = [],
      techLocations = [],
      selectedDayLabel,
      highlightId,
      hideHoverCard = false,
      embedded = false,
      onSelectEvent,
      onSelectPoolJob,
    },
    ref
  ) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const markersRef = useRef<Marker[]>([])
  const lineRef = useRef<Polyline | null>(null)
  const [ready, setReady] = useState(false)
  const [hovered, setHovered] = useState<HoveredPin | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  useImperativeHandle(ref, () => ({
    panTo(lat: number, lng: number, zoom = 15) {
      const map = mapRef.current
      if (!map) return
      map.setView([lat, lng], zoom, { animate: true })
    },
  }))

  const syncTooltipPos = useCallback((lat: number, lng: number) => {
    const map = mapRef.current
    if (!map) return
    const point = map.latLngToContainerPoint([lat, lng])
    setTooltipPos({ x: point.x, y: point.y })
  }, [])

  useEffect(() => {
    if (hideHoverCard) {
      setHovered(null)
      setTooltipPos(null)
    }
  }, [hideHoverCard])

  const stops = useMemo((): RoutedStop[] => {
    const sorted = [...events].sort(
      (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )
    const out: RoutedStop[] = []
    let order = 0
    for (const ev of sorted) {
      const phase = schedulerLifecyclePhase({
        job_status: ev.job_status,
        dispatch_status: ev.dispatch_status,
        assigned_tech_id: ev.assigned_tech_id,
      })
      if (!isActiveMapJob(phase) && !isCompletedMapJob(phase)) continue
      if (typeof ev.latitude !== "number" || typeof ev.longitude !== "number") continue
      order += 1
      out.push({ order, event: ev, lat: ev.latitude, lng: ev.longitude, phase })
    }
    return out
  }, [events])

  const hopperSource = pipelineJobs.length > 0 ? pipelineJobs : poolJobs

  const poolPins = useMemo((): PoolPin[] => {
    const mapped = hopperSource
      .filter((j) => typeof j.latitude === "number" && typeof j.longitude === "number")
      .map((j, idx) => ({ job: j, lat: j.latitude!, lng: j.longitude!, poolIndex: idx + 1 }))

    const spread = spreadOverlappingPins(mapped.map((p) => ({ lat: p.lat, lng: p.lng, data: p }))).map(
      (item) => item.data
    )
    return ensureUniquePoolPinPositions(spread)
  }, [hopperSource])

  const routeStops = useMemo(
    () => stops.filter((s) => isActiveMapJob(s.phase)),
    [stops]
  )

  const scheduledPins = useMemo(() => {
    return spreadOverlappingPins(
      stops.map((s) => ({ lat: s.lat, lng: s.lng, data: s }))
    ).map((spread) => spread.data)
  }, [stops])

  useEffect(() => {
    let cancelled = false
    let created: LeafletMap | null = null
    void (async () => {
      const L = await loadLeafletClient()
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      created = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(
        [LOUISVILLE_MAP_CENTER.lat, LOUISVILLE_MAP_CENTER.lng],
        LOUISVILLE_DEFAULT_ZOOM
      )
      L.tileLayer("https://{s.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(created)
      mapRef.current = created
      setReady(true)
    })()
    return () => {
      cancelled = true
      if (created) created.remove()
      mapRef.current = null
      markersRef.current = []
      lineRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hovered) return
    const reposition = () => syncTooltipPos(hovered.lat, hovered.lng)
    map.on("move", reposition)
    map.on("zoom", reposition)
    return () => {
      map.off("move", reposition)
      map.off("zoom", reposition)
    }
  }, [hovered, syncTooltipPos])

  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || !ready) return

    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    if (lineRef.current) {
      lineRef.current.remove()
      lineRef.current = null
    }

    const latLngs: [number, number][] = []

    for (const pin of poolPins) {
      const active = pin.job as ActivePipelineJob
      const phase = schedulerLifecyclePhase({
        job_status: active.job_status,
        dispatch_status: pin.job.dispatch_status,
        assigned_tech_id: active.assigned_tech_id,
      })
      const pinColor = SCHEDULER_MAP_PIN_COLOR[phase]
      const tooltipModel = tooltipFromPoolJob(pin.job, pin.poolIndex, {
        job_status: active.job_status,
        assigned_tech_id: active.assigned_tech_id,
      })
      const marker = L.marker([pin.lat, pin.lng], {
        icon: poolHopperIcon(L, String(pin.poolIndex), pinColor),
        zIndexOffset: pin.poolIndex * 250,
      }).addTo(map)

      marker.on("mouseover", () => {
        setHovered({ lat: pin.lat, lng: pin.lng, model: tooltipModel })
        syncTooltipPos(pin.lat, pin.lng)
      })
      marker.on("mouseout", () => {
        setHovered(null)
        setTooltipPos(null)
      })
      marker.on("click", () => onSelectPoolJob?.(pin.job))
      markersRef.current.push(marker)
      latLngs.push([pin.lat, pin.lng])
    }

    for (const tech of techLocations) {
      if (typeof tech.latitude !== "number" || typeof tech.longitude !== "number") continue
      const marker = L.marker([tech.latitude, tech.longitude], {
        icon: techLiveIcon(L, techInitials(tech.name), tech.status),
        zIndexOffset: 5000,
      }).addTo(map)
      marker.bindTooltip(`${tech.name} · live`, { direction: "top", opacity: 0.95 })
      markersRef.current.push(marker)
      latLngs.push([tech.latitude, tech.longitude])
    }

    for (const stop of scheduledPins) {
      const tooltipModel = tooltipFromScheduledEvent(stop.event, stop.order)
      const marker = L.marker([stop.lat, stop.lng], {
        icon: routeStopIcon(L, stop.order, stop.phase),
        zIndexOffset: stop.order * 200,
        opacity: stop.phase === "completed" ? 0.75 : 1,
      }).addTo(map)

      marker.on("mouseover", () => {
        setHovered({ lat: stop.lat, lng: stop.lng, model: tooltipModel })
        syncTooltipPos(stop.lat, stop.lng)
      })
      marker.on("mouseout", () => {
        setHovered(null)
        setTooltipPos(null)
      })
      marker.on("click", () => onSelectEvent?.(stop.event))
      markersRef.current.push(marker)
      latLngs.push([stop.lat, stop.lng])
    }

    if (routeStops.length >= 2) {
      const routeLatLngs = routeStops
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => [s.lat, s.lng] as [number, number])
      lineRef.current = L.polyline(routeLatLngs, {
        color: "#14b8a6",
        weight: 3,
        opacity: 0.75,
        dashArray: "6 8",
      }).addTo(map)
    }

    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(expandBoundsForPins(latLngs))
      let maxZoom = 14
      if (poolPins.length > 1 && routeStops.length === 0) {
        const spanM = distanceMeters(poolPins[0].lat, poolPins[0].lng, poolPins[1].lat, poolPins[1].lng)
        maxZoom = spanM > 3000 ? 11 : 12
      }
      map.fitBounds(bounds, { padding: [56, 56], maxZoom })
    } else {
      map.setView([LOUISVILLE_MAP_CENTER.lat, LOUISVILLE_MAP_CENTER.lng], LOUISVILLE_DEFAULT_ZOOM)
    }
  }, [
    routeStops,
    stops,
    scheduledPins,
    poolPins,
    techLocations,
    ready,
    onSelectEvent,
    onSelectPoolJob,
    syncTooltipPos,
  ])

  const mappedPoolCount = hopperSource.filter(
    (j) => typeof j.latitude === "number" && typeof j.longitude === "number"
  ).length
  const unmappedPoolCount = hopperSource.length - mappedPoolCount

  const activeEvents = events.filter((ev) =>
    isActiveMapJob(
      schedulerLifecyclePhase({
        job_status: ev.job_status,
        dispatch_status: ev.dispatch_status,
        assigned_tech_id: ev.assigned_tech_id,
      })
    )
  )
  const missingCoords =
    activeEvents.length -
    routeStops.length +
    hopperSource.filter((j) => j.latitude == null || j.longitude == null).length

  return (
    <div className="relative flex h-full min-h-[320px] flex-col">
      <style>{MAP_MARKER_ANIMATION_CSS}</style>
      {!embedded ? (
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <p className="text-xs font-medium text-zinc-400">
            <MapPinned className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Route — {selectedDayLabel}
          </p>
          <p className="text-[10px] text-zinc-500">
            {routeStops.length} scheduled · {mappedPoolCount}/{hopperSource.length} pipeline on map
            {techLocations.length > 0 ? ` · ${techLocations.length} tech live` : ""}
            {unmappedPoolCount > 0 ? ` · ${unmappedPoolCount} geocoding` : ""}
            {missingCoords > 0 ? ` · ${missingCoords} awaiting address` : ""}
          </p>
        </div>
      ) : null}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-zinc-950">
        {hovered && tooltipPos && !hideHoverCard ? (
          <MapMarkerHoverCard model={hovered.model} x={tooltipPos.x} y={tooltipPos.y} />
        ) : null}
      </div>
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-hidden />
        </div>
      ) : null}
      {ready && routeStops.length === 0 && poolPins.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <p className="rounded-lg border border-border/50 bg-card/90 px-3 py-2 text-center text-xs text-zinc-500">
            Centered on Louisville — hover pins for job details, or drag from the hopper to schedule.
          </p>
        </div>
      ) : null}
    </div>
  )
})
