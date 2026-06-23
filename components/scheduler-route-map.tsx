"use client"

// Owner scheduler map — Louisville default, status-colored pins, live tech markers, panTo focus.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Loader2, MapPinned } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
import { MapMarkerHoverCard } from "@/components/scheduler/map-marker-hover-card"
import { loadLeafletClient } from "@/lib/leaflet-client"
import { attachBaseMapTiles } from "@/lib/map-tiles"
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

/** Right padding when the job drawer is open (matches drawer width + gutter). */
const JOB_DRAWER_MAP_PADDING_PX = 460

type MapEdgePadding = {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/** Leaflet equivalent of map.flyTo({ padding: { right: 420 } }). */
function panToWithEdgePadding(
  map: LeafletMap,
  lat: number,
  lng: number,
  padding: MapEdgePadding,
  syncTooltip: (lat: number, lng: number) => void
) {
  const pad = { top: 0, right: 0, bottom: 0, left: 0, ...padding }
  const size = map.getSize()
  const visibleCenterX = pad.left + (size.x - pad.left - pad.right) / 2
  const visibleCenterY = pad.top + (size.y - pad.top - pad.bottom) / 2
  const markerPoint = map.latLngToContainerPoint([lat, lng])
  const deltaX = markerPoint.x - visibleCenterX
  const deltaY = markerPoint.y - visibleCenterY
  if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
    map.panBy([deltaX, deltaY], { animate: true })
  }
  syncTooltip(lat, lng)
}

export type SchedulerRouteMapPanOptions = {
  /** Shift the pin left so it stays visible beside the open job drawer. */
  accountForDrawer?: boolean
}

export type DrivingRouteFocus = {
  jobLat: number
  jobLng: number
  techLat?: number | null
  techLng?: number | null
  accountForDrawer?: boolean
}

export type SchedulerRouteMapHandle = {
  panTo: (lat: number, lng: number, zoom?: number, options?: SchedulerRouteMapPanOptions) => void
  fitDrivingRoute: (focus: DrivingRouteFocus) => void
}

