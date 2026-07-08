// Field tech mobile console: a performance-badge strip, a linear stack of assigned job cards with
// click-to-call / click-to-navigate, and a status toggle (Start Route → Arrived → Complete). While a
// tech is en route or on site, the console quietly streams their location to the dispatch map.
// Live-updates via Pusher (channel technician-{userId}) with a polling fallback.

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MapPin, Phone, CheckCircle2, Navigation, LogOut, RefreshCw, Loader2, Route, Inbox, Car, AlertTriangle } from "lucide-react"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { InvoiceModal } from "@/components/tech/invoice-modal"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import type { TechBadge } from "@/lib/tech-badges"
import type { DispatchJob, UnassignedPoolJob } from "@/lib/types"

/** Universal maps link — opens the default navigation app on iOS/Android. */
function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  en_route: "En route",
  arrived: "On site",
  completed: "Completed",
}

const STATUS_STYLE: Record<string, string> = {
  assigned: "bg-zinc-700/60 text-zinc-200",
  en_route: "bg-sky-500/20 text-sky-300",
  arrived: "bg-amber-500/20 text-amber-200",
  completed: "bg-emerald-500/20 text-emerald-300",
}

/** Derive the tech's overall live status from their active jobs. */
function deriveTechStatus(jobs: DispatchJob[]): "idle" | "en_route" | "on_site" {
  if (jobs.some((j) => j.job_status === "arrived")) return "on_site"
  if (jobs.some((j) => j.job_status === "en_route")) return "en_route"
  return "idle"
}

