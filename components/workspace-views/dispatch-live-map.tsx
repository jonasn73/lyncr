// Owner live dispatch map: plots geocoded booked-job markers (emerald pins) and field techs'
// last-known positions (status-colored dots) on a free OpenStreetMap/CARTO basemap (no API key).
// Tech dots move in real time via the owner Pusher channel; a 25s poll is the safety net.

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, MapPinned, X, Loader2, Phone } from "lucide-react"
import "leaflet/dist/leaflet.css"
import "@/app/leaflet-popup-overrides.css"
import type { Map as LeafletMap, Marker } from "leaflet"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import type { DispatchJob, FieldTechnician, TechLiveLocation } from "@/lib/types"
import {
  LYNCR_FOCUS_DISPATCH_MAP_EVENT,
  consumePendingFocusDispatchMap,
  emitReturnToIntakeFromMap,
  type FocusDispatchMapDetail,
} from "@/lib/dispatch-map-focus"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import { calculateTechETA } from "@/lib/dispatch-eta"
import { estimateTravelMinutes, travelDistanceMiles } from "@/lib/geo"
import { cn } from "@/lib/utils"

// Status → dot color for tech live markers.
const TECH_COLOR: Record<string, string> = {
  en_route: "#38bdf8", // sky
  on_site: "#fbbf24", // amber
  idle: "#a1a1aa", // zinc
}

import { loadLeafletClient } from "@/lib/leaflet-client"
import { attachBaseMapTiles } from "@/lib/map-tiles"
import { DEFAULT_502_SERVICE_BIAS } from "@/lib/geocode-service-bias"

type LeafletModule = typeof import("leaflet")

/** City-level zoom when no live pins are on the map yet. */
const HOME_SERVICE_CITY_ZOOM = 11

/** True for phone-width viewports OR Leaflet's mobile UA — single-finger drag traps page scroll. */
function isMobileMapViewport(L?: LeafletModule): boolean {
  if (typeof window === "undefined") return false
  // Prefer Leaflet's own mobile detection when available (matches dragging={!L.Browser.mobile}).
  if (L?.Browser?.mobile) return true
  return window.matchMedia("(max-width: 767px)").matches
}

/** Branded HTML marker icons (no external image assets → no bundler icon-path issues). */
function jobIcon(L: LeafletModule) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50% 50% 50% 0;background:#10b981;border:2px solid #064e3b;transform:rotate(-45deg);box-shadow:0 0 0 2px rgba(16,185,129,0.25)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  })
}

