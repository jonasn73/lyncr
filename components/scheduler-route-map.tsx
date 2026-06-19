"use client"

// Owner scheduler map — Louisville default, numbered route stops, pulsing hopper pins.

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, MapPinned } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
import { loadLeafletClient } from "@/lib/leaflet-client"
import {
  LOUISVILLE_DEFAULT_ZOOM,
  LOUISVILLE_MAP_CENTER,
  SCHEDULER_MAP_PIN_COLOR,
  isActiveMapJob,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { spreadOverlappingPins } from "@/lib/map-pin-spread"
import type { SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

type LeafletModule = typeof import("leaflet")

type RoutedStop = {
  order: number
  event: SchedulerEvent
  lat: number
  lng: number
  phase: ReturnType<typeof schedulerLifecyclePhase>
}

type PoolPin = {
  job: UnassignedPoolJob
  lat: number
  lng: number
  poolIndex: number
}

function routeStopIcon(L: LeafletModule, order: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${color};border:2px solid rgba(0,0,0,0.45);color:#ecfdf5;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${order}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function poolHopperIcon(L: LeafletModule, label: string) {
  return L.divIcon({
    className: "hopper-pool-marker",
    html: `<span class="hopper-pulse" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#a1a1aa,#78716c);border:2px solid #eab308;color:#fef9c3;font-size:10px;font-weight:800;box-shadow:0 0 0 0 rgba(234,179,8,0.55)">${label}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

type SchedulerRouteMapProps = {
  events: SchedulerEvent[]
  poolJobs?: UnassignedPoolJob[]
  selectedDayLabel: string
  highlightId?: string | null
  onSelectEvent?: (event: SchedulerEvent) => void
  onSelectPoolJob?: (job: UnassignedPoolJob) => void
}

export function SchedulerRouteMap({
  events,
  poolJobs = [],
  selectedDayLabel,
  highlightId,
  onSelectEvent,
  onSelectPoolJob,
}: SchedulerRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const markersRef = useRef<Marker[]>([])
  const lineRef = useRef<Polyline | null>(null)
  const [ready, setReady] = useState(false)

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
      if (!isActiveMapJob(phase)) continue
      if (typeof ev.latitude !== "number" || typeof ev.longitude !== "number") continue
      order += 1
      out.push({ order, event: ev, lat: ev.latitude, lng: ev.longitude, phase })
    }
    return out
  }, [events])

  const poolPins = useMemo((): PoolPin[] => {
    const mapped = poolJobs
      .filter((j) => typeof j.latitude === "number" && typeof j.longitude === "number")
      .map((j, idx) => ({ job: j, lat: j.latitude!, lng: j.longitude!, poolIndex: idx + 1 }))

    return spreadOverlappingPins(mapped.map((p) => ({ lat: p.lat, lng: p.lng, data: p }))).map(
      (spread) => spread.data
    )
  }, [poolJobs])

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
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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
      const highlighted = highlightId === pin.job.id
      const marker = L.marker([pin.lat, pin.lng], {
        icon: poolHopperIcon(L, String(pin.poolIndex)),
      })
        .bindPopup(
          `<strong>Pool #${pin.poolIndex}</strong> ${pin.job.customer_name ?? "Customer"}<br/>${pin.job.job_type ?? ""}<br/>${pin.job.neighborhood || pin.job.location || ""}`
        )
        .addTo(map)
      if (highlighted) marker.openPopup()
      marker.on("click", () => onSelectPoolJob?.(pin.job))
      markersRef.current.push(marker)
      latLngs.push([pin.lat, pin.lng])
    }

    for (const stop of scheduledPins) {
      const color = SCHEDULER_MAP_PIN_COLOR[stop.phase]
      const highlighted = highlightId === stop.event.id
      const marker = L.marker([stop.lat, stop.lng], { icon: routeStopIcon(L, stop.order, color) })
        .bindPopup(
          `<strong>#${stop.order}</strong> ${stop.event.customer_name ?? "Customer"}<br/>${stop.event.job_type ?? ""}<br/>${stop.event.location ?? ""}`
        )
        .addTo(map)
      if (highlighted) marker.openPopup()
      marker.on("click", () => onSelectEvent?.(stop.event))
      markersRef.current.push(marker)
      latLngs.push([stop.lat, stop.lng])
    }

    if (stops.length >= 2) {
      const routeLatLngs = scheduledPins
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
      const bounds = L.latLngBounds(latLngs)
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
    } else {
      map.setView([LOUISVILLE_MAP_CENTER.lat, LOUISVILLE_MAP_CENTER.lng], LOUISVILLE_DEFAULT_ZOOM)
    }
  }, [stops, scheduledPins, poolPins, ready, highlightId, onSelectEvent, onSelectPoolJob])

  const mappedPoolCount = poolJobs.filter(
    (j) => typeof j.latitude === "number" && typeof j.longitude === "number"
  ).length
  const unmappedPoolCount = poolJobs.length - mappedPoolCount

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
    stops.length +
    poolJobs.filter((j) => j.latitude == null || j.longitude == null).length

  return (
    <div className="relative flex h-full min-h-[320px] flex-col">
      <style>{`
        @keyframes hopperPulse {
          0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.65); }
          70% { box-shadow: 0 0 0 10px rgba(234, 179, 8, 0); }
          100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
        }
        .hopper-pulse { animation: hopperPulse 2s ease-out infinite; }
      `}</style>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <p className="text-xs font-medium text-zinc-400">
          <MapPinned className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Route — {selectedDayLabel}
        </p>
        <p className="text-[10px] text-zinc-500">
          {stops.length} scheduled · {mappedPoolCount}/{poolJobs.length} pool on map
          {unmappedPoolCount > 0 ? ` · ${unmappedPoolCount} geocoding` : ""}
          {missingCoords > 0 ? ` · ${missingCoords} awaiting address` : ""}
        </p>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 bg-zinc-950" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-hidden />
        </div>
      ) : null}
      {ready && stops.length === 0 && poolPins.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <p className="rounded-lg border border-border/50 bg-card/90 px-3 py-2 text-center text-xs text-zinc-500">
            Centered on Louisville — book a job with an address to see pins, or check the hopper for pool jobs.
          </p>
        </div>
      ) : null}
    </div>
  )
}
