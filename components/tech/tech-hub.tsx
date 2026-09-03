// Tech console home — "Field Notebook": a warm, card-based hero for the one job that needs you
// next, quick-access chips for Keys/Inventory/Wallet/Performance, and the rest of today's jobs
// as compact cards below. Replaces the earlier "vintage badge grid" concept.

"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  LogOut,
  RefreshCw,
  KeyRound,
  ScanBarcode,
  Wallet,
  Award,
  Phone,
  Navigation,
  Route,
  Check,
  CheckCircle2,
} from "lucide-react"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { googleMapsSearchUrl } from "@/lib/google-maps-search-url"
import type { DispatchJob, FieldTechnicianCapabilities } from "@/lib/types"
import type { TechBadge } from "@/lib/tech-badges"

function timeGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

function initialsFor(name: string | null, phone: string | null): string {
  const source = name?.trim() || phone?.trim() || ""
  return source ? source[0]!.toUpperCase() : "?"
}

/** Lower = more urgent. On-site now beats driving now beats finishing up beats not-yet-started —
 *  the API only orders jobs by when they were dispatched, which isn't the same as what needs
 *  the tech's attention right now. */
function jobUrgencyRank(job: DispatchJob): number {
  const status = job.job_status || "assigned"
  if (status === "arrived" || status === "paused_wait" || status === "paused_parts") return 0
  if (status === "en_route") return 1
  if (status === "work_complete") return 2
  return 3
}

function shortStatusLabel(job: DispatchJob): string {
  if (job.payment_pending_remote) return "waiting on payment"
  const status = job.job_status || "assigned"
  if (status === "assigned" && !job.accepted_at) return "new — needs accept"
  if (status === "assigned") return "assigned"
  if (status === "en_route") return "en route"
  if (status === "arrived") return "on site"
  if (status === "paused_wait") return "paused — waiting"
  if (status === "paused_parts") return "paused — parts"
  if (status === "work_complete") return "ready to collect"
  return status
}

type HeroStep = "accept" | "en_route" | "arrived" | "work_complete"

/** The single next actionable step, pre-payment. Payment/key-logging stay on the Jobs page. */
function heroNextStep(job: DispatchJob): { label: string; step: HeroStep; showIcon: boolean } | null {
  const status = job.job_status || "assigned"
  if (status === "assigned" && !job.accepted_at) return { label: "Accept job", step: "accept", showIcon: true }
  if (status === "assigned") return { label: "Start route", step: "en_route", showIcon: true }
  if (status === "en_route") return { label: "Arrived on site", step: "arrived", showIcon: false }
  if (status === "arrived" || status === "paused_wait" || status === "paused_parts") {
    return { label: "Mark work complete", step: "work_complete", showIcon: false }
  }
  return null
}

