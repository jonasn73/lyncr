// Field tech mobile console: shared JobCardSummary spine + status actions
// (Start Route → Arrived → Work Complete → Payment). GPS streams while en route / on site.
// Live-updates via Pusher (channel technician-{userId}) with a polling fallback.
//
// Rendered under the Jobs page's own TechPageHeader — this component owns only the content
// below it (pool + job list + payment sheet), not a header of its own.

"use client"

import type { FieldTechnicianCapabilities } from "@/lib/types"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MapPin,
  Phone,
  Check,
  CheckCircle2,
  Navigation,
  Loader2,
  Route,
  Inbox,
  Car,
  AlertTriangle,
  CreditCard,
} from "lucide-react"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { TechPaymentModal } from "@/components/tech/tech-payment-modal"
import { KeyInventoryScannerLaunchButton } from "@/components/dashboard/key-inventory-scanner"
import { JobCardSummary } from "@/components/jobs/job-card-summary"
import { buildJobCardSummary } from "@/lib/job-card-summary"
import { googleMapsSearchUrl } from "@/lib/google-maps-search-url"
import { vehicleLabelFromParts } from "@/lib/job-pool"
import { cn } from "@/lib/utils"
import type { DispatchJob, UnassignedPoolJob } from "@/lib/types"

/** Derive the tech's overall live status from their active jobs. */
function deriveTechStatus(jobs: DispatchJob[]): "idle" | "en_route" | "on_site" {
  if (
    jobs.some(
      (j) =>
        j.job_status === "arrived" ||
        j.job_status === "work_complete" ||
        j.job_status === "paused_wait" ||
        j.job_status === "paused_parts"
    )
  ) {
    return "on_site"
  }
  if (jobs.some((j) => j.job_status === "en_route")) return "en_route"
  return "idle"
}

