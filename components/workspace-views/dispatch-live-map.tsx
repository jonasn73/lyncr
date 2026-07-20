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
import type { DispatchJob } from "@/lib/types"
import {
  LYNCR_FOCUS_DISPATCH_MAP_EVENT,
  consumePendingFocusDispatchMap,
  emitReturnToIntakeFromMap,
  type FocusDispatchMapDetail,
} from "@/lib/dispatch-map-focus"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import {
  clearSharedDispatchMapView,
  getSharedDispatchMapView,
  setSharedDispatchMapView,
} from "@/lib/dispatch-map-view"
import { useDispatcherLocation } from "@/lib/hooks/use-dispatcher-location"
import { useDispatchMapData } from "@/lib/hooks/use-dispatch-map-data"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { calculateTechETA } from "@/lib/dispatch-eta"
import { estimateTravelMinutes, formatDistanceMiles, travelDistanceMiles } from "@/lib/geo"
import { googleMapsDirectionsUrl } from "@/lib/google-maps-search-url"
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

/** City / metro overview — avoid street-level zoom for dispatch (was feeling too tight). */
const HOME_SERVICE_CITY_ZOOM = 12
/** Cap auto-fit so You + nearby job pins don’t slam into block-level zoom. */
const AUTO_FIT_MAX_ZOOM = 12
/** Zoom when focusing a single job from the Job Pool (still tighter than overview). */
const FOCUS_JOB_ZOOM = 13

/** True for phone-width viewports OR Leaflet's mobile UA — single-finger drag traps page scroll. */
function isMobileMapViewport(L?: LeafletModule): boolean {
  if (typeof window === "undefined") return false
  // Prefer Leaflet's own mobile detection when available (matches dragging={!L.Browser.mobile}).
  if (L?.Browser?.mobile) return true
  return window.matchMedia("(max-width: 767px)").matches
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Green = scheduled/assigned · Red = unassigned / intake pool. */
function jobIcon(L: LeafletModule, assigned: boolean) {
  const fill = assigned ? "#10b981" : "#f43f5e"
  const border = assigned ? "#064e3b" : "#881337"
  const glow = assigned ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.35)"
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50% 50% 50% 0;background:${fill};border:2px solid ${border};transform:rotate(-45deg);box-shadow:0 0 0 2px ${glow}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  })
}

/** Amber diamond for CRM quote / callback leads (Show Leads layer). */
function leadIcon(L: LeafletModule) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:2px;background:#f59e0b;border:2px solid #78350f;transform:rotate(45deg);box-shadow:0 0 0 2px rgba(245,158,11,0.3)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