export function TechHub(props: {
  techUserId: string
  techName: string
  businessName: string
  capabilities: FieldTechnicianCapabilities
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [badges, setBadges] = useState<TechBadge[]>([])
  const [freeToLeaveToast, setFreeToLeaveToast] = useState<string | null>(null)
  const waitingJobIdsRef = useRef<Set<string>>(new Set())

  const canContactCustomer = props.capabilities.customer_contact === true

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const res = await fetch("/api/tech/jobs", { credentials: "include", cache: "no-store" })
      const json = await res.json()
      if (json?.data?.jobs) {
        const nextJobs = json.data.jobs as DispatchJob[]
        const justCleared = nextJobs.some(
          (j) => waitingJobIdsRef.current.has(j.id) && j.job_status === "completed"
        )
        waitingJobIdsRef.current = new Set(
          nextJobs.filter((j) => j.payment_pending_remote === true).map((j) => j.id)
        )
        setJobs(nextJobs)
        if (justCleared) setFreeToLeaveToast("Payment received — you're free to leave.")
      }
      if (json?.data?.badges) setBadges(json.data.badges as TechBadge[])
    } catch {
      /* keep last state on transient error */
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  useEffect(() => {
    if (!freeToLeaveToast) return
    const t = setTimeout(() => setFreeToLeaveToast(null), 6_000)
    return () => clearTimeout(t)
  }, [freeToLeaveToast])

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      /* ignore */
    }
    router.replace("/tech/login")
  }

  async function acceptJob(jobId: string) {
    setBusyId(jobId)
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, accepted_at: j.accepted_at ?? new Date().toISOString() } : j))
    )
    try {
      await fetch(`/api/tech/jobs/${jobId}/accept`, { method: "PATCH", credentials: "include" })
    } catch {
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function setJobStatus(jobId: string, status: string) {
    setBusyId(jobId)
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, job_status: status } : j)))
    try {
      await fetch(`/api/tech/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      })
    } catch {
      load()
    } finally {
      setBusyId(null)
    }
  }

  const active = [...jobs]
    .filter((j) => j.job_status !== "completed")
    .sort((a, b) => jobUrgencyRank(a) - jobUrgencyRank(b))
  const done = jobs.filter((j) => j.job_status === "completed")
  const heroJob = active[0] ?? null
  const laterJobs = active.slice(1)
  const earnedCount = badges.filter((b) => b.earned).length

  const quickAccess: { key: string; href: string; icon: ReactNode; label: string; stat: string }[] = [
    {
      key: "jobs",
      href: "/tech/dashboard/jobs",
      icon: <Route className="h-5 w-5" aria-hidden />,
      label: "Jobs",
      stat: loading ? "Your work queue" : `${active.length} active`,
    },
    ...(props.capabilities.key_lookup === true
      ? [
          {
            key: "keys",
            href: "/tech/dashboard/keys",
            icon: <KeyRound className="h-5 w-5" aria-hidden />,
            label: "Keys",
            stat: "Look up a code",
          },
        ]
      : []),
    ...(props.capabilities.inventory_control === true
      ? [
          {
            key: "inventory",
            href: "/tech/dashboard/inventory",
            icon: <ScanBarcode className="h-5 w-5" aria-hidden />,
            label: "Inventory",
            stat: "Scan & count stock",
          },
        ]
      : []),
    ...(props.capabilities.view_earnings === true
      ? [
          {
            key: "wallet",
            href: "/tech/dashboard/wallet",
            icon: <Wallet className="h-5 w-5" aria-hidden />,
            label: "Wallet",
            stat: "Earnings & payouts",
          },
        ]
      : []),
    {
      key: "performance",
      href: "/tech/dashboard/performance",
      icon: <Award className="h-5 w-5" aria-hidden />,
      label: "Performance",
      stat: loading || badges.length === 0 ? "Your badges" : `${earnedCount}/${badges.length} earned`,
    },
  ]

  const heroStep = heroJob ? heroNextStep(heroJob) : null
  function runHeroStep() {
    if (!heroJob || !heroStep) return
    if (heroStep.step === "accept") acceptJob(heroJob.id)
    else setJobStatus(heroJob.id, heroStep.step)
  }
  const heroPhoneHref = heroJob && canContactCustomer && heroJob.customer_phone ? `tel:${heroJob.customer_phone}` : null
  const heroMapsHref = heroJob?.location ? googleMapsSearchUrl(heroJob.location) : null
  const heroVehicle = heroJob
    ? [heroJob.vehicle_year, heroJob.vehicle_make, heroJob.vehicle_model].filter(Boolean).join(" ")
    : ""
  const heroBusy = heroJob ? busyId === heroJob.id : false

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      {freeToLeaveToast ? (
        <div className="fixed inset-x-4 top-4 z-50 rounded-2xl border border-success/40 bg-success/15 px-4 py-3 text-center text-sm font-semibold text-success shadow-raised backdrop-blur">
          {freeToLeaveToast}
        </div>
      ) : null}

      <header className="flex items-center justify-between px-4 pb-2 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-operator/18 text-lg font-bold text-operator font-[family-name:var(--font-tech-heading)]">
            {props.techName.split(" ")[0]?.[0]?.toUpperCase() ?? "?"}
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">
              {timeGreeting()}, {props.techName.split(" ")[0]}
            </p>
            <p className="text-2xs text-muted-foreground">{props.businessName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => load(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 hover:text-white"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={signOut}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-8">
        {loading ? (
          <div className="animate-pulse" aria-hidden="true">
            <div className="mt-2 h-48 rounded-3xl border border-border bg-card/60 p-4">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="mt-4 h-5 w-2/3 rounded bg-muted" />
              <div className="mt-3 h-3 w-1/2 rounded bg-muted" />
              <div className="mt-6 h-12 w-full rounded-2xl bg-muted" />
            </div>
            <div className="mb-3 mt-6 h-3 w-24 rounded bg-muted" />
            <div className="flex gap-3 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 w-24 shrink-0 rounded-2xl bg-muted" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {heroJob ? (
              <section className="mt-2 rounded-3xl border border-border bg-gradient-to-br from-operator/12 via-card to-card p-4">
                <p className="text-2xs font-bold uppercase tracking-wider text-operator">Next up</p>
                <h2 className="mt-2 text-xl font-bold leading-tight font-[family-name:var(--font-tech-heading)]">
                  {heroJob.customer_name || heroJob.customer_phone || "Customer"}
                </h2>
                {heroVehicle ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-foreground/80">
                    <ScanBarcode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    {heroVehicle}
                    {heroJob.job_type ? ` — ${heroJob.job_type}` : ""}
                  </p>
                ) : null}
                {heroJob.location ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-foreground/80">
                    <Navigation className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{heroJob.location}</span>
                  </p>
                ) : null}
                <p className="mt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {shortStatusLabel(heroJob)}
                </p>

                {heroStep ? (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      disabled={heroBusy}
                      onClick={runHeroStep}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-operator px-4 py-4 text-sm font-bold text-operator-foreground transition active:scale-[0.98] disabled:opacity-60"
                    >
                      {heroStep.showIcon ? (
                        heroStep.step === "accept" ? (
                          <Check className="h-4 w-4" aria-hidden />
                        ) : (
                          <Route className="h-4 w-4" aria-hidden />
                        )
                      ) : null}
                      {heroStep.label}
                    </button>
                    <a
                      href={heroPhoneHref ?? undefined}
                      className={`flex w-12 shrink-0 items-center justify-center rounded-2xl border transition active:scale-95 ${
                        heroPhoneHref
                          ? "border-border text-foreground hover:bg-muted"
                          : "pointer-events-none border-border/50 text-muted-foreground/50"
                      }`}
                      aria-label="Call customer"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/40 px-4 py-3">
                    <span className="text-2xs text-muted-foreground">
                      {heroJob.payment_pending_remote
                        ? "Office is contacting the customer."
                        : "Log a key and collect payment on the Jobs tab."}
                    </span>
                    <Link
                      href="/tech/dashboard/jobs"
                      className="shrink-0 text-2xs font-bold text-operator underline underline-offset-2"
                    >
                      Open
                    </Link>
                  </div>
                )}
              </section>
            ) : (
              <section className="mt-2 rounded-3xl border border-border bg-card/60 p-6 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
                <p className="mt-3 text-sm font-semibold">All caught up</p>
                <p className="mt-1 text-2xs text-muted-foreground">New dispatches appear here automatically.</p>
              </section>
            )}

            <p className="mb-3 mt-6 text-xs font-bold font-[family-name:var(--font-tech-heading)]">
              Quick access
            </p>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {quickAccess.map((tile) => (
                <Link
                  key={tile.key}
                  href={tile.href}
                  className="w-32 shrink-0 rounded-2xl border border-border bg-card/70 p-4 transition active:scale-[0.97]"
                >
                  <span className="text-operator">{tile.icon}</span>
                  <p className="mt-3 text-xs font-semibold">{tile.label}</p>
                  <p className="mt-0.5 truncate text-2xs text-muted-foreground">{tile.stat}</p>
                </Link>
              ))}
            </div>

            {laterJobs.length > 0 ? (
              <>
                <p className="mb-3 mt-6 text-xs font-bold font-[family-name:var(--font-tech-heading)]">
                  Later today
                </p>
                <div className="flex flex-col gap-3">
                  {laterJobs.map((job) => (
                    <Link
                      key={job.id}
                      href="/tech/dashboard/jobs"
                      className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition active:scale-[0.98]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground/80 font-[family-name:var(--font-tech-heading)]">
                        {initialsFor(job.customer_name, job.customer_phone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {job.customer_name || job.customer_phone || "Customer"}
                        </span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {shortStatusLabel(job)}
                        </span>
                      </span>
                      {job.job_status === "assigned" && !job.accepted_at ? (
                        <span className="shrink-0 rounded-full bg-warning/16 px-3 py-1 text-2xs font-bold text-warning">
                          New
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </>
            ) : null}

            {done.length > 0 ? (
              <div className="mt-6 flex items-center gap-2 rounded-2xl bg-success/8 px-4 py-3 text-2xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {done.length} job{done.length === 1 ? "" : "s"} completed today
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