export function TechConsole(props: {
  techUserId: string
  /**
   * What the owner has opted this tech into. Hiding is the courtesy — every route below
   * re-checks the same flags server-side — but a button that 403s is worse than no button.
   */
  capabilities: FieldTechnicianCapabilities
}) {
  const canClaimJobs = props.capabilities.job_pool === true
  const canCollectPayment = props.capabilities.collect_payment === true
  const canContactCustomer = props.capabilities.customer_contact === true
  const canLogKeyUsage = props.capabilities.inventory_control === true
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [paymentJob, setPaymentJob] = useState<DispatchJob | null>(null)
  const [poolJobs, setPoolJobs] = useState<UnassignedPoolJob[]>([])
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null)
  /** "Payment received — you're free to leave." — shown once when a waited-on job clears. */
  const [freeToLeaveToast, setFreeToLeaveToast] = useState<string | null>(null)
  const mounted = useRef(true)
  /** Mirrors `jobs` so load() can diff against the previous fetch without depending on it. */
  const jobsRef = useRef<DispatchJob[]>([])
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  const load = useCallback(async () => {
    try {
      const [jobsRes, poolRes] = await Promise.all([
        fetch("/api/tech/jobs", { credentials: "include", cache: "no-store" }),
        canClaimJobs
          ? fetch("/api/tech/jobs/pool", { credentials: "include", cache: "no-store" })
          : null,
      ])
      const jobsJson = await jobsRes.json()
      const poolJson = poolRes ? await poolRes.json() : null
      if (mounted.current && jobsJson?.data?.jobs) {
        const nextJobs = jobsJson.data.jobs as DispatchJob[]
        // A job that was waiting on remote payment just completed — that's the "free to leave" moment.
        const wasWaiting = new Set(
          jobsRef.current.filter((j) => j.payment_pending_remote === true).map((j) => j.id)
        )
        const justCleared = nextJobs.some((j) => wasWaiting.has(j.id) && j.job_status === "completed")
        setJobs(nextJobs)
        if (justCleared) setFreeToLeaveToast("Payment received — you're free to leave.")
      }
      if (mounted.current && poolJson?.data) {
        setPoolJobs(Array.isArray(poolJson.data.jobs) ? (poolJson.data.jobs as UnassignedPoolJob[]) : [])
      }
    } catch {
      /* keep last jobs on transient error */
    } finally {
      if (mounted.current) {
        setLoading(false)
      }
    }
    // Re-created if the grant changes, so a revoked tech stops polling the pool.
  }, [canClaimJobs])

  useEffect(() => {
    mounted.current = true
    load()
    return () => {
      mounted.current = false
    }
  }, [load])

  // Poll as a safety net even when realtime isn't configured — paused while the tab/screen
  // is backgrounded, and slowed once Pusher confirms it's actually delivering job events.
  const canPoll = usePollBudget()
  const [pusherConnected, setPusherConnected] = useState(false)
  useEffect(() => {
    if (!canPoll) return
    const t = setInterval(() => load(), pusherConnected ? 60_000 : 20_000)
    return () => clearInterval(t)
  }, [load, canPoll, pusherConnected])

  // Live: refetch the moment the dispatcher assigns/updates a job for this tech.
  useEffect(() => {
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`technician-${props.techUserId}`)
    const refetch = () => load()
    channel.bind("job-assigned", refetch)
    channel.bind("job-updated", refetch)
    const onStateChange = () => setPusherConnected(pusher.connection.state === "connected")
    pusher.connection.bind("state_change", onStateChange)
    onStateChange()
    return () => {
      channel.unbind("job-assigned", refetch)
      channel.unbind("job-updated", refetch)
      pusher.unsubscribe(`technician-${props.techUserId}`)
      pusher.connection.unbind("state_change", onStateChange)
    }
  }, [props.techUserId, load])

  useEffect(() => {
    if (!freeToLeaveToast) return
    const t = setTimeout(() => setFreeToLeaveToast(null), 6_000)
    return () => clearTimeout(t)
  }, [freeToLeaveToast])

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

  /** Acknowledgment only — never gates Start Route or anything else. */
  async function acceptJob(jobId: string) {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, accepted_at: j.accepted_at ?? new Date().toISOString() } : j))
    )
    try {
      await fetch(`/api/tech/jobs/${jobId}/accept`, { method: "PATCH", credentials: "include" })
    } catch {
      load() // reconcile on failure
    }
  }

  /** Card job: tech never runs the card — office collects, tech just waits. */
  async function officeWillCollect(jobId: string) {
    setBusyId(jobId)
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, payment_pending_remote: true } : j)))
    try {
      await fetch(`/api/tech/jobs/${jobId}/defer-payment`, { method: "PATCH", credentials: "include" })
    } catch {
      load() // reconcile on failure
    } finally {
      setBusyId(null)
    }
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
  // work_complete still counts as active until payment finishes.

  return (
    <>
      {freeToLeaveToast ? (
        <div className="fixed inset-x-4 top-4 z-50 rounded-2xl border border-success/40 bg-success/15 px-4 py-3 text-center text-sm font-semibold text-success shadow-raised backdrop-blur">
          {freeToLeaveToast}
        </div>
      ) : null}

      <main className="flex-1 space-y-3 px-4 py-6">
        {!loading && canClaimJobs && poolJobs.length > 0 ? (
          <HopperPoolSection jobs={poolJobs} claimBusyId={claimBusyId} onClaim={claimPoolJob} />
        ) : null}

        {loading ? (
          <JobListSkeleton />
        ) : active.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
            <CheckCircle2 className="h-11 w-11 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {poolJobs.length > 0 ? "Claim a job from the pool above" : "No jobs assigned yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
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
                onPausedWait={() => setStatus(job.id, "paused_wait")}
                onPausedParts={() => setStatus(job.id, "paused_parts")}
                onWorkComplete={() => setStatus(job.id, "work_complete")}
                onAccept={() => acceptJob(job.id)}
                onCollectedCash={() => setPaymentJob(job)}
                onOfficeWillCollect={() => officeWillCollect(job.id)}
                canContactCustomer={canContactCustomer}
                canCollectPayment={canCollectPayment}
                canLogKeyUsage={canLogKeyUsage}
              />
            ))}

            {done.length > 0 && (
              <div className="pt-4">
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground font-[family-name:var(--font-tech-heading)]">
                  Completed today
                </p>
                {done.map((job) => (
                  <div
                    key={job.id}
                    className="mb-2 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-3 opacity-70"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground/80 font-[family-name:var(--font-tech-heading)]">
                      {(job.customer_name || job.customer_phone || "?").trim()[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {job.customer_name || job.customer_phone || "Job"}
                    </span>
                    <span className="shrink-0 rounded-full bg-success/20 px-3 py-0.5 text-2xs font-medium text-success">
                      Completed
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {paymentJob && canCollectPayment && (
        <TechPaymentModal
          job={paymentJob}
          offerFinishJob={false}
          lockMethod="cash"
          onClose={() => setPaymentJob(null)}
          onCompleted={() => {
            setPaymentJob(null)
            load()
          }}
        />
      )}
    </>
  )
}

function HopperPoolSection(props: {
  jobs: UnassignedPoolJob[]
  claimBusyId: string | null
  onClaim: (jobId: string) => void
}) {
  return (
    <section className="rounded-3xl border border-warning/30 bg-gradient-to-b from-warning/10 to-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-warning/20 text-warning">
          <Inbox className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-warning font-[family-name:var(--font-tech-heading)]">
            Unassigned pool
          </p>
          <p className="text-2xs text-muted-foreground">{props.jobs.length} job{props.jobs.length === 1 ? "" : "s"} available to claim</p>
        </div>
      </div>
      <ul className="space-y-2">
        {props.jobs.map((job) => {
          const vehicle = vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model)
          const busy = props.claimBusyId === job.id
          return (
            <li
              key={job.id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-border/80 bg-background/50 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white font-[family-name:var(--font-tech-heading)]">
                  {job.customer_name || job.customer_phone || "Customer"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{job.job_type || "Service call"}</p>
                {job.field_verification_required ? (
                  <p className="mt-1.5 flex items-center gap-1 text-2xs font-semibold text-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Verify key style on vehicle before cutting
                  </p>
                ) : null}
                {vehicle ? (
                  <p className="mt-1 flex items-center gap-1 text-2xs text-muted-foreground">
                    <Car className="h-3 w-3 shrink-0" aria-hidden />
                    {vehicle}
                  </p>
                ) : null}
                {job.neighborhood || job.location ? (
                  <p className="mt-1 flex items-start gap-1 text-2xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span className="line-clamp-2">{job.neighborhood || job.location}</span>
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy || Boolean(props.claimBusyId)}
                onClick={() => props.onClaim(job.id)}
                className="shrink-0 rounded-2xl bg-warning px-3 py-2 text-xs font-semibold text-warning-foreground transition active:scale-[0.98] disabled:opacity-50"
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

/**
 * Sized to roughly match a JobCard's real height so swapping this out for the
 * loaded list doesn't cause a big layout shift (was a centered py-24 spinner,
 * which is nowhere near as tall as the cards it gets replaced by).
 */
function JobListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-border bg-card p-4 shadow-raised"
        >
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
          <div className="mt-4 h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
          <div className="mt-4 h-10 w-full rounded-xl bg-muted" />
        </div>
      ))}
    </div>
  )
}

function JobCard(props: {
  job: DispatchJob
  busy: boolean
  onArrived: () => void
  onEnRoute: () => void
  onPausedWait: () => void
  onPausedParts: () => void
  onWorkComplete: () => void
  /** Acknowledgment only — never gates Start Route or anything else. */
  onAccept: () => void
  /** Cash in hand — opens the cash-only amount entry, job auto-completes on save. */
  onCollectedCash: () => void
  /** Card job: tech never runs the card — office collects remotely, tech just waits. */
  onOfficeWillCollect: () => void
  /** Owner grant — without it the customer's number is not shown to this tech. */
  canContactCustomer: boolean
  /** Owner grant — without it "Collected cash" is hidden; office always handles payment instead. */
  canCollectPayment: boolean
  /** Owner grant — without it the optional "Log key used" step is hidden. */
  canLogKeyUsage: boolean
}) {
  const { job } = props
  const [keyLogDismissed, setKeyLogDismissed] = useState(false)
  const status = job.job_status || "assigned"
  // Shared view-model — same facts the owner Active Job card shows.
  const summary = buildJobCardSummary(job)
  const phoneHref = props.canContactCustomer ? summary.phoneHref : null
  const mapsHref = job.location ? googleMapsSearchUrl(job.location) : null
  const workComplete = status === "work_complete"
  const canMarkWorkComplete =
    status === "arrived" ||
    status === "paused_wait" ||
    status === "paused_parts" ||
    status === "work_complete"
  const showPauseActions =
    status === "arrived" || status === "paused_wait" || status === "paused_parts"
  // work_complete is still "on site" for the shared operator phase badge.
  const statusOverride =
    status === "work_complete"
      ? {
          label: "Work complete",
          className: "border-operator/40 bg-operator/10 text-operator",
        }
      : status === "paused_wait"
        ? {
            label: "Paused — waiting",
            className: summary.statusBadgeClass,
          }
        : status === "paused_parts"
          ? {
              label: "Paused — parts",
              className: summary.statusBadgeClass,
            }
          : null

  return (
    <article className="rounded-3xl border border-border bg-card/70 p-4 shadow-resting">
      {/* Same glass facts as owner JobDetailOverview */}
      <JobCardSummary
        source={job}
        showHeader
        statusLabel={statusOverride?.label}
        statusBadgeClass={statusOverride?.className}
      />

      {/* Contact + navigate — field actions stay on the tech glass */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={phoneHref ?? undefined}
          className={cn(
            "flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-3 py-3 text-sm font-medium transition active:scale-[0.98]",
            phoneHref ? "text-white hover:bg-muted" : "pointer-events-none text-muted-foreground"
          )}
        >
          <Phone className="h-4 w-4" /> Call
        </a>
        <a
          href={mapsHref ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 px-3 py-3 text-sm font-medium transition active:scale-[0.98]",
            mapsHref ? "text-white hover:bg-muted" : "pointer-events-none text-muted-foreground"
          )}
        >
          <Navigation className="h-4 w-4" /> Navigate
        </a>
      </div>

      {/* Balance collect entry — tech payment path already exists; no full Money rail */}
      {summary.billingBalanceDollars > 0 ? (
        <p className="mt-2 flex items-center gap-2 text-2xs text-success/90">
          <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Booked balance {summary.billingLabel}
          {workComplete ? " — ready to collect" : ""}
        </p>
      ) : null}

      {/* New dispatch — acknowledgment only, never blocks Start Route below. */}
      {status === "assigned" && !job.accepted_at ? (
        <button
          type="button"
          onClick={props.onAccept}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-operator/40 bg-operator/10 px-3 py-2 text-xs font-semibold text-operator transition active:scale-[0.98]"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Accept job
        </button>
      ) : null}

      {/* Status: Start Route → Arrived → Work Complete */}
      {!workComplete ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <LeftStatusButton
            status={status}
            busy={props.busy}
            onArrived={props.onArrived}
            onEnRoute={props.onEnRoute}
            onWorkComplete={props.onWorkComplete}
          />
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-2xl bg-muted px-3 py-3 text-sm font-semibold text-muted-foreground shadow-none"
            title="Mark Work Complete first"
          >
            Collect payment
          </button>
        </div>
      ) : job.payment_pending_remote ? (
        <div className="mt-4 rounded-2xl border border-operator/30 bg-operator/10 px-4 py-3 text-center">
          <p className="text-sm font-semibold text-operator">Waiting for payment</p>
          <p className="mt-1 text-2xs text-muted-foreground">
            Office is contacting the customer. You&apos;ll be notified the moment it clears.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-2xl bg-operator/20 px-3 py-2 text-center text-xs font-semibold text-operator ring-1 ring-operator/40">
            Work Complete
          </div>

          {props.canLogKeyUsage && !keyLogDismissed ? (
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2">
              <span className="flex-1 text-2xs text-muted-foreground">
                Log the key you used? Updates inventory automatically.
              </span>
              <KeyInventoryScannerLaunchButton
                scope="tech"
                jobId={job.id}
                label="Log key"
                className="h-8 shrink-0 rounded-xl px-3 text-2xs"
              />
              <button
                type="button"
                onClick={() => setKeyLogDismissed(true)}
                className="shrink-0 text-2xs font-medium text-muted-foreground underline"
              >
                Skip
              </button>
            </div>
          ) : null}

          <div className={cn("mt-2 grid gap-2", props.canCollectPayment ? "grid-cols-2" : "grid-cols-1")}>
            {props.canCollectPayment ? (
              <button
                type="button"
                disabled={props.busy}
                onClick={props.onCollectedCash}
                className="rounded-2xl bg-success px-3 py-3 text-sm font-semibold text-success-foreground shadow-raised transition active:scale-[0.98]"
              >
                Collected cash
              </button>
            ) : null}
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onOfficeWillCollect}
              className="rounded-2xl border border-operator/40 bg-operator/10 px-3 py-3 text-sm font-semibold text-operator transition active:scale-[0.98]"
            >
              Office will collect
            </button>
          </div>
        </>
      )}
      {showPauseActions ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={props.busy || status === "paused_wait"}
            onClick={props.onPausedWait}
            className="rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning disabled:opacity-50"
          >
            Paused / wait
          </button>
          <button
            type="button"
            disabled={props.busy || status === "paused_parts"}
            onClick={props.onPausedParts}
            className="rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning disabled:opacity-50"
          >
            Leaving — back later
          </button>
        </div>
      ) : null}
      {canMarkWorkComplete && !workComplete ? (
        <p className="mt-2 text-center text-2xs text-muted-foreground">
          Mark work complete, then collect payment.
        </p>
      ) : null}
    </article>
  )
}

/** Left status control: assigned → en_route → arrived → work_complete. */
function LeftStatusButton(props: {
  status: string
  busy: boolean
  onArrived: () => void
  onEnRoute: () => void
  onWorkComplete: () => void
}) {
  if (props.busy) {
    return (
      <button disabled className="rounded-2xl bg-muted px-3 py-3 text-sm font-semibold text-white opacity-60">
        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
      </button>
    )
  }
  if (props.status === "assigned") {
    return (
      <button
        onClick={props.onEnRoute}
        className="flex items-center justify-center gap-2 rounded-2xl bg-info px-3 py-3 text-sm font-semibold text-info-foreground transition active:scale-[0.98] hover:bg-info"
      >
        <Route className="h-4 w-4" /> Start Route
      </button>
    )
  }
  if (props.status === "en_route") {
    return (
      <button
        onClick={props.onArrived}
        className="rounded-2xl bg-muted px-3 py-3 text-sm font-semibold text-white transition active:scale-[0.98] hover:bg-accent"
      >
        Arrived on Site
      </button>
    )
  }
  if (
    props.status === "arrived" ||
    props.status === "paused_wait" ||
    props.status === "paused_parts"
  ) {
    return (
      <button
        onClick={props.onWorkComplete}
        className="rounded-2xl bg-operator px-3 py-3 text-sm font-semibold text-operator-foreground transition active:scale-[0.98] hover:bg-operator"
      >
        Mark Work Complete
      </button>
    )
  }
  // work_complete (and any other post-site state before paid)
  return (
    <button
      disabled
      className="rounded-2xl bg-operator/20 px-3 py-3 text-sm font-semibold text-operator ring-1 ring-operator/40"
    >
      Work Complete
    </button>
  )
}