/** Pulsing neon-blue locator for the logged-in dispatcher/tech. */
function youAreHereIcon(L: LeafletModule) {
  return L.divIcon({
    className: "lyncr-you-are-here-marker",
    html:
      `<span class="lyncr-you-are-here" aria-hidden="true">` +
      `<span class="lyncr-you-are-here__pulse"></span>` +
      `<span class="lyncr-you-are-here__dot"></span>` +
      `</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function vehicleLineFromJob(job: DispatchJob): string | null {
  const parts = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
  if (parts.length) return parts.join(" ")
  const summary = (job.summary ?? "").trim()
  // Summary often looks like "Key replacement — … — 2019 MAZDA CX-3 — Harrison"
  const ymm = summary.match(/\b(19|20)\d{2}\s+[A-Z][A-Z0-9 \-]+/i)
  return ymm?.[0]?.trim() || summary || null
}

/** Best display name for a job pin (customer → summary → phone). */
function jobCustomerLabel(job: DispatchJob): string {
  const name = (job.customer_name ?? "").trim()
  if (name) return name
  const summary = (job.summary ?? "").trim()
  if (summary) {
    // Prefer the leading “Customer — …” segment when present.
    const head = summary.split("—")[0]?.trim() || summary
    if (head && head.length < 48) return head
  }
  const phone = (job.customer_phone ?? "").trim()
  if (phone) return phone
  return "Customer"
}

/** Hover tooltip — customer name first (desktop hover / long-press on some phones). */
function jobHoverTooltipHtml(job: DispatchJob): string {
  const name = escapeHtml(jobCustomerLabel(job))
  const vehicle = vehicleLineFromJob(job)
  const vehicleLine = vehicle
    ? `<div class="lyncr-map-hover-tooltip__line">${escapeHtml(vehicle)}</div>`
    : ""
  return (
    `<div class="lyncr-map-hover-tooltip__name">${name}</div>` + vehicleLine
  )
}

/** Proximity radar popup HTML for a job pin. */
function jobProximityPopupHtml(
  job: DispatchJob,
  userLocation: { lat: number; lng: number } | null
): string {
  const name = jobCustomerLabel(job)
  const vehicle = vehicleLineFromJob(job)
  const title = vehicle ? `${name} — ${vehicle}` : name
  const address = (job.location ?? "").trim() || "No service address on file"
  const lat = job.latitude as number
  const lng = job.longitude as number
  let milesLine = "📐 Distance unavailable — enable location to see proximity"
  if (userLocation) {
    const miles = travelDistanceMiles(userLocation, { lat, lng })
    milesLine = `📐 approx. ${formatDistanceMiles(miles)} away from you`
  }
  const navHref = googleMapsDirectionsUrl({
    toLat: lat,
    toLng: lng,
    fromLat: userLocation?.lat ?? null,
    fromLng: userLocation?.lng ?? null,
    destinationLabel: job.location,
  })
  return (
    `<div class="lyncr-proximity-popup">` +
    `<p class="lyncr-proximity-popup__title">${escapeHtml(title)}</p>` +
    `<p class="lyncr-proximity-popup__address">${escapeHtml(address)}</p>` +
    `<p class="lyncr-proximity-popup__miles">${escapeHtml(milesLine)}</p>` +
    `<a class="lyncr-proximity-popup__nav" href="${escapeHtml(navHref)}" target="_blank" rel="noopener noreferrer">[ 🗺️ Navigate to Job ]</a>` +
    `</div>`
  )
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

export type DispatchMapLayers = {
  /** Active / unassigned field job pins (default on). */
  jobs: boolean
  /** Live tech GPS dots (default on). */
  techs: boolean
  /** Logged-in dispatcher "You" pin (default on). */
  you: boolean
  /** CRM quote / callback lead pins (default off). */
  leads: boolean
}

const DEFAULT_LAYERS: DispatchMapLayers = {
  jobs: true,
  techs: true,
  you: true,
  leads: false,
}

export function DispatchLiveMap({
  fullViewport = false,
  className,
  layers: layersProp,
  focusJobId = null,
  onFocusJobConsumed,
  hideChrome = false,
  fillParent = false,
}: {
  /** Map tab: tall full-bleed canvas that always mounts (even with no pins yet). */
  fullViewport?: boolean
  className?: string
  /** Layer visibility toggles from the unified Map tab. */
  layers?: Partial<DispatchMapLayers>
  /** When set, pan/zoom the map to this job pin (Job Pool click). */
  focusJobId?: string | null
  onFocusJobConsumed?: () => void
  /** Hide legend / empty-state copy — Map tab draws its own chrome. */
  hideChrome?: boolean
  /** Stretch to fill a parent flex container (unified Map tab). */
  fillParent?: boolean
}) {
  const layers: DispatchMapLayers = { ...DEFAULT_LAYERS, ...layersProp }
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const jobMarkers = useRef<Map<string, Marker>>(new Map())
  const techMarkers = useRef<Map<string, Marker>>(new Map())
  const destinationMarkerRef = useRef<Marker | null>(null)
  const userMarkerRef = useRef<Marker | null>(null)
  const didFit = useRef(false)
  const didCenterOnUser = useRef(false)
  /** Signature of plottable job pins — unlock camera only when this set changes. */
  const lastJobPinSig = useRef("")

  const [ready, setReady] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [destination, setDestination] = useState<FocusDispatchMapDetail | null>(null)
  /** Optimistic assign overrides until SWR revalidates. */
  const [jobOverrides, setJobOverrides] = useState<Record<string, Partial<DispatchJob>>>({})

  const { activeOrganizationId } = useDashboardWorkspace()

  // Shared SWR cache — Map tab and Activities embed show the same active pins.
  const { data: mapData, mutate: mutateMapData } = useDispatchMapData(activeOrganizationId)
  const technicians = mapData?.technicians ?? []
  const ownerUserId = mapData?.ownerUserId ?? null
  const techs = mapData?.techs ?? []
  const leadJobs = mapData?.leadJobs ?? []
  const jobs = useMemo(() => {
    const base = mapData?.jobs ?? []
    if (Object.keys(jobOverrides).length === 0) return base
    return base.map((job) => {
      const patch = jobOverrides[job.id]
      return patch ? { ...job, ...patch } : job
    })
  }, [mapData?.jobs, jobOverrides])

  /** Pins currently allowed by layer toggles. */
  const visibleJobs = useMemo(() => {
    const out: DispatchJob[] = []
    if (layers.jobs) out.push(...jobs)
    if (layers.leads) {
      const activeIds = new Set(jobs.map((j) => j.id))
      for (const lead of leadJobs) {
        if (!activeIds.has(lead.id)) out.push(lead)
      }
    }
    return out
  }, [jobs, leadJobs, layers.jobs, layers.leads])

  // Always track the logged-in operator on the Dispatch Map (proximity radar).
  const dispatcherLocation = useDispatcherLocation(true)

  const userLocation = useMemo(() => {
    if (
      dispatcherLocation.status === "ready" &&
      dispatcherLocation.lat != null &&
      dispatcherLocation.lng != null
    ) {
      return { lat: dispatcherLocation.lat, lng: dispatcherLocation.lng }
    }
    return null
  }, [dispatcherLocation.lat, dispatcherLocation.lng, dispatcherLocation.status])

  // Prefer live GPS; fall back to the business home city (Louisville 502) baseline.
  const originPoint = useMemo(() => {
    if (userLocation) {
      return { lat: userLocation.lat, lng: userLocation.lng, source: "gps" as const }
    }
    return {
      lat: DEFAULT_502_SERVICE_BIAS.lat,
      lng: DEFAULT_502_SERVICE_BIAS.lon,
      source: "business" as const,
    }
  }, [userLocation])

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

  const plottableJobCount = useMemo(
    () =>
      visibleJobs.filter(
        (j) => coerceMapCoord(j.latitude) != null && coerceMapCoord(j.longitude) != null
      ).length,
    [visibleJobs]
  )
  const plottableTechCount = layers.techs ? techs.length : 0
  const plottableCount = plottableJobCount + plottableTechCount + (destination ? 1 : 0)
  // Map tab always mounts; embedded modes wait until something is plottable.
  const mapShellVisible = fullViewport || fillParent || plottableCount > 0

  // Unlock camera when the shared active-pin set changes.
  useEffect(() => {
    const pinSig = visibleJobs
      .filter(
        (j) => coerceMapCoord(j.latitude) != null && coerceMapCoord(j.longitude) != null
      )
      .map((j) => `${j.id}:${j.latitude},${j.longitude}`)
      .sort()
      .join("|")
    if (pinSig !== lastJobPinSig.current) {
      lastJobPinSig.current = pinSig
      // Keep a shared camera if the user already panned on the other tab.
      if (!getSharedDispatchMapView()) didFit.current = false
    }
  }, [visibleJobs])

  // Job Pool drawer click → center map on that pin.
  useEffect(() => {
    if (!focusJobId || !ready) return
    const map = mapRef.current
    const job = visibleJobs.find((j) => j.id === focusJobId) ?? jobs.find((j) => j.id === focusJobId)
    if (!map || !job) {
      onFocusJobConsumed?.()
      return
    }
    const lat = coerceMapCoord(job.latitude)
    const lng = coerceMapCoord(job.longitude)
    if (lat == null || lng == null) {
      onFocusJobConsumed?.()
      return
    }
    map.setView([lat, lng], FOCUS_JOB_ZOOM)
    setSharedDispatchMapView([lat, lng], FOCUS_JOB_ZOOM)
    setSelectedJobId(job.id)
    didFit.current = true
    onFocusJobConsumed?.()
  }, [focusJobId, ready, visibleJobs, jobs, onFocusJobConsumed])

  // Assign (or clear) a tech straight from a map pin — same endpoint as the dispatch board.
  const assign = useCallback(
    async (jobId: string, techUserId: string) => {
      const next = techUserId || null
      setSavingId(jobId)
      setJobOverrides((prev) => ({
        ...prev,
        [jobId]: {
          assigned_tech_id: next,
          assigned_tech_name: technicians.find((t) => t.portal_user_id === next)?.name ?? null,
          job_status: next ? "assigned" : "UNASSIGNED",
        },
      }))
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
        setJobOverrides({})
        void mutateMapData()
      }
    },
    [technicians, mutateMapData]
  )

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

  // Create the Leaflet map when the map shell is actually mounted in the DOM.
  // Activities hides the shell until jobs load — init must wait for that, or you get a blank gray box.
  useEffect(() => {
    if (!mapShellVisible) return

    let cancelled = false
    let created: LeafletMap | null = null
    let media: MediaQueryList | null = null
    let resizeObserver: ResizeObserver | null = null
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
      map.invalidateSize()
    }
    void (async () => {
      const L = await loadLeafletClient()
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      // Force cooperative single-finger scroll on phones (dragging={!L.Browser.mobile}).
      const mobile = isMobileMapViewport(L)
      // Default to the business home service city (Louisville 502), not the full US.
      // Prefer the shared camera from the other tab (Map ↔ Activities).
      const shared = getSharedDispatchMapView()
      const startCenter: [number, number] = shared?.center ?? [
        DEFAULT_502_SERVICE_BIAS.lat,
        DEFAULT_502_SERVICE_BIAS.lon,
      ]
      const startZoom = shared?.zoom ?? HOME_SERVICE_CITY_ZOOM
      created = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        // Single-finger pan off on mobile so the parent page scrolls smoothly.
        dragging: !mobile,
        scrollWheelZoom: false,
        // Pinch-to-zoom still works when dragging is off.
        touchZoom: true,
      }).setView(startCenter, startZoom)
      if (shared) {
        didFit.current = true
        didCenterOnUser.current = true
      }
      // Let the browser own one-finger vertical scroll over the map canvas.
      if (mobile && containerRef.current) {
        containerRef.current.style.touchAction = "pan-y"
      }
      attachBaseMapTiles(L, created)
      // Keep Map tab + Activities embed on the same center/zoom after pan.
      const persistView = () => {
        const center = created!.getCenter()
        setSharedDispatchMapView([center.lat, center.lng], created!.getZoom())
      }
      created.on("moveend", persistView)
      created.on("zoomend", persistView)
      mapRef.current = created
      setReady(true)
      // Container often gains its real size one frame after mount — force Leaflet to paint tiles.
      requestAnimationFrame(() => {
        if (!cancelled) created?.invalidateSize()
      })
      // Unified Map tab: redraw when the drawer resizes the map pane.
      if (fillParent && containerRef.current && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          created?.invalidateSize({ animate: false })
        })
        resizeObserver.observe(containerRef.current)
      }
      media = window.matchMedia("(max-width: 767px)")
      media.addEventListener("change", onViewportChange)
    })()
    return () => {
      cancelled = true
      media?.removeEventListener("change", onViewportChange)
      resizeObserver?.disconnect()
      if (created) {
        created.off("moveend")
        created.off("zoomend")
        created.remove()
      }
      mapRef.current = null
      leafletRef.current = null
      jobMarkers.current.clear()
      techMarkers.current.clear()
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove()
        destinationMarkerRef.current = null
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.remove()
        userMarkerRef.current = null
      }
      didCenterOnUser.current = false
      didFit.current = false
      setReady(false)
    }
  }, [mapShellVisible, fillParent])

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
      if (!data?.techUserId || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
        return
      }
      // Patch shared SWR cache so both map instances move the same tech pin.
      void mutateMapData(
        (prev) => {
          if (!prev) return prev
          const nextTechs = prev.techs.filter((t) => t.tech_user_id !== data.techUserId)
          nextTechs.push({
            tech_user_id: data.techUserId!,
            name: data.name || "Technician",
            status: data.status || null,
            latitude: data.latitude!,
            longitude: data.longitude!,
          })
          return { ...prev, techs: nextTechs }
        },
        { revalidate: false }
      )
    }
    const onJobStatus = () => {
      void mutateMapData()
    }

    channel.bind("tech-location-updated", onTechMove)
    channel.bind("job-status-updated", onJobStatus)
    channel.bind("job-booked", onJobStatus)
    return () => {
      channel.unbind("tech-location-updated", onTechMove)
      channel.unbind("job-status-updated", onJobStatus)
      channel.unbind("job-booked", onJobStatus)
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, mutateMapData])

  // Sync markers whenever data / live GPS changes.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!ready || !L || !map) return

    const plottableJobs = visibleJobs.filter(
      (j) =>
        coerceMapCoord(j.latitude) != null &&
        coerceMapCoord(j.longitude) != null
    )

    // Job / lead pins + proximity popups (icons differ by layer).
    const leadIds = new Set(leadJobs.map((j) => j.id))
    const seenJobs = new Set<string>()
    for (const job of plottableJobs) {
      seenJobs.add(job.id)
      const isLead = leadIds.has(job.id) && !jobs.some((j) => j.id === job.id)
      const assigned = Boolean(job.assigned_tech_id?.trim())
      const lat = coerceMapCoord(job.latitude)!
      const lng = coerceMapCoord(job.longitude)!
      const pos: [number, number] = [lat, lng]
      const popupHtml = jobProximityPopupHtml(job, userLocation)
      const tooltipHtml = jobHoverTooltipHtml(job)
      const icon = isLead ? leadIcon(L) : jobIcon(L, assigned)
      const existing = jobMarkers.current.get(job.id)
      if (existing) {
        existing.setLatLng(pos)
        existing.setIcon(icon)
        existing.setPopupContent(popupHtml)
        existing.unbindTooltip()
        existing.bindTooltip(tooltipHtml, {
          direction: "top",
          offset: [0, -12],
          opacity: 1,
          className: "lyncr-map-hover-tooltip",
          sticky: true,
        })
      } else {
        const jobId = job.id
        const m = L.marker(pos, { icon })
          .addTo(map)
          .bindPopup(popupHtml, { maxWidth: 300 })
          .bindTooltip(tooltipHtml, {
            direction: "top",
            offset: [0, -12],
            opacity: 1,
            className: "lyncr-map-hover-tooltip",
            sticky: true,
          })
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

    // Live tech dots (respect Show Techs layer toggle).
    const seenTechs = new Set<string>()
    if (layers.techs) {
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

    // Live “You are here” locator (respect Show You layer toggle).
    if (layers.you && userLocation) {
      const pos: [number, number] = [userLocation.lat, userLocation.lng]
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(pos)
      } else {
        userMarkerRef.current = L.marker(pos, {
          icon: youAreHereIcon(L),
          zIndexOffset: 1000,
        })
          .addTo(map)
          .bindTooltip("Your Location (You)", {
            permanent: true,
            direction: "top",
            offset: [0, -16],
            className: "lyncr-you-are-here-label",
            opacity: 1,
          })
      }
      // First GPS fix only when nothing else is plottable yet — never lock didFit on You alone.
      if (!didCenterOnUser.current && plottableJobs.length === 0 && !destination) {
        map.setView(pos, HOME_SERVICE_CITY_ZOOM)
        didCenterOnUser.current = true
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove()
      userMarkerRef.current = null
    }

    // Frame work pins (jobs / techs / intake). You-alone must not lock the camera forever.
    const workPts: [number, number][] = [
      ...plottableJobs.map((j) => {
        const lat = coerceMapCoord(j.latitude)!
        const lng = coerceMapCoord(j.longitude)!
        return [lat, lng] as [number, number]
      }),
      ...(layers.techs ? techs.map((t) => [t.latitude, t.longitude] as [number, number]) : []),
    ]
    if (destination) workPts.push([destination.lat, destination.lng])

    if (!didFit.current) {
      if (workPts.length === 0) {
        if (!didCenterOnUser.current) {
          map.setView(
            [DEFAULT_502_SERVICE_BIAS.lat, DEFAULT_502_SERVICE_BIAS.lon],
            HOME_SERVICE_CITY_ZOOM
          )
        }
        // Leave didFit false so the first real work pin(s) still trigger a fit.
      } else {
        const pts: [number, number][] = [...workPts]
        if (layers.you && userLocation) pts.push([userLocation.lat, userLocation.lng])
        if (pts.length === 1) {
          map.setView(pts[0], HOME_SERVICE_CITY_ZOOM)
        } else {
          // Wide padding + low maxZoom keeps a city overview when pins are close together.
          map.fitBounds(L.latLngBounds(pts), {
            padding: [72, 72],
            maxZoom: AUTO_FIT_MAX_ZOOM,
          })
        }
        didFit.current = true
        didCenterOnUser.current = true
        const center = map.getCenter()
        setSharedDispatchMapView([center.lat, center.lng], map.getZoom())
      }
    }
  }, [ready, visibleJobs, jobs, leadJobs, techs, destination, userLocation, layers.techs, layers.you])

  const selectedJob =
    selectedJobId
      ? visibleJobs.find((j) => j.id === selectedJobId) ??
        jobs.find((j) => j.id === selectedJobId) ??
        null
      : null

  // Embedded on Team/routing — hide when empty. Map tab always shows the canvas.
  if (!mapShellVisible) return null

  const mapCanvas = (
    <div className={cn("relative", fillParent && "h-full min-h-0 flex-1")}>
      <div
        ref={containerRef}
        className={cn(
          "w-full overflow-hidden border border-zinc-800 bg-zinc-900",
          // One-finger vertical swipes scroll the page; pinch still zooms the map.
          "touch-pan-y",
          fillParent
            ? "h-full min-h-[20rem] rounded-none border-0"
            : fullViewport
              ? "h-[min(70vh,34rem)] rounded-2xl"
              : "h-72 rounded-xl"
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
            data-return-to-intake=""
            onPointerDown={(e) => {
              // Keep the click; only block bubble so Sheet outside listeners ignore this press.
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // Re-open the minimized CallAnsweredModal intake drawer + leave Map tab.
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
                {jobCustomerLabel(selectedJob)}
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

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
        </span>
        You
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Assigned
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Unassigned
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white/80" /> Intake target
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Tech
      </span>
    </div>
  )

  const locationHint =
    dispatcherLocation.status === "denied" ? (
      <p className="mt-2 text-center text-xs text-amber-400/90">
        Location permission blocked — allow GPS to see proximity miles on job pins.
      </p>
    ) : dispatcherLocation.status === "requesting" && !userLocation ? (
      <p className="mt-2 text-center text-xs text-slate-500">Locating you…</p>
    ) : null

  // Unified Map tab — canvas only; parent owns layer toggles + drawers.
  if (fillParent || hideChrome) {
    return (
      <section
        className={cn("flex h-full min-h-0 w-full flex-col", className)}
        aria-label="Operational dispatch map"
      >
        {mapCanvas}
      </section>
    )
  }

  if (fullViewport) {
    return (
      <section className={cn("w-full", className)} aria-label="Operational dispatch map">
        <div className="mb-3">{legend}</div>
        {mapCanvas}
        {locationHint}
        {plottableJobCount === 0 ? (
          <p className="mt-2 text-center text-xs text-slate-500">
            {jobs.length === 0
              ? "No active dispatch jobs yet — open hopper jobs and assigned field work pin here (quote leads stay on Leads)."
              : "Active jobs are loaded but need a street address (or ZIP) before they can pin on the map."}
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
          <p className="text-xs text-zinc-500">
            Active dispatch pins — tap a pin for proximity.
          </p>
        </div>
        <div className="sm:ml-auto">{legend}</div>
      </div>
      {mapCanvas}
      {locationHint}
    </WorkspacePanel>
  )
}
