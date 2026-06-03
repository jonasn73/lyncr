// Owner Activity panel: booked jobs with an "Assign Tech" dropdown. Selecting a tech runs the
// parameterized assignment update and pushes the job to that tech's device in real time.

"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Truck, MapPin } from "lucide-react"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { DispatchJob, FieldTechnician } from "@/lib/types"

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  en_route: "En route",
  arrived: "On site",
  completed: "Completed",
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null
  const styles: Record<string, string> = {
    assigned: "bg-zinc-700/60 text-zinc-200",
    en_route: "bg-sky-500/20 text-sky-300",
    arrived: "bg-amber-500/20 text-amber-200",
    completed: "bg-emerald-500/20 text-emerald-300",
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status] || styles.assigned}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export function DispatchJobsPanel() {
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [techs, setTechs] = useState<FieldTechnician[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { jobs?: DispatchJob[]; technicians?: FieldTechnician[] } }) => {
        setJobs(Array.isArray(j.data?.jobs) ? j.data!.jobs! : [])
        setTechs(Array.isArray(j.data?.technicians) ? j.data!.technicians! : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  async function assign(job: DispatchJob, techUserId: string) {
    setSavingId(job.id)
    const next = techUserId || null
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? {
              ...j,
              assigned_tech_id: next,
              assigned_tech_name: techs.find((t) => t.portal_user_id === next)?.name ?? null,
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
        body: JSON.stringify({ leadId: job.id, techUserId: next }),
      })
    } catch {
      load()
    } finally {
      setSavingId(null)
    }
  }

  // Don't show an empty box when there are no booked jobs to dispatch.
  if (!loading && jobs.length === 0) return null

  return (
    <WorkspacePanel className="mb-4 p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
          <Truck className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Dispatch board</h2>
          <p className="text-xs text-zinc-500">Assign booked jobs to your field technicians.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {job.customer_name || job.customer_phone || "New customer"}
                  </p>
                  <StatusPill status={job.job_status} />
                </div>
                {job.location && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500">
                    <MapPin className="h-3 w-3 shrink-0" /> {job.location}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {savingId === job.id && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
                <select
                  value={job.assigned_tech_id || ""}
                  onChange={(e) => void assign(job, e.target.value)}
                  disabled={techs.length === 0}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value="">{techs.length === 0 ? "No techs yet" : "Unassigned"}</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.portal_user_id || ""}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </WorkspacePanel>
  )
}