type SchedulerRouteMapProps = {
  events: SchedulerEvent[]
  pipelineJobs?: ActivePipelineJob[]
  poolJobs?: UnassignedPoolJob[]
  techLocations?: TechLiveLocation[]
  selectedDayLabel: string
  highlightId?: string | null
  /** Tech → job driving route + viewport when the job drawer is open. */
  routeFocus?: DrivingRouteFocus | null
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
      routeFocus,
      embedded = false,
      onSelectEvent,
      onSelectPoolJob,
    },
    ref
  ) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapShellRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const markersRef = useRef<Marker[]>([])
  const lineRef = useRef<Polyline | null>(null)
  const routeGlowRef = useRef<Polyline | null>(null)
  const routeLineRef = useRef<Polyline | null>(null)
  const [ready, setReady] = useState(false)
  const [hovered, setHovered] = useState<HoveredPin | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const syncTooltipPos = useCallback((lat: number, lng: number) => {
    const map = mapRef.current
    if (!map) return
    const point = map.latLngToContainerPoint([lat, lng])
    setTooltipPos({ x: point.x, y: point.y })
  }, [])

  const fitDrivingRouteBounds = useCallback(
    (focus: DrivingRouteFocus, geometry: [number, number][]) => {
      const map = mapRef.current
      const L = leafletRef.current
      if (!map || !L) return

      const bounds = L.latLngBounds(geometry)
      bounds.extend([focus.jobLat, focus.jobLng])
      if (typeof focus.techLat === "number" && typeof focus.techLng === "number") {
        bounds.extend([focus.techLat, focus.techLng])
      }

      const padRight = focus.accountForDrawer ? JOB_DRAWER_MAP_PADDING_PX : 50
      map.fitBounds(bounds, {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [padRight, 50],
        maxZoom: 15,
        animate: true,
      })
      syncTooltipPos(focus.jobLat, focus.jobLng)
    },
    [syncTooltipPos]
  )

  const drawDrivingRoute = useCallback(
    (geometry: [number, number][]) => {
      const L = leafletRef.current
      const map = mapRef.current
      if (!L || !map || geometry.length < 2) return

      if (routeGlowRef.current) {
        routeGlowRef.current.remove()
        routeGlowRef.current = null
      }
      if (routeLineRef.current) {
        routeLineRef.current.remove()
        routeLineRef.current = null
      }

      routeGlowRef.current = L.polyline(geometry, {
        color: "#22d3ee",
        weight: 10,
        opacity: 0.35,
        lineCap: "round",
        lineJoin: "round",
        className: "route-glow",
      }).addTo(map)

      routeLineRef.current = L.polyline(geometry, {
        color: "#14b8a6",
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        className: "route",
      }).addTo(map)
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      panTo(lat: number, lng: number, zoom = 15, options?: SchedulerRouteMapPanOptions) {
        const map = mapRef.current
        if (!map) return
        map.setView([lat, lng], zoom, { animate: true })
        if (!options?.accountForDrawer) return

        const padding = { top: 50, right: JOB_DRAWER_MAP_PADDING_PX, left: 50, bottom: 50 }
        const nudgeForDrawer = () => panToWithEdgePadding(map, lat, lng, padding, syncTooltipPos)

        map.once("moveend", nudgeForDrawer)
        requestAnimationFrame(() => requestAnimationFrame(nudgeForDrawer))
      },
      fitDrivingRoute(focus: DrivingRouteFocus) {
        void (async () => {
          const from =
            typeof focus.techLat === "number" && typeof focus.techLng === "number"
              ? `${focus.techLat},${focus.techLng}`
              : null
          const to = `${focus.jobLat},${focus.jobLng}`

          let geometry: [number, number][] | null = null
          if (from) {
            try {
              const res = await fetch(
                `/api/dispatch/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
                { credentials: "include", cache: "no-store" }
              )
              if (res.ok) {
                const json = (await res.json()) as { data?: { geometry?: [number, number][] } }
                geometry = json.data?.geometry ?? null
              }
            } catch {
              /* fall through to straight segment */
            }
          }

          if (!geometry?.length) {
            if (from) {
              const [fromLat, fromLng] = from.split(",").map(Number)
              geometry = [
                [fromLat, fromLng],
                [focus.jobLat, focus.jobLng],
              ]
            } else {
              geometry = [[focus.jobLat, focus.jobLng]]
            }
          }

          drawDrivingRoute(geometry)
          fitDrivingRouteBounds(focus, geometry)
        })()
      },
    }),
    [syncTooltipPos, drawDrivingRoute, fitDrivingRouteBounds]
  )

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
    if (!highlightId || !ready) {
      if (!highlightId) {
        setHovered(null)
        setTooltipPos(null)
      }
      return
    }

    const poolPin = poolPins.find((p) => p.job.id === highlightId)
    if (poolPin) {
      const active = poolPin.job as ActivePipelineJob
      const tooltipModel = tooltipFromPoolJob(poolPin.job, poolPin.poolIndex, {
        job_status: active.job_status,
        assigned_tech_id: active.assigned_tech_id,
      })
      setHovered({ lat: poolPin.lat, lng: poolPin.lng, model: tooltipModel })
      syncTooltipPos(poolPin.lat, poolPin.lng)
      return
    }

    const stop = scheduledPins.find((s) => s.event.id === highlightId)
    if (stop) {
      const tooltipModel = tooltipFromScheduledEvent(stop.event, stop.order)
      setHovered({ lat: stop.lat, lng: stop.lng, model: tooltipModel })
      syncTooltipPos(stop.lat, stop.lng)
    }
  }, [highlightId, ready, poolPins, scheduledPins, syncTooltipPos])

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
      attachBaseMapTiles(L, created)
      mapRef.current = created
      setReady(true)
      requestAnimationFrame(() => {
        created?.invalidateSize({ animate: false })
      })
    })()
    return () => {
      cancelled = true
      if (created) created.remove()
      mapRef.current = null
      markersRef.current = []
      lineRef.current = null
      routeGlowRef.current = null
      routeLineRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!routeFocus) {
      if (routeGlowRef.current) {
        routeGlowRef.current.remove()
        routeGlowRef.current = null
      }
      if (routeLineRef.current) {
        routeLineRef.current.remove()
        routeLineRef.current = null
      }
      return
    }
    void (async () => {
        const from =
          typeof routeFocus.techLat === "number" && typeof routeFocus.techLng === "number"
            ? `${routeFocus.techLat},${routeFocus.techLng}`
            : null
        const to = `${routeFocus.jobLat},${routeFocus.jobLng}`

        let geometry: [number, number][] | null = null
        if (from) {
          try {
            const res = await fetch(
              `/api/dispatch/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
              { credentials: "include", cache: "no-store" }
            )
            if (res.ok) {
              const json = (await res.json()) as { data?: { geometry?: [number, number][] } }
              geometry = json.data?.geometry ?? null
            }
          } catch {
            /* straight fallback below */
          }
        }

        if (!geometry?.length) {
          if (from) {
            const [fromLat, fromLng] = from.split(",").map(Number)
            geometry = [
              [fromLat, fromLng],
              [routeFocus.jobLat, routeFocus.jobLng],
            ]
          } else {
            geometry = [[routeFocus.jobLat, routeFocus.jobLng]]
          }
        }

        drawDrivingRoute(geometry)
        fitDrivingRouteBounds(routeFocus, geometry)
      })()
  }, [routeFocus, ready, drawDrivingRoute, fitDrivingRouteBounds])

  useEffect(() => {
    const map = mapRef.current
    const shell = mapShellRef.current
    if (!map || !ready || !shell) return
    const refreshSize = () => map.invalidateSize({ animate: false })
    refreshSize()
    const ro = new ResizeObserver(refreshSize)
    ro.observe(shell)
    return () => ro.disconnect()
  }, [ready])

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
        if (highlightId === pin.job.id) return
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
        if (highlightId === stop.event.id) return
        setHovered(null)
        setTooltipPos(null)
      })
      marker.on("click", () => onSelectEvent?.(stop.event))
      markersRef.current.push(marker)
      latLngs.push([stop.lat, stop.lng])
    }

    if (routeStops.length >= 2 && !routeFocus) {
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

    if (latLngs.length > 0 && !routeFocus) {
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
    requestAnimationFrame(() => map.invalidateSize({ animate: false }))
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
    highlightId,
    routeFocus,
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
      <div ref={mapShellRef} className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 z-0 bg-zinc-950" />
        {hovered && tooltipPos ? (
          <MapMarkerHoverCard model={hovered.model} x={tooltipPos.x} y={tooltipPos.y} />
        ) : null}
      </div>
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80">
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
