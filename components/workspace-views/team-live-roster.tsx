"use client"

// Dense live technician availability roster for the Team tab.

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, UsersRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { DispatchJob, FieldTechnician } from "@/lib/types"

type RosterPresence = "on_job" | "standby" | "away"

type RosterRow = {
  id: string
  shortName: string
  presence: RosterPresence
  detail: string
}

/** "Alex Martinez" → "Alex M." */
function shortDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "Tech"
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]!.toUpperCase()}.`
}

function isActiveFieldJob(job: DispatchJob): boolean {
  const status = (job.job_status ?? "").trim().toLowerCase()
  if (!status) return Boolean(job.assigned_tech_id)
  return (
    status !== "completed" &&
    status !== "cancelled" &&
    status !== "canceled" &&
    status !== "unresolved" &&
    status !== "referred"
  )
}

function workloadDetail(job: DispatchJob & { job_type?: string | null }): string {
  const type = job.job_type?.trim() || job.summary?.trim() || "Job"
  const status = (job.job_status ?? "").trim().toLowerCase()
  if (status === "arrived") return `On-site (${type})`
  if (status === "en_route") return `En route · ${type}`
  if (status === "assigned") return `Assigned · ${type}`
  return `On job · ${type}`
}

function buildRosterRows(techs: FieldTechnician[], jobs: DispatchJob[]): RosterRow[] {
  const activeJobs = jobs.filter(isActiveFieldJob)
  return techs.map((tech) => {
    const shortName = shortDisplayName(tech.name)
    if (!tech.is_active) {
      return { id: tech.id, shortName, presence: "away", detail: "Inactive" }
    }
    if (tech.invite_pending) {
      return { id: tech.id, shortName, presence: "away", detail: "Invite pending" }
    }
    const portalId = tech.portal_user_id
    const job = portalId
      ? activeJobs.find((j) => j.assigned_tech_id === portalId)
      : undefined
    if (job) {
      return { id: tech.id, shortName, presence: "on_job", detail: workloadDetail(job) }
    }
    return { id: tech.id, shortName, presence: "standby", detail: "Available for 2h" }
  })
}

const PRESENCE_DOT: Record<RosterPresence, string> = {
  on_job: "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.7)]",
  standby: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]",
  away: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.65)]",
}

const PRESENCE_LABEL: Record<RosterPresence, string> = {
  on_job: "On job",
  standby: "Standby",
  away: "Away",
}

export const TeamLiveRoster = memo(function TeamLiveRoster({ className }: { className?: string }) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null

  const [techs, setTechs] = useState<FieldTechnician[]>([])
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const techQs = organizationQueryString(orgId)
    Promise.all([
      fetch(`/api/technicians${techQs}`, { credentials: "include", cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("techs"))
      ),
      fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("jobs"))
      ),
    ])
      .then(([techJson, jobsJson]: [{ data?: FieldTechnician[] }, { data?: { jobs?: DispatchJob[] } }]) => {
        setTechs(Array.isArray(techJson.data) ? techJson.data : [])
        setJobs(Array.isArray(jobsJson.data?.jobs) ? jobsJson.data!.jobs! : [])
        setError(null)
      })
      .catch(() => setError("Could not load live roster"))
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => {
    load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const rows = useMemo(() => buildRosterRows(techs, jobs), [techs, jobs])

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-slate-850/60 bg-slate-900/30",
        className
      )}
      aria-label="Live technician availability"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-900/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <UsersRound className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Live roster
          </h2>
        </div>
        <span className="text-[10px] font-medium tabular-nums text-slate-500">
          {loading ? "…" : `${rows.length} tech${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          Loading roster…
        </div>
      ) : error && rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-rose-400">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          No field techs yet — invite from the directory below.
        </p>
      ) : (
        <ul className="divide-y divide-slate-900/60">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", PRESENCE_DOT[row.presence])}
                  title={PRESENCE_LABEL[row.presence]}
                  aria-label={PRESENCE_LABEL[row.presence]}
                />
                <span className="truncate text-sm font-semibold text-slate-100">{row.shortName}</span>
              </div>
              <span className="shrink-0 text-right text-[11px] font-medium text-slate-400">
                {row.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
