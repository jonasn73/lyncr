"use client"

// Mini map: dispatcher location → job address with straight-line distance.

import { memo, useEffect, useRef, useState } from "react"
import { Loader2, MapPinned, Navigation } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker, Polyline } from "leaflet"
import { loadLeafletClient } from "@/lib/leaflet-client"
import { attachBaseMapTiles } from "@/lib/map-tiles"
import { formatDistanceMiles, estimateTravelMinutes, formatTravelMinutes } from "@/lib/geo"
import { cn } from "@/lib/utils"

type IntakeTravelPreviewProps = {
  dispatcherLat: number | null
  dispatcherLng: number | null
  jobLat: number | null
  jobLng: number | null
  distanceMiles: number | null
  locationStatus: "idle" | "requesting" | "ready" | "denied" | "unsupported"
  locationError: string | null
  className?: string
}

function pinHtml(label: string, color: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px;font-weight:700;color:${color};text-shadow:0 1px 2px rgba(0,0,0,.8)"><span style="width:12px;height:12px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></span><span>${label}</span></div>`
}

export const IntakeTravelPreview = memo(function IntakeTravelPreview({
  dispatcherLat,
  dispatcherLng,
  jobLat,
  jobLng,
  distanceMiles,
  locationStatus,
  locationError,
  className,
}: IntakeTravelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const lineRef = useRef<Polyline | null>(null)
  const dispatcherMarkerRef = useRef<Marker | null>(null)
  const jobMarkerRef = useRef<Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const hasJobPin = jobLat != null && jobLng != null
  const hasDispatcherPin = dispatcherLat != null && dispatcherLng != null
  const canDrawRoute = hasJobPin && hasDispatcherPin
  const travelMinutes =
    canDrawRoute && distanceMiles != null ? estimateTravelMinutes(distanceMiles) : null

  useEffect(() => {
    if (!hasJobPin || !containerRef.current) return
    let cancelled = false

    void loadLeafletClient().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        center: [jobLat!, jobLng!],
        zoom: 12,
        zoomControl: false,
        attributionControl: false,
      })
      attachBaseMapTiles(L, map)
      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      cancelled = true
      lineRef.current = null
      dispatcherMarkerRef.current = null
      jobMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [hasJobPin, jobLat, jobLng])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !hasJobPin) return

    void loadLeafletClient().then((L) => {
      const map = mapRef.current
      if (!map) return

      if (lineRef.current) {
        map.removeLayer(lineRef.current)
        lineRef.current = null
      }
      if (dispatcherMarkerRef.current) {
        map.removeLayer(dispatcherMarkerRef.current)
        dispatcherMarkerRef.current = null
      }
      if (jobMarkerRef.current) {
        map.removeLayer(jobMarkerRef.current)
        jobMarkerRef.current = null
      }

      if (canDrawRoute) {
        lineRef.current = L.polyline(
          [
            [dispatcherLat!, dispatcherLng!],
            [jobLat!, jobLng!],
          ],
          { color: "#22d3ee", weight: 3, dashArray: "6 8", opacity: 0.85 }
        ).addTo(map)

        dispatcherMarkerRef.current = L.marker([dispatcherLat!, dispatcherLng!], {
          icon: L.divIcon({
            className: "",
            html: pinHtml("You", "#38bdf8"),
            iconSize: [40, 40],
            iconAnchor: [20, 12],
          }),
        }).addTo(map)
      }

      jobMarkerRef.current = L.marker([jobLat!, jobLng!], {
        icon: L.divIcon({
          className: "",
          html: pinHtml("Job", "#f97316"),
          iconSize: [40, 40],
          iconAnchor: [20, 12],
        }),
      }).addTo(map)

      const bounds = L.latLngBounds(
        canDrawRoute
          ? [
              [dispatcherLat!, dispatcherLng!],
              [jobLat!, jobLng!],
            ]
          : [[jobLat!, jobLng!]]
      )
      map.fitBounds(bounds.pad(canDrawRoute ? 0.35 : 0.2))
    })
  }, [mapReady, hasJobPin, canDrawRoute, dispatcherLat, dispatcherLng, jobLat, jobLng])

  if (!hasJobPin) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground",
          className
        )}
      >
        <MapPinned className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        Pick a verified address to preview travel distance on the map.
      </div>
    )
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-zinc-950">
        <div ref={containerRef} className="h-[11rem] w-full" aria-label="Travel map preview" />
        {!mapReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden />
          {canDrawRoute && distanceMiles != null ? (
            <span>
              About{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatDistanceMiles(distanceMiles)}
              </span>
              {travelMinutes != null ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatTravelMinutes(travelMinutes)}
                  </span>{" "}
                  drive
                </>
              ) : null}{" "}
              from you
            </span>
          ) : locationStatus === "requesting" ? (
            <span>Finding your location…</span>
          ) : locationStatus === "denied" || locationStatus === "unsupported" ? (
            <span className="text-amber-200/90">{locationError ?? "Enable location to see distance from you."}</span>
          ) : (
            <span>Waiting for your location…</span>
          )}
        </div>
        {canDrawRoute && distanceMiles != null ? (
          <span className="flex items-center gap-1.5">
            <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 font-semibold tabular-nums text-cyan-200">
              {formatDistanceMiles(distanceMiles)}
            </span>
            {travelMinutes != null ? (
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-semibold tabular-nums text-emerald-200">
                {formatTravelMinutes(travelMinutes)}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
})