export function TechConsole(props: {
  techUserId: string
  techName: string
  businessName: string
  merchantConfigured: boolean
}) {
  const router = useRouter()
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [badges, setBadges] = useState<TechBadge[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [invoiceJob, setInvoiceJob] = useState<DispatchJob | null>(null)
  const [poolJobs, setPoolJobs] = useState<UnassignedPoolJob[]>([])
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const [jobsRes, poolRes] = await Promise.all([
        fetch("/api/tech/jobs", { credentials: "include", cache: "no-store" }),
        fetch("/api/tech/jobs/pool", { credentials: "include", cache: "no-store" }),
      ])
      const jobsJson = await jobsRes.json()
      const poolJson = await poolRes.json()
      if (mounted.current && jobsJson?.data) {
        if (jobsJson.data.jobs) setJobs(jobsJson.data.jobs as DispatchJob[])
        if (jobsJson.data.badges) setBadges(jobsJson.data.badges as TechBadge[])
      }
      if (mounted.current && poolJson?.data) {
        setPoolJobs(Array.isArray(poolJson.data.jobs) ? (poolJson.data.jobs as UnassignedPoolJob[]) : [])
      }
    } catch {
      /* keep last jobs on transient error */
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    // Poll as a safety net even when realtime isn't configured.
    const t = setInterval(() => load(), 20_000)
    return () => {
      mounted.current = false
      clearInterval(t)
    }
  }, [load])

  // Live: refetch the moment the dispatcher assigns/updates a job for this tech.
  useEffect(() => {
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`technician-${props.techUserId}`)
    const refetch = () => load()
    channel.bind("job-assigned", refetch)
    channel.bind("job-updated", refetch)
    return () => {
      channel.unbind("job-assigned", refetch)
      channel.unbind("job-updated", refetch)
      pusher.unsubscribe(`technician-${props.techUserId}`)
    }
  }, [props.techUserId, load])

  const techStatus = useMemo(() => deriveTechStatus(jobs), [jobs])

  // Stream live location while en route / on site so the owner can track this tech on the map.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return

    const post = (latitude: number | null, longitude: number | null) => {
      void fetch("/api/tech/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ latitude, longitude, status: techStatus }),
      }).catch(() => {})
    }

    if (techStatus === "idle") {
      post(null, null) // mark off the map when nothing is active
      return
    }

    // Immediate fix, then continuous (throttled) updates.
    navigator.geolocation.getCurrentPosition(
      (p) => post(p.coords.latitude, p.coords.longitude),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
    )

    let lastSent = 0
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now()
        if (now - lastSent < 25_000) return // ~every 25s is plenty for a dispatch map
        lastSent = now
        post(p.coords.latitude, p.coords.longitude)
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [techStatus])

  async function setStatus(jobId: string, status: string) {
    setBusyId(jobId)
    // Optimistic update so the toggle feels instant on a phone.
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, job_status: status } : j)))
    try {
      await fetch(`/api/tech/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      })
    } catch {
      load() // reconcile on failure
    } finally {
      setBusyId(null)
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      /* ignore */
    }
    router.replace("/tech/login")
  }

  async function claimPoolJob(jobId: string) {
    setClaimBusyId(jobId)
    try {
      const res = await fetch(`/api/tech/jobs/${jobId}/claim`, {
        method: "PATCH",
        credentials: "include",
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Could not claim job")
      }
      setPoolJobs((prev) => prev.filter((j) => j.id !== jobId))
      await load()
    } catch {
      await load()
    } finally {
      setClaimBusyId(null)
    }
  }

  const active = jobs.filter((j) => j.job_status !== "completed")
  const done = jobs.filter((j) => j.job_status === "completed")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800/80 bg-[#0b0b12]/95 px-5 py-4 backdrop-blur">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-400">{props.businessName}</p>
          <h1 className="text-lg font-bold leading-tight">Hi, {props.techName.split(" ")[0]}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => load(true)}
            className="rounded-lg p-2 text-zinc-400 transition active:scale-95 hover:text-white"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={signOut}
            className="rounded-lg p-2 text-zinc-400 transition active:scale-95 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-3 px-4 py-5">
        {!loading && <BadgesStrip badges={badges} />}

        {!loading && poolJobs.length > 0 ? (
          <HopperPoolSection jobs={poolJobs} claimBusyId={claimBusyId} onClaim={claimPoolJob} />
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
            <Loader2 className="h-7 w-7 animate-spin" />
            <p className="mt-3 text-sm">Loading your jobs…</p>
          </div>
        ) : active.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-zinc-500">
            <CheckCircle2 className="h-10 w-10 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-400">
              {poolJobs.length > 0 ? "Claim a job from the pool above" : "No jobs assigned yet"}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              {poolJobs.length > 0
                ? "Tap Claim to add an unassigned job to your route."
                : "New dispatches appear here automatically."}
            </p>
          </div>
        ) : (
          <>
            {active.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                busy={busyId === job.id}
                onArrived={() => setStatus(job.id, "arrived")}
                onEnRoute={() => setStatus(job.id, "en_route")}
                onComplete={() => setInvoiceJob(job)}
              />
            ))}

            {done.length > 0 && (
              <div className="pt-4">
                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Completed today
                </p>
                {done.map((job) => (
                  <div
                    key={job.id}
                    className="mb-2 flex items-center justify-between rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-4 py-3 opacity-70"
                  >
                    <span className="truncate text-sm text-zinc-300">
                      {job.customer_name || job.customer_phone || "Job"}
                    </span>
                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      Completed
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {invoiceJob && (
        <InvoiceModal
          job={invoiceJob}
          merchantConfigured={props.merchantConfigured}
          onClose={() => setInvoiceJob(null)}
          onCompleted={() => {
            setInvoiceJob(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function HopperPoolSection(props: {
  jobs: UnassignedPoolJob[]
  claimBusyId: string | null
  onClaim: (jobId: string) => void
}) {
  return (
    <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-amber-200">
          <Inbox className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">Unassigned pool</p>
          <p className="text-[11px] text-zinc-500">{props.jobs.length} job{props.jobs.length === 1 ? "" : "s"} available to claim</p>
        </div>
      </div>
      <ul className="space-y-2">
        {props.jobs.map((job) => {
          const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
          const busy = props.claimBusyId === job.id
          return (
            <li
              key={job.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {job.customer_name || job.customer_phone || "Customer"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">{job.job_type || "Service call"}</p>
                {job.field_verification_required ? (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Verify key style on vehicle before cutting
                  </p>
                ) : null}
                {vehicle ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                    <Car className="h-3 w-3 shrink-0" aria-hidden />
                    {vehicle}
                  </p>
                ) : null}
                {job.neighborhood || job.location ? (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-zinc-600">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span className="line-clamp-2">{job.neighborhood || job.location}</span>
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy || Boolean(props.claimBusyId)}
                onClick={() => props.onClaim(job.id)}
                className="shrink-0 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 transition active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Claim"}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BadgesStrip({ badges }: { badges: TechBadge[] }) {
  if (!badges.length) return null
  const earnedCount = badges.filter((b) => b.earned).length
  return (
    <section className="rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Performance badges</p>
        <span className="text-[11px] font-medium text-zinc-500">
          {earnedCount}/{badges.length} earned
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {badges.map((b) => (
          <div
            key={b.id}
            title={b.description}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition ${
              b.earned
                ? "border-indigo-500/40 bg-indigo-500/10"
                : "border-zinc-800 bg-zinc-950/40 opacity-50 grayscale"
            }`}
          >
            <span className="text-2xl leading-none" aria-hidden>
              {b.emoji}
            </span>
            <span className="text-[10px] font-semibold leading-tight text-zinc-300">{b.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function JobCard(props: {
  job: DispatchJob
  busy: boolean
  onArrived: () => void
  onEnRoute: () => void
  onComplete: () => void
}) {
  const { job } = props
  const status = job.job_status || "assigned"
  const phoneDigits = (job.customer_phone || "").replace(/[^\d+]/g, "")

  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h2 className="truncate text-base font-semibold text-white">
              {job.customer_name || "New customer"}
            </h2>
            {job.field_verification_required ? (
              <span
                title="Verify key style on vehicle before cutting a blank"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : null}
          </div>
          {job.summary && <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{job.summary}</p>}
          {job.field_verification_required ? (
            <p className="mt-1.5 text-[11px] font-medium text-amber-300">
              Field verification required — confirm dashboard / door lock config before programming.
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[status] || STATUS_STYLE.assigned}`}>
          {STATUS_LABEL[status] || "Assigned"}
        </span>
      </div>

      {/* Contact + navigate */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={phoneDigits ? `tel:${phoneDigits}` : undefined}
          className={`flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-2.5 text-sm font-medium transition active:scale-[0.98] ${
            phoneDigits ? "text-white hover:bg-zinc-800" : "pointer-events-none text-zinc-600"
          }`}
        >
          <Phone className="h-4 w-4" /> Call
        </a>
        <a
          href={job.location ? mapsLink(job.location) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/60 px-3 py-2.5 text-sm font-medium transition active:scale-[0.98] ${
            job.location ? "text-white hover:bg-zinc-800" : "pointer-events-none text-zinc-600"
          }`}
        >
          <Navigation className="h-4 w-4" /> Navigate
        </a>
      </div>

      {job.location && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{job.location}</span>
        </p>
      )}

      {/* Status toggle group: Start Route → Arrived → Complete */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <LeftStatusButton {...props} status={status} />
        <button
          onClick={props.onComplete}
          className="rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition active:scale-[0.98]"
        >
          Complete &amp; Invoice
        </button>
      </div>
    </article>
  )
}

/** The left half of the status toggle advances assigned → en_route → arrived. */
function LeftStatusButton(props: {
  status: string
  busy: boolean
  onArrived: () => void
  onEnRoute: () => void
}) {
  if (props.busy) {
    return (
      <button disabled className="rounded-xl bg-zinc-800 px-3 py-3 text-sm font-semibold text-white opacity-60">
        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      </button>
    )
  }
  if (props.status === "assigned") {
    return (
      <button
        onClick={props.onEnRoute}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-3 text-sm font-semibold text-white transition active:scale-[0.98] hover:bg-sky-500"
      >
        <Route className="h-4 w-4" /> Start Route
      </button>
    )
  }
  if (props.status === "en_route") {
    return (
      <button
        onClick={props.onArrived}
        className="rounded-xl bg-zinc-800 px-3 py-3 text-sm font-semibold text-white transition active:scale-[0.98] hover:bg-zinc-700"
      >
        Arrived on Site
      </button>
    )
  }
  // arrived
  return (
    <button
      disabled
      className="rounded-xl bg-amber-500/20 px-3 py-3 text-sm font-semibold text-amber-200 ring-1 ring-amber-500/40"
    >
      On Site
    </button>
  )
}
