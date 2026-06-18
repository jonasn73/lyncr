// Owner live dispatch map: plots geocoded booked-job markers (emerald pins) and field techs'
// last-known positions (status-colored dots) on a free OpenStreetMap/CARTO basemap (no API key).
// Tech dots move in real time via the owner Pusher channel; a 25s poll is the safety net.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MapPinned, X, Loader2, Phone } from "lucide-react"
import "leaflet/dist/leaflet.css"
import type { Map as LeafletMap, Marker } from "leaflet"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import type { DispatchJob, FieldTechnician, TechLiveLocation } from "@/lib/types"

// Status → dot color for tech live markers.
const TECH_COLOR: Record<string, string> = {
  en_route: "#38bdf8", // sky
  on_site: "#fbbf24", // amber
  idle: "#a1a1aa", // zinc
}

import { loadLeafletClient } from "@/lib/leaflet-client"

type LeafletModule = typeof import("leaflet")

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

export function DispatchLiveMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<LeafletModule | null>(null)
  const jobMarkers = useRef<Map<string, Marker>>(new Map())
  const techMarkers = useRef<Map<string, Marker>>(new Map())
  const didFit = useRef(false)

  const [ready, setReady] = useState(false)
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [techs, setTechs] = useState<TechLiveLocation[]>([])
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

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

  // Create the Leaflet map once, client-side only.
  useEffect(() => {
    let cancelled = false
    let created: LeafletMap | null = null
    void (async () => {
      const L = await loadLeafletClient()
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      created = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(
        [39.5, -98.35],
        4
      )
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
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
      jobMarkers.current.clear()
      techMarkers.current.clear()
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

    // Frame everything once, the first time we have points (don't fight the user's panning after).
    if (!didFit.current) {
      const pts: [number, number][] = [
        ...plottableJobs.map((j) => [j.latitude as number, j.longitude as number] as [number, number]),
        ...techs.map((t) => [t.latitude, t.longitude] as [number, number]),
      ]
      if (pts.length === 1) {
        map.setView(pts[0], 13)
        didFit.current = true
      } else if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 })
        didFit.current = true
      }
    }
  }, [ready, jobs, techs])

  const plottableCount = jobs.filter((j) => j.latitude != null && j.longitude != null).length + techs.length
  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null

  // Nothing geocoded or live yet → don't show an empty map.
  if (plottableCount === 0) return null

  return (
    <WorkspacePanel className="mb-4 p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
          <MapPinned className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Live dispatch map</h2>
          <p className="text-xs text-zinc-500">Booked jobs and your techs' real-time positions.</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-400">
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
      <div className="relative">
        <div
          ref={containerRef}
          className="h-72 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        />

        {selectedJob && (
          <div className="absolute right-3 top-3 z-[1200] w-64 rounded-xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl backdrop-blur">
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
    </WorkspacePanel>
  )
}
