"use client"

// Owner scheduler map — Louisville default, status-colored pins, live tech markers, panTo focus.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Loader2, MapPinned } from "lucide-react"
import "leaflet/dist/leaflet.css"
import "@/app/leaflet-popup-overrides.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
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
  jobStatusPinHtml,
  mapMarkerTooltipHtml,
  techBadgePinHtml,
  tooltipFromPoolJob,
  tooltipFromScheduledEvent,
} from "@/lib/scheduler-map-markers"
import {
  LOUISVILLE_DEFAULT_ZOOM,
  LOUISVILLE_MAP_CENTER,
  isActiveMapJob,
  isCompletedMapJob,
  schedulerLifecyclePhase,
  type SchedulerLifecyclePhase,
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

function noopSyncTooltip() {
  /* hover tooltips are native Leaflet — no React overlay to reposition */
}

function jobStatusPinIcon(L: LeafletModule, phase: SchedulerLifecyclePhase, label: string) {
  const size = phase === "completed" ? 28 : 32
  return L.divIcon({
    className: "",
    html: jobStatusPinHtml(phase, label),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function jobPinLabel(
  phase: SchedulerLifecyclePhase,
  order: number,
  techName: string | null | undefined
): string {
  if (phase === "completed") return "✓"
  if (phase === "en_route" || phase === "on_site") {
    return techName ? techInitials(techName) : String(order)
  }
  return String(order)
}

function bindJobHoverTooltip(
  marker: Marker,
  model: ReturnType<typeof tooltipFromPoolJob>
) {
  marker.bindTooltip(mapMarkerTooltipHtml(model), {
    direction: "top",
    offset: [0, -18],
    className: "lyncr-map-hover-tooltip",
    opacity: 1,
    sticky: false,
  })
}

function techLiveIcon(L: LeafletModule, initials: string, status: string | null) {
  return L.divIcon({
    className: "",
    html: techBadgePinHtml(initials, status),
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function techInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return (parts[0]?.slice(0, 2) ?? "T").toUpperCase()
}

/** Default zoom when an operator selects a job on the dispatch map. */
const JOB_SELECT_ZOOM = 14

/** Instant camera snap — no slow fly animation. */
function snapMapToJob(map: LeafletMap, lat: number, lng: number, zoom = JOB_SELECT_ZOOM) {
  if (map.getZoom() !== zoom) {
    map.setView([lat, lng], zoom, { animate: false })
    return
  }
  map.panTo([lat, lng], { animate: false })
}

/** Parse latitude/longitude from a job record for map camera moves. */
function resolveMapJobCoordinates(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): { lat: number; lng: number } | null {
  const lat = typeof latitude === "number" ? latitude : Number.parseFloat(String(latitude ?? ""))
  const lng = typeof longitude === "number" ? longitude : Number.parseFloat(String(longitude ?? ""))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

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
  flyTo: (lat: number, lng: number, zoom?: number) => void
  /** Snap camera to a job pin and open its hover tooltip (sidebar / list selection). */
  focusJob: (jobId: string, lat?: number, lng?: number) => void
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
  /** Mobile map view — skip hover tooltips; use bottom sheet from parent instead. */
  disableHoverTooltips?: boolean
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
      disableHoverTooltips = false,
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
  /** Job id → Leaflet marker for programmatic tooltip + camera focus from the sidebar. */
  const jobMarkerRefs = useRef<Map<string, Marker>>(new Map())
  const highlightIdRef = useRef<string | null>(highlightId ?? null)
  const lineRef = useRef<Polyline | null>(null)
  const routeGlowRef = useRef<Polyline | null>(null)
  const routeLineRef = useRef<Polyline | null>(null)
  const [ready, setReady] = useState(false)

  highlightIdRef.current = highlightId ?? null

  const closeAllJobTooltips = useCallback(() => {
    for (const marker of jobMarkerRefs.current.values()) {
      marker.closeTooltip()
    }
  }, [])

  const focusJobMarker = useCallback(
    (jobId: string, lat?: number, lng?: number) => {
      const map = mapRef.current
      if (!map || !ready) return

      const marker = jobMarkerRefs.current.get(jobId)
      if (marker) {
        const ll = marker.getLatLng()
        snapMapToJob(map, ll.lat, ll.lng)
        if (!disableHoverTooltips) {
          closeAllJobTooltips()
          marker.openTooltip()
        }
        return
      }

      if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
        snapMapToJob(map, lat, lng)
      }
    },
    [ready, closeAllJobTooltips, disableHoverTooltips]
  )

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

      const padRight = 50
      map.fitBounds(bounds, {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [padRight, 50],
        maxZoom: 15,
        animate: true,
      })
    },
    []
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
        if (!options?.accountForDrawer) {
          snapMapToJob(map, lat, lng, zoom)
          return
        }
        map.setView([lat, lng], zoom, { animate: true })
        const padding = { top: 50, right: 50, left: 50, bottom: 50 }
        const nudgeForDrawer = () => panToWithEdgePadding(map, lat, lng, padding, noopSyncTooltip)
        map.once("moveend", nudgeForDrawer)
        requestAnimationFrame(() => requestAnimationFrame(nudgeForDrawer))
      },
      flyTo(lat: number, lng: number, zoom = JOB_SELECT_ZOOM) {
        const map = mapRef.current
        if (!map) return
        snapMapToJob(map, lat, lng, zoom)
      },
      focusJob(jobId: string, lat?: number, lng?: number) {
        focusJobMarker(jobId, lat, lng)
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
    [drawDrivingRoute, fitDrivingRouteBounds, focusJobMarker]
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
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || !ready) return

    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    jobMarkerRefs.current.clear()
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
      const label = jobPinLabel(phase, pin.poolIndex, active.assigned_tech_name)
      const tooltipModel = tooltipFromPoolJob(pin.job, pin.poolIndex, {
        job_status: active.job_status,
        assigned_tech_id: active.assigned_tech_id,
      })
      const marker = L.marker([pin.lat, pin.lng], {
        icon: jobStatusPinIcon(L, phase, label),
        zIndexOffset: pin.poolIndex * 100,
      }).addTo(map)

      if (!disableHoverTooltips) {
        bindJobHoverTooltip(marker, tooltipModel)
      }
      jobMarkerRefs.current.set(pin.job.id, marker)
      if (!disableHoverTooltips) {
        marker.on("mouseout", () => {
          if (highlightIdRef.current === pin.job.id) marker.openTooltip()
        })
      }
      marker.on("click", () => {
        const coords = resolveMapJobCoordinates(pin.job.latitude, pin.job.longitude)
        if (coords) snapMapToJob(map, coords.lat, coords.lng)
        if (!disableHoverTooltips) {
          closeAllJobTooltips()
          marker.openTooltip()
        }
        onSelectPoolJob?.(pin.job)
      })
      markersRef.current.push(marker)
      latLngs.push([pin.lat, pin.lng])
    }

    for (const tech of techLocations) {
      if (typeof tech.latitude !== "number" || typeof tech.longitude !== "number") continue
      const marker = L.marker([tech.latitude, tech.longitude], {
        icon: techLiveIcon(L, techInitials(tech.name), tech.status),
        zIndexOffset: 800,
      }).addTo(map)
      marker.bindTooltip(`${tech.name} · live`, {
        direction: "top",
        className: "lyncr-map-hover-tooltip",
        opacity: 1,
      })
      markersRef.current.push(marker)
      latLngs.push([tech.latitude, tech.longitude])
    }

    for (const stop of scheduledPins) {
      const ev = stop.event
      const tooltipModel = tooltipFromScheduledEvent(ev, stop.order)
      const label = jobPinLabel(stop.phase, stop.order, ev.assigned_tech_name)
      const marker = L.marker([stop.lat, stop.lng], {
        icon: jobStatusPinIcon(L, stop.phase, label),
        zIndexOffset: stop.order * 100,
        opacity: stop.phase === "completed" ? 0.75 : 1,
      }).addTo(map)

      if (!disableHoverTooltips) {
        bindJobHoverTooltip(marker, tooltipModel)
      }
      jobMarkerRefs.current.set(ev.id, marker)
      if (!disableHoverTooltips) {
        marker.on("mouseout", () => {
          if (highlightIdRef.current === ev.id) marker.openTooltip()
        })
      }
      marker.on("click", () => {
        const coords = resolveMapJobCoordinates(ev.latitude, ev.longitude)
        if (coords) snapMapToJob(map, coords.lat, coords.lng)
        if (!disableHoverTooltips) {
          closeAllJobTooltips()
          marker.openTooltip()
        }
        onSelectEvent?.(ev)
      })
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

    if (latLngs.length > 0 && !routeFocus && !highlightId) {
      const bounds = L.latLngBounds(expandBoundsForPins(latLngs))
      let maxZoom = 14
      if (poolPins.length > 1 && routeStops.length === 0) {
        const spanM = distanceMeters(poolPins[0].lat, poolPins[0].lng, poolPins[1].lat, poolPins[1].lng)
        maxZoom = spanM > 3000 ? 11 : 12
      }
      map.fitBounds(bounds, { padding: [56, 56], maxZoom })
    } else if (latLngs.length === 0 && !routeFocus && !highlightId) {
      map.setView([LOUISVILLE_MAP_CENTER.lat, LOUISVILLE_MAP_CENTER.lng], LOUISVILLE_DEFAULT_ZOOM)
    }

    if (highlightId) {
      const poolPin = poolPins.find((p) => p.job.id === highlightId)
      const stop = scheduledPins.find((s) => s.event.id === highlightId)
      const lat = poolPin?.lat ?? stop?.lat
      const lng = poolPin?.lng ?? stop?.lng
      focusJobMarker(highlightId, lat, lng)
    } else if (!disableHoverTooltips) {
      closeAllJobTooltips()
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
    highlightId,
    routeFocus,
    focusJobMarker,
    closeAllJobTooltips,
    disableHoverTooltips,
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
      </div>
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-hidden />
        </div>
      ) : null}
      {ready && routeStops.length === 0 && poolPins.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <p className="rounded-lg border border-border/50 bg-card/90 px-3 py-2 text-center text-xs text-zinc-500">
            Centered on Louisville — hover pins for job details, or select a job in the list.
          </p>
        </div>
      ) : null}
    </div>
  )
})
