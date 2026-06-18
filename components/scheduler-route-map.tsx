"use client"

// Numbered route map for the owner scheduler — plots today's jobs in chronological order.

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, MapPinned } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
import type { SchedulerEvent } from "@/lib/types"

type LeafletModule = typeof import("leaflet")

type RoutedStop = {
  order: number
  event: SchedulerEvent
  lat: number
  lng: number
}

/** Numbered pin for route sequence (1, 2, 3…). */
function routeStopIcon(L: LeafletModule, order: number) {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#10b981;border:2px solid #064e3b;color:#ecfdf5;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${order}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

type SchedulerRouteMapProps = {
  events: SchedulerEvent[]
  selectedDayLabel: string
}

export function SchedulerRouteMap({ events, selectedDayLabel }: SchedulerRouteMapProps) {
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
    sorted.forEach((ev, idx) => {
      if (typeof ev.latitude === "number" && typeof ev.longitude === "number") {
        out.push({ order: idx + 1, event: ev, lat: ev.latitude, lng: ev.longitude })
      }
    })
    return out
  }, [events])

  useEffect(() => {
    let cancelled = false
    let created: LeafletMap | null = null
    void (async () => {
      const L = (await import("leaflet")).default
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      created = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(
        [39.5, -98.35],
        4
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

    if (stops.length === 0) return

    const latLngs: [number, number][] = []
    for (const stop of stops) {
      const marker = L.marker([stop.lat, stop.lng], { icon: routeStopIcon(L, stop.order) })
        .bindPopup(
          `<strong>#${stop.order}</strong> ${stop.event.customer_name ?? "Customer"}<br/>${stop.event.job_type ?? ""}<br/>${stop.event.location ?? ""}`
        )
        .addTo(map)
      markersRef.current.push(marker)
      latLngs.push([stop.lat, stop.lng])
    }

    if (latLngs.length >= 2) {
      lineRef.current = L.polyline(latLngs, { color: "#10b981", weight: 3, opacity: 0.7, dashArray: "6 8" }).addTo(map)
    }

    const bounds = L.latLngBounds(latLngs)
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
  }, [stops, ready])

  const missingCoords = events.length - stops.length

  return (
    <div className="relative flex h-full min-h-[320px] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <p className="text-xs font-medium text-zinc-400">
          <MapPinned className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Route — {selectedDayLabel}
        </p>
        <p className="text-[10px] text-zinc-500">
          {stops.length} mapped
          {missingCoords > 0 ? ` · ${missingCoords} awaiting geocode` : ""}
        </p>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 bg-zinc-950" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-hidden />
        </div>
      ) : null}
      {ready && stops.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <p className="rounded-lg border border-border/50 bg-card/90 px-3 py-2 text-center text-xs text-zinc-500">
            No geocoded stops yet — save a job address on intake or when booking.
          </p>
        </div>
      ) : null}
    </div>
  )
}