function techIcon(L: LeafletModule, status: string | null) {
  const color = TECH_COLOR[status || "idle"] || TECH_COLOR.idle
  const pulse = status === "en_route" || status === "on_site"
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #18181b;box-shadow:0 0 0 ${pulse ? "5px" : "2px"} ${color}33"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

/** High-contrast intake destination pin (customer address from PiP → Map). */
function destinationIcon(L: LeafletModule) {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#f43f5e;border:3px solid #fff;box-shadow:0 0 0 4px rgba(244,63,94,0.45),0 4px 14px rgba(0,0,0,0.55)"><span style="width:8px;height:8px;border-radius:50%;background:#fff"></span></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

export function DispatchLiveMap({
  fullViewport = false,
  className,
}: {
  /** Map tab: tall full-bleed canvas that always mounts (even with no pins yet). */
  fullViewport?: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const jobMarkers = useRef<Map<string, Marker>>(new Map())
  const techMarkers = useRef<Map<string, Marker>>(new Map())
  const destinationMarkerRef = useRef<Marker | null>(null)
  const didFit = useRef(false)

  const [ready, setReady] = useState(false)
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [techs, setTechs] = useState<TechLiveLocation[]>([])
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [destination, setDestination] = useState<FocusDispatchMapDetail | null>(null)

  // Ask the browser for the operator's GPS while an intake pin is on the map.
  const dispatcherLocation = useDispatcherLocation(Boolean(destination))

  // Prefer live GPS; fall back to the business home city (Louisville 502) baseline.
  const originPoint = useMemo(() => {
    if (
      dispatcherLocation.status === "ready" &&
      dispatcherLocation.lat != null &&
      dispatcherLocation.lng != null
    ) {
      return { lat: dispatcherLocation.lat, lng: dispatcherLocation.lng, source: "gps" as const }
    }
    return {
      lat: DEFAULT_502_SERVICE_BIAS.lat,
      lng: DEFAULT_502_SERVICE_BIAS.lon,
      source: "business" as const,
    }
  }, [dispatcherLocation.lat, dispatcherLocation.lng, dispatcherLocation.status])

  // Straight-line miles + rough drive minutes from origin → intake target.
  const travelMetrics = useMemo(() => {
    if (!destination) return null
    const miles = travelDistanceMiles(originPoint, { lat: destination.lat, lng: destination.lng })
    if (!Number.isFinite(miles) || miles < 0) return null
    return {
      miles,
      durationMins: estimateTravelMinutes(miles),
      fromGps: originPoint.source === "gps",
    }
  }, [destination, originPoint])

  // Closest live tech pin to the intake destination (haversine proximity).
  const nearestTech = useMemo(() => {
    if (!destination || techs.length === 0) return null
    let best: { name: string; miles: number } | null = null
    for (const tech of techs) {
      const eta = calculateTechETA(
        { lat: destination.lat, lng: destination.lng },
        { lat: tech.latitude, lng: tech.longitude }
      )
      if (!eta) continue
      if (!best || eta.straightLineMiles < best.miles) {
        best = { name: tech.name || "Technician", miles: eta.straightLineMiles }
      }
    }
    return best
  }, [destination, techs])

  const load = useCallback(() => {
    fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then(
        (j: {
          data?: {
            jobs?: DispatchJob[]
            technicians?: FieldTechnician[]
            techLocations?: TechLiveLocation[]
            ownerUserId?: string
          }
        }) => {
          setJobs(Array.isArray(j.data?.jobs) ? j.data!.jobs! : [])
          setTechs(Array.isArray(j.data?.techLocations) ? j.data!.techLocations! : [])
          setTechnicians(Array.isArray(j.data?.technicians) ? j.data!.technicians! : [])
          if (j.data?.ownerUserId) setOwnerUserId(j.data.ownerUserId)
        }
      )
      .catch(() => {})
  }, [])

  // Assign (or clear) a tech straight from a map pin — same endpoint as the dispatch board.
  const assign = useCallback(
    async (jobId: string, techUserId: string) => {
      const next = techUserId || null
      setSavingId(jobId)
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                assigned_tech_id: next,
                assigned_tech_name: technicians.find((t) => t.portal_user_id === next)?.name ?? null,
                job_status: next ? j.job_status || "assigned" : null,
              }
            : j
        )
      )
      try {
        await fetch("/api/owner/jobs/assign", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: jobId, techUserId: next }),
        })
      } catch {
        /* poll will reconcile */
      } finally {
        setSavingId(null)
        load()
      }
    },
    [technicians, load]
  )

  // Initial fetch + polling safety net.
  useEffect(() => {
    load()
    const t = setInterval(load, 25_000)
    return () => clearInterval(t)
  }, [load])

  // Intake "View on Map Layout" — drop / refresh the high-contrast destination pin.
  useEffect(() => {
    const pending = consumePendingFocusDispatchMap()
    if (pending && Number.isFinite(pending.lat) && Number.isFinite(pending.lng)) {
      setDestination(pending)
      didFit.current = false
    }
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<FocusDispatchMapDetail>).detail
      if (
        !detail ||
        !Number.isFinite(detail.lat) ||
        !Number.isFinite(detail.lng)
      ) {
        return
      }
      setDestination(detail)
      didFit.current = false
    }
    window.addEventListener(LYNCR_FOCUS_DISPATCH_MAP_EVENT, onFocus)
    return () => window.removeEventListener(LYNCR_FOCUS_DISPATCH_MAP_EVENT, onFocus)
  }, [])

  // Create the Leaflet map once, client-side only.
  useEffect(() => {
    let cancelled = false
    let created: LeafletMap | null = null
    let media: MediaQueryList | null = null
    const onViewportChange = () => {
      const map = mapRef.current
      const L = leafletRef.current
      if (!map || !L) return
      // Mobile: disable one-finger drag so vertical swipes scroll the page.
      const mobile = isMobileMapViewport(L)
      if (mobile) {
        map.dragging.disable()
        map.scrollWheelZoom.disable()
        // Leaflet tap handler can still steal clicks/swipes on some phones.
        const tapHandler = (map as unknown as { tap?: { disable: () => void } }).tap
        tapHandler?.disable()
      } else {
        map.dragging.enable()
        map.scrollWheelZoom.enable()
      }
    }
    void (async () => {
      const L = await loadLeafletClient()
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      // Force cooperative single-finger scroll on phones (dragging={!L.Browser.mobile}).
      const mobile = isMobileMapViewport(L)
      // Default to the business home service city (Louisville 502), not the full US.
      created = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        // Single-finger pan off on mobile so the parent page scrolls smoothly.
        dragging: !mobile,
        scrollWheelZoom: false,
        // Pinch-to-zoom still works when dragging is off.
        touchZoom: true,
        // Disable fast-click / tap hijacking that blocks page scroll on mobile.
        tap: false,
      }).setView(
        [DEFAULT_502_SERVICE_BIAS.lat, DEFAULT_502_SERVICE_BIAS.lon],
        HOME_SERVICE_CITY_ZOOM
      )
      // Let the browser own one-finger vertical scroll over the map canvas.
      if (mobile && containerRef.current) {
        containerRef.current.style.touchAction = "pan-y"
      }
      attachBaseMapTiles(L, created)
      mapRef.current = created
      setReady(true)
      media = window.matchMedia("(max-width: 767px)")
      media.addEventListener("change", onViewportChange)
    })()
    return () => {
      cancelled = true
      media?.removeEventListener("change", onViewportChange)
      if (created) created.remove()
      mapRef.current = null
      jobMarkers.current.clear()
      techMarkers.current.clear()
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove()
        destinationMarkerRef.current = null
      }
    }
  }, [])

  // Live tech moves: nudge the matching dot the instant a tech streams a new position.
  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`owner-${ownerUserId}`)

    const onTechMove = (data: {
      techUserId?: string
      name?: string
      latitude?: number
      longitude?: number
      status?: string
    }) => {
      if (!data?.techUserId || typeof data.latitude !== "number" || typeof data.longitude !== "number") return
      setTechs((prev) => {
        const next = prev.filter((t) => t.tech_user_id !== data.techUserId)
        next.push({
          tech_user_id: data.techUserId!,
          name: data.name || "Technician",
          status: data.status || null,
          latitude: data.latitude!,
          longitude: data.longitude!,
        })
        return next
      })
    }
    const onJobStatus = () => load()

    channel.bind("tech-location-updated", onTechMove)
    channel.bind("job-status-updated", onJobStatus)
    channel.bind("job-booked", onJobStatus)
    return () => {
      channel.unbind("tech-location-updated", onTechMove)
      channel.unbind("job-status-updated", onJobStatus)
      channel.unbind("job-booked", onJobStatus)
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, load])

  // Sync markers whenever data changes.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!ready || !L || !map) return

    const plottableJobs = jobs.filter((j) => j.latitude != null && j.longitude != null)

    // Booked-job pins.
    const seenJobs = new Set<string>()
    for (const job of plottableJobs) {
      seenJobs.add(job.id)
      const pos: [number, number] = [job.latitude as number, job.longitude as number]
      const existing = jobMarkers.current.get(job.id)
      if (existing) {
        existing.setLatLng(pos)
      } else {
        const jobId = job.id
        const m = L.marker(pos, { icon: jobIcon(L) }).addTo(map)
        // Click a job pin → open the inline dispatch/assign panel for that job.
        m.on("click", () => setSelectedJobId(jobId))
        jobMarkers.current.set(job.id, m)
      }
    }
    for (const [id, marker] of jobMarkers.current) {
      if (!seenJobs.has(id)) {
        marker.remove()
        jobMarkers.current.delete(id)
      }
    }

    // Live tech dots.
    const seenTechs = new Set<string>()
    for (const tech of techs) {
      seenTechs.add(tech.tech_user_id)
      const pos: [number, number] = [tech.latitude, tech.longitude]
      const label = `${tech.name}${tech.status ? `<br/><span style="opacity:.7">${tech.status.replace("_", " ")}</span>` : ""}`
      const existing = techMarkers.current.get(tech.tech_user_id)
      if (existing) {
        existing.setLatLng(pos)
        existing.setIcon(techIcon(L, tech.status))
        existing.setPopupContent(label)
      } else {
        const m = L.marker(pos, { icon: techIcon(L, tech.status) }).addTo(map).bindPopup(label)
        techMarkers.current.set(tech.tech_user_id, m)
      }
    }
    for (const [id, marker] of techMarkers.current) {
      if (!seenTechs.has(id)) {
        marker.remove()
        techMarkers.current.delete(id)
      }
    }

    // Destination pin from intake address.
    if (destination) {
      const pos: [number, number] = [destination.lat, destination.lng]
      const popup = [
        `<strong>${destination.label?.trim() || "Intake destination"}</strong>`,
        destination.address ? `<div style="opacity:.8;margin-top:2px">${destination.address}</div>` : "",
      ].join("")
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.setLatLng(pos)
        destinationMarkerRef.current.setPopupContent(popup)
      } else {
        destinationMarkerRef.current = L.marker(pos, {
          icon: destinationIcon(L),
          zIndexOffset: 800,
        })
          .addTo(map)
          .bindPopup(popup)
      }
    } else if (destinationMarkerRef.current) {
      destinationMarkerRef.current.remove()
      destinationMarkerRef.current = null
    }

    // Frame pins once when they appear; with zero live coords stay on home service city.
    if (!didFit.current) {
      const pts: [number, number][] = [
        ...plottableJobs.map((j) => [j.latitude as number, j.longitude as number] as [number, number]),
        ...techs.map((t) => [t.latitude, t.longitude] as [number, number]),
      ]
      if (destination) pts.push([destination.lat, destination.lng])
      if (pts.length === 0) {
        map.setView(
          [DEFAULT_502_SERVICE_BIAS.lat, DEFAULT_502_SERVICE_BIAS.lon],
          HOME_SERVICE_CITY_ZOOM
        )
        // Leave didFit false so the first real pin(s) still trigger a fit.
      } else if (pts.length === 1) {
        map.setView(pts[0], 14)
        didFit.current = true
      } else {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 })
        didFit.current = true
      }
    }
  }, [ready, jobs, techs, destination])

  const plottableCount =
    jobs.filter((j) => j.latitude != null && j.longitude != null).length +
    techs.length +
    (destination ? 1 : 0)
  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null

  // Embedded on Team/routing — hide when empty. Map tab always shows the canvas.
  if (!fullViewport && plottableCount === 0) return null

  const mapCanvas = (
    <div className="relative">
      <div
        ref={containerRef}
        className={cn(
          "w-full overflow-hidden border border-zinc-800 bg-zinc-900",
          // One-finger vertical swipes scroll the page; pinch still zooms the map.
          "touch-pan-y",
          fullViewport ? "h-[min(70vh,34rem)] rounded-2xl" : "h-72 rounded-xl"
        )}
      />

      {destination ? (
        <div
          className="pointer-events-auto absolute left-3 top-3 z-[2000] max-w-[min(20rem,calc(100%-1.5rem))] rounded-xl border border-rose-500/50 bg-slate-950/95 px-3 py-2.5 shadow-xl backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
            Intake target
          </p>
          <p className="truncate text-xs font-semibold text-slate-100">
            {destination.label?.trim() || "Customer location"}
          </p>
          {destination.address ? (
            <div className="mt-0.5 flex items-start gap-1.5">
              {/* Customer street address — keep readable on a narrow floating card. */}
              <p className="min-w-0 flex-1 line-clamp-2 text-[11px] text-slate-400">
                {destination.address}
              </p>
              {/* Opens Google Maps (or the OS maps handler) for native turn-by-turn. */}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Maps"
                aria-label="Open address in Google Maps"
                className="mt-0.5 shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-sky-300"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          ) : null}

          {/* Distance / ETA from operator GPS (or business home city fallback). */}
          {travelMetrics ? (
            <div className="mt-2 space-y-0.5 border-t border-slate-800/80 pt-2 text-[10px] leading-relaxed text-slate-300">
              <p>
                🚗 Distance from current spot:{" "}
                <span className="font-semibold tabular-nums text-slate-100">
                  {travelMetrics.miles < 10
                    ? travelMetrics.miles.toFixed(1)
                    : Math.round(travelMetrics.miles)}{" "}
                  mi
                </span>
                {!travelMetrics.fromGps ? (
                  <span className="text-slate-500"> · shop baseline</span>
                ) : null}
              </p>
              <p>
                ⏱️ Estimated Drive Time:{" "}
                <span className="font-semibold tabular-nums text-slate-100">
                  {travelMetrics.durationMins} mins
                </span>
              </p>
              {nearestTech ? (
                <p className="text-amber-200/90">
                  ⚡ Nearest available tech: {nearestTech.name} (
                  {nearestTech.miles < 10
                    ? nearestTech.miles.toFixed(1)
                    : Math.round(nearestTech.miles)}{" "}
                  mi away)
                </p>
              ) : null}
            </div>
          ) : nearestTech ? (
            <p className="mt-2 border-t border-slate-800/80 pt-2 text-[10px] text-amber-200/90">
              ⚡ Nearest available tech: {nearestTech.name} (
              {nearestTech.miles < 10
                ? nearestTech.miles.toFixed(1)
                : Math.round(nearestTech.miles)}{" "}
              mi away)
            </p>
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDestination(null)
              didFit.current = false
            }}
            className="mt-1.5 text-[10px] font-semibold text-rose-300/90 underline-offset-2 hover:underline"
          >
            Clear pin
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // Re-open the minimized CallAnsweredModal intake drawer.
              emitReturnToIntakeFromMap()
            }}
            className="mt-2 flex w-full touch-manipulation items-center justify-center rounded-lg border border-emerald-400/60 bg-emerald-500 px-3 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_0_1px_rgba(16,185,129,0.35)] transition-colors hover:bg-emerald-400 active:scale-[0.98]"
          >
            ← Return to Intake Form
          </button>
        </div>
      ) : null}

      {selectedJob && (
        <div className="absolute right-3 top-3 z-[1200] w-[min(16rem,calc(100%-1.5rem))] rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {selectedJob.customer_name || selectedJob.customer_phone || "Booked job"}
              </p>
              {selectedJob.location && (
                <p className="mt-0.5 truncate text-xs text-zinc-500">{selectedJob.location}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedJobId(null)}
              className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {selectedJob.customer_phone && (
            <a
              href={`tel:${selectedJob.customer_phone}`}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300"
            >
              <Phone className="h-3 w-3" /> {selectedJob.customer_phone}
            </a>
          )}

          <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Assign technician
          </label>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={selectedJob.assigned_tech_id || ""}
              onChange={(e) => void assign(selectedJob.id, e.target.value)}
              disabled={technicians.length === 0 || savingId === selectedJob.id}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-white outline-none focus:border-violet-500 disabled:opacity-50"
            >
              <option value="">{technicians.length === 0 ? "No techs yet" : "Unassigned"}</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.portal_user_id || ""}>
                  {t.name}
                </option>
              ))}
            </select>
            {savingId === selectedJob.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />}
          </div>
          {selectedJob.assigned_tech_name && (
            <p className="mt-2 text-xs text-emerald-400">Dispatched to {selectedJob.assigned_tech_name}</p>
          )}
        </div>
      )}
    </div>
  )

  if (fullViewport) {
    return (
      <section className={cn("w-full", className)} aria-label="Operational dispatch map">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white/80" /> Intake target
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Job
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Tech
          </span>
        </div>
        {mapCanvas}
        {plottableCount === 0 ? (
          <p className="mt-2 text-center text-xs text-slate-500">
            Waiting for live tech GPS or booked job pins — intake destinations still drop here.
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <WorkspacePanel className={cn("mb-4 p-5", className)}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
          <MapPinned className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Live dispatch map</h2>
          <p className="text-xs text-zinc-500">Booked jobs and your techs&apos; real-time positions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 sm:ml-auto">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Job
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> En route
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> On site
          </span>
        </div>
      </div>
      {mapCanvas}
    </WorkspacePanel>
  )
}
