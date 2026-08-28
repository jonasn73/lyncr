"use client"

// Receptionist "Dispatch" tab — a job board that opens the same JobDetailDrawer (and the
// same TechAssignmentSelect inside it) the owner uses from Scheduler/CRM/Map. Only reachable
// when the owner has turned the dispatching capability on for this receptionist; the API
// routes it calls (/api/owner/jobs, /api/owner/jobs/pool, /api/owner/scheduler/[id],
// /api/owner/jobs/[id]/status) enforce the same check server-side via resolveCapabilityActor.
//
// Deliberately no live map here — DispatchLiveMap/MapTab depend on the owner dashboard's
// workspace context and SSR bootstrap caches, which don't exist in the receptionist portal.
// This board covers the actual dispatching action (assign/reassign a tech); the map is a
// possible follow-up once this is proven out.

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Truck } from "lucide-react"
import { JobDetailDrawer } from "@/components/scheduler/job-detail-drawer"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { dayKeyLocal } from "@/lib/scheduler-utils"
import { cn } from "@/lib/utils"
import type { ActivePipelineJob, FieldTechnician, UnassignedPoolJob } from "@/lib/types"

type PoolJobRow = UnassignedPoolJob | ActivePipelineJob

function JobCard({ job, onOpen }: { job: PoolJobRow; onOpen: () => void }) {
  const assignedName = "assigned_tech_name" in job ? job.assigned_tech_name : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-border/80 bg-card/40 px-3 py-3 text-left hover:border-border"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold text-foreground">
          {job.customer_name?.trim() || formatPhoneDisplay(job.customer_phone)}
        </p>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-2xs font-medium",
            assignedName ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
          )}
        >
          {assignedName || "Needs a tech"}
        </span>
      </div>
      {job.summary ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{job.summary}</p>
      ) : null}
      {job.location ? (
        <p className="mt-0.5 truncate text-2xs text-muted-foreground">{job.location}</p>
      ) : null}
    </button>
  )
}

export function ReceptionistDispatchView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [unassigned, setUnassigned] = useState<PoolJobRow[]>([])
  const [assignedToday, setAssignedToday] = useState<PoolJobRow[]>([])
  const [drawerJob, setDrawerJob] = useState<PoolJobRow | null>(null)

  const load = useCallback(() => {
    setError(null)
    const today = dayKeyLocal(new Date())
    Promise.all([
      fetch("/api/owner/jobs", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/owner/jobs/pool", { credentials: "include" }).then((r) => r.json()),
      fetch(`/api/owner/jobs/pool?scope=active&day=${today}`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    ])
      .then(([jobsJson, hopperJson, activeJson]) => {
        setTechnicians((jobsJson?.data?.technicians as FieldTechnician[]) ?? [])
        setUnassigned((hopperJson?.data?.jobs as PoolJobRow[]) ?? [])
        setAssignedToday((activeJson?.data?.jobs as PoolJobRow[]) ?? [])
      })
      .catch(() => setError("Could not load the job board"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" aria-hidden />
          <h1 className="text-sm font-semibold text-foreground">Dispatch</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            load()
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-2xs font-medium text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          <section className="space-y-2">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Needs a tech ({unassigned.length})
            </p>
            {unassigned.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing waiting on dispatch.</p>
            ) : (
              <div className="space-y-2">
                {unassigned.map((job) => (
                  <JobCard key={job.id} job={job} onOpen={() => setDrawerJob(job)} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned today ({assignedToday.length})
            </p>
            {assignedToday.length === 0 ? (
              <p className="text-xs text-muted-foreground">No jobs on today&apos;s board yet.</p>
            ) : (
              <div className="space-y-2">
                {assignedToday.map((job) => (
                  <JobCard key={job.id} job={job} onOpen={() => setDrawerJob(job)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <JobDetailDrawer
        open={Boolean(drawerJob)}
        poolJob={drawerJob}
        scheduledEvent={null}
        technicians={technicians}
        activePipelineJobs={assignedToday.filter((j): j is ActivePipelineJob => "assigned_tech_id" in j)}
        onClose={() => setDrawerJob(null)}
        onSaved={() => load()}
        onStatusChanged={() => load()}
        onDeleted={() => {
          setDrawerJob(null)
          load()
        }}
      />
    </div>
  )
}
