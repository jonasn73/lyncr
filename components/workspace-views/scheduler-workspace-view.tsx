"use client"

// Owner job scheduler — month calendar, tech swimlanes, manual-call dispatch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { mutate as globalMutate } from "swr"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { Calendar } from "@/components/ui/calendar"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { resolveWorkspaceIntakeProfile } from "@/lib/workspace-intake-profile"
import {
  SCHEDULER_GRID_END_HOUR,
  SCHEDULER_GRID_START_HOUR,
  dayKeyLocal,
  dateAtLocalHour,
} from "@/lib/scheduler-utils"
import { isActivePipelineFeedJob } from "@/lib/scheduler-job-status"
import { parseSchedulerFocusSearch } from "@/lib/scheduler-focus-url"
import {
  jobPoolActiveUrl,
  jobPoolHopperUrl,
  useActivePipelineQuery,
  useJobPoolQuery,
} from "@/lib/hooks/use-job-pool-query"
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { JobPoolPanel } from "@/components/scheduler/job-pool-panel"
import { SchedulerDispatchLiveStatus } from "@/components/scheduler/scheduler-dispatch-live-status"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import { SchedulerCalendarStatsSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import { PhoneLookupBar } from "@/components/scheduler/phone-lookup-bar"
import {
  TechnicianSwimlaneBoard,
  type MobileSchedulerAssignRequest,
} from "@/components/scheduler/technician-swimlane-board"
import { JobDetailDrawer } from "@/components/scheduler/job-detail-drawer"
import { IntakeScheduleDialog } from "@/components/scheduler/intake-schedule-dialog"
import { useMarkJobComplete } from "@/lib/hooks/use-mark-job-complete"
import type {
  ActivePipelineJob,
  FieldTechnician,
  SchedulerEvent,
  SchedulerPhoneLookupResult,
  UnassignedPoolJob,
} from "@/lib/types"

function sortEventsByTime(a: SchedulerEvent, b: SchedulerEvent): number {
  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
}

function shiftCalendarDay(day: Date, delta: number): Date {
  const next = new Date(day)
  next.setDate(next.getDate() + delta)
  return next
}

export function SchedulerWorkspaceView({ isActive = true }: { isActive?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inboundCallPanel = useInboundCallPanelOptional()
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date())
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [lineIndustryTags, setLineIndustryTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  /** Optimistic completion timestamps for the Done counter (job id → ISO time). */
  const [completedTodayLedger, setCompletedTodayLedger] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  )
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [drawerPoolJob, setDrawerPoolJob] = useState<UnassignedPoolJob | null>(null)
  const [drawerScheduledEvent, setDrawerScheduledEvent] = useState<SchedulerEvent | null>(null)
  const [gridScheduleError, setGridScheduleError] = useState<string | null>(null)
  const [gridScheduleSaving, setGridScheduleSaving] = useState(false)
  const [mobileAssignRequest, setMobileAssignRequest] = useState<MobileSchedulerAssignRequest | null>(null)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [scheduleIntentLeadId, setScheduleIntentLeadId] = useState<string | null>(null)
  const [intakeScheduleJob, setIntakeScheduleJob] = useState<UnassignedPoolJob | null>(null)
  /** Jobs removed this session — UI filters immediately even if SWR/stream cache is stale. */
  const [deletedJobIds, setDeletedJobIds] = useState<ReadonlySet<string>>(() => new Set())
  const initialBootstrapDoneRef = useRef(false)
  /** Ignores stale bootstrap responses that started before a newer load or delete. */
  const loadSeqRef = useRef(0)
  /** Job ids removed this session — filters racey bootstrap/SWR responses until revalidate. */
  const deletedJobIdsRef = useRef<Set<string>>(new Set())
  /** Prevents URL focus effects from closing a job the user opened manually via Edit. */
  const suppressUrlFocusRef = useRef(false)

  const { focusLeadId, scheduleFromIntake } = useMemo(
    () => parseSchedulerFocusSearch(searchParams.toString()),
    [searchParams]
  )

  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const orgQuery = orgId ? `&organization_id=${encodeURIComponent(orgId)}` : ""

  const {
    jobs: poolJobs,
    isLoading: poolLoading,
    mutate: mutatePool,
  } = useJobPoolQuery(activeOrganizationId)

  const pipelineDayKey = dayKeyLocal(selectedDay)
  const streamedPipelineDayKey = dayKeyLocal(new Date())
  const useStreamedPipeline = pipelineDayKey === streamedPipelineDayKey

  const {
    jobs: activePipelineJobs,
    mutate: mutateActivePipeline,
  } = useActivePipelineQuery(activeOrganizationId, pipelineDayKey, isActive)

  const activeOrgName = useMemo(
    () => organizations.find((o) => o.id === orgId)?.name ?? null,
    [organizations, orgId]
  )

  const intakeProfile = useMemo(
    () =>
      resolveWorkspaceIntakeProfile({
        organizationName: activeOrgName,
        industryTags: lineIndustryTags,
      }),
    [activeOrgName, lineIndustryTags]
  )

  const assignableTechs = useMemo(
    () => technicians.filter((t) => t.is_active && t.portal_user_id),
    [technicians]
  )

  const excludeDeletedJobs = useCallback(
    <T extends { id: string }>(rows: T[]) => {
      if (deletedJobIds.size === 0) return rows
      return rows.filter((row) => !deletedJobIds.has(row.id))
    },
    [deletedJobIds]
  )

  const displayPoolJobs = useMemo(
    () => excludeDeletedJobs(poolJobs),
    [poolJobs, excludeDeletedJobs]
  )

  const displayPipelineJobs = useMemo(
    () => excludeDeletedJobs(activePipelineJobs).filter(isActivePipelineFeedJob),
    [activePipelineJobs, excludeDeletedJobs]
  )

  const displayEvents = useMemo(() => excludeDeletedJobs(events), [events, excludeDeletedJobs])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, SchedulerEvent[]>()
    for (const ev of displayEvents) {
      const key = dayKeyLocal(new Date(ev.scheduled_at))
      const list = map.get(key) ?? []
      list.push(ev)
      map.set(key, list)
    }
    for (const [, list] of map) list.sort(sortEventsByTime)
    return map
  }, [displayEvents])

  const daysWithEvents = useMemo(() => {
    const set = new Set<Date>()
    for (const key of eventsByDay.keys()) {
      const [y, m, d] = key.split("-").map(Number)
      set.add(new Date(y, m - 1, d))
    }
    return set
  }, [eventsByDay])

  const selectedKey = dayKeyLocal(selectedDay)
  const todayKey = dayKeyLocal(new Date())
  const dayEvents = useMemo(() => eventsByDay.get(selectedKey) ?? [], [eventsByDay, selectedKey])

  /** Clear intake deep-link params so URL focus logic does not override manual job clicks. */
  const clearSchedulerFocusUrl = useCallback(() => {
    const hasFocus = searchParams.get("focus") || searchParams.get("schedule")
    if (!hasFocus) return
    setScheduleIntentLeadId(null)
    router.replace("/dashboard/scheduler", { scroll: false })
  }, [router, searchParams])

  /** Open the edit drawer for a pool job, scheduled event, or active pipeline row. */
  function openJobForEdit(
    job: ActivePipelineJob | SchedulerEvent | UnassignedPoolJob,
    opts?: { fromUrl?: boolean }
  ) {
    if (!opts?.fromUrl) suppressUrlFocusRef.current = true
    clearSchedulerFocusUrl()
    setHighlightId(job.id)
    const scheduled = dayEvents.find((ev) => ev.id === job.id)
    if (scheduled) {
      setDrawerScheduledEvent(scheduled)
      setDrawerPoolJob(null)
    } else {
      setDrawerPoolJob(job as UnassignedPoolJob)
      setDrawerScheduledEvent(null)
    }
  }

  function openPoolJobDrawer(job: UnassignedPoolJob) {
    openJobForEdit(job)
  }

  function queueMobilePoolAssign(job: UnassignedPoolJob) {
    setMobileAssignRequest({
      jobId: job.id,
      jobLabel: job.customer_name?.trim() || job.job_type || "Service call",
    })
  }

  function openScheduledJobDrawer(ev: SchedulerEvent) {
    openJobForEdit(ev)
  }

  /** List card tap — highlight only (does not open the editor). */
  function highlightPipelineJob(job: ActivePipelineJob) {
    setHighlightId(job.id)
  }

  /** Edit button / card — open the job editor on the next frame (avoids dialog dismissing the opening click). */
  function editPipelineJob(job: ActivePipelineJob | UnassignedPoolJob | SchedulerEvent) {
    suppressUrlFocusRef.current = true
    setHighlightId(job.id)

    window.setTimeout(() => {
      const scheduled = dayEvents.find((ev) => ev.id === job.id)
      if (scheduled) {
        setDrawerScheduledEvent(scheduled)
        setDrawerPoolJob(null)
      } else {
        setDrawerPoolJob(job as UnassignedPoolJob)
        setDrawerScheduledEvent(null)
      }
    }, 0)
  }

  function focusPipelineJob(job: ActivePipelineJob) {
    editPipelineJob(job)
  }

  function focusScheduledMapJob(ev: SchedulerEvent) {
    editPipelineJob(ev)
  }

  const focusJobById = useCallback(
    (jobId: string) => {
      const pipeline = displayPipelineJobs.find((j) => j.id === jobId)
      if (pipeline) {
        highlightPipelineJob(pipeline)
        return
      }
      const scheduled = dayEvents.find((ev) => ev.id === jobId)
      if (scheduled) {
        setHighlightId(jobId)
        return
      }
      const pool = displayPoolJobs.find((j) => j.id === jobId)
      if (pool) {
        setHighlightId(jobId)
      }
    },
    [displayPipelineJobs, dayEvents, displayPoolJobs]
  )

  const openNewIntake = useCallback(() => {
    inboundCallPanel?.openManualCallPanel()
  }, [inboundCallPanel])

  const registerJobCompletedToday = useCallback((jobId: string, completedAt?: string | null) => {
    const at = completedAt?.trim() || new Date().toISOString()
    if (dayKeyLocal(new Date(at)) !== todayKey) return
    setCompletedTodayLedger((prev) => {
      if (prev.get(jobId) === at) return prev
      const next = new Map(prev)
      next.set(jobId, at)
      return next
    })
  }, [todayKey])

  const openManualCallFromScheduler = useCallback(
    (_techUserId: string, _hour24: number) => {
      inboundCallPanel?.openManualCallPanel()
    },
    [inboundCallPanel]
  )

  const load = useCallback(() => {
    const seq = ++loadSeqRef.current
    if (!initialBootstrapDoneRef.current) setLoading(true)
    const bootstrapUrl = `/api/owner/scheduler/bootstrap?month=${encodeURIComponent(monthKey)}${orgQuery}`

    const bootstrapFetch = fetch(bootstrapUrl, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then(
        (j: {
          data?: {
            events?: SchedulerEvent[]
            technicians?: FieldTechnician[]
            lineIndustryTags?: string[]
            ownerUserId?: string
          }
        }) => {
          if (seq !== loadSeqRef.current) return
          const deleted = deletedJobIdsRef.current
          const rawEvents = Array.isArray(j.data?.events) ? j.data!.events! : []
          setEvents(
            deleted.size > 0 ? rawEvents.filter((ev) => !deleted.has(ev.id)) : rawEvents
          )
          setTechnicians(Array.isArray(j.data?.technicians) ? j.data!.technicians! : [])
          setLineIndustryTags(Array.isArray(j.data?.lineIndustryTags) ? j.data!.lineIndustryTags! : [])
          if (j.data?.ownerUserId) setOwnerUserId(j.data.ownerUserId)
        }
      )
      .catch(() => {
        setEvents([])
        setTechnicians([])
        setLineIndustryTags([])
      })

    return bootstrapFetch.finally(() => {
      initialBootstrapDoneRef.current = true
      setLoading(false)
    })
  }, [monthKey, orgQuery])

  useEffect(() => {
    void load()
  }, [load])

  const refreshSchedulerData = useCallback(() => {
    load()
    void mutatePool(undefined, { revalidate: true })
    void mutateActivePipeline(undefined, { revalidate: true })
  }, [load, mutatePool, mutateActivePipeline])

  useEffect(() => {
    const onWorkspaceChanged = () => refreshSchedulerData()
    window.addEventListener("lyncr-workspace-data-changed", onWorkspaceChanged)
    return () => window.removeEventListener("lyncr-workspace-data-changed", onWorkspaceChanged)
  }, [refreshSchedulerData])

  useEffect(() => {
    if (!isActive) return
    void mutatePool(undefined, { revalidate: true })
    void mutateActivePipeline(undefined, { revalidate: true })
  }, [isActive, mutatePool, mutateActivePipeline])

  useEffect(() => {
    if (!ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`owner-${ownerUserId}`)

    const onJobStatus = (payload: { leadId?: string; status?: string }) => {
      if (!payload?.leadId || !payload?.status) return
      if (payload.status === "completed") {
        registerJobCompletedToday(payload.leadId)
      }
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === payload.leadId
            ? {
                ...ev,
                job_status: payload.status ?? ev.job_status,
                completed_at:
                  payload.status === "completed"
                    ? ev.completed_at ?? new Date().toISOString()
                    : ev.completed_at,
                dispatch_status:
                  payload.status === "assigned" || payload.status === "en_route"
                    ? "DISPATCHED"
                    : ev.dispatch_status,
              }
            : ev
        )
      )
      void mutateActivePipeline()
    }

    const onJobAssigned = (payload: { leadId?: string; techUserId?: string }) => {
      if (payload?.leadId) {
        void mutatePool(
          (current) => (current ?? []).filter((j) => j.id !== payload.leadId),
          { revalidate: false }
        )
      }
      void load()
    }

    channel.bind("job-status-updated", onJobStatus)
    channel.bind("job-booked", refreshSchedulerData)
    channel.bind("job-assigned", onJobAssigned)
    channel.bind("disposition-updated", refreshSchedulerData)
    return () => {
      channel.unbind("job-status-updated", onJobStatus)
      channel.unbind("job-booked", refreshSchedulerData)
      channel.unbind("job-assigned", onJobAssigned)
      channel.unbind("disposition-updated", refreshSchedulerData)
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, refreshSchedulerData, load, mutatePool, mutateActivePipeline, registerJobCompletedToday])

  const drawerOpen = Boolean(drawerPoolJob || drawerScheduledEvent)

  function applyJobEventUpdate(event: SchedulerEvent) {
    setDrawerScheduledEvent(event)
    setDrawerPoolJob(null)
    setHighlightId(event.id)
    setEvents((prev) => {
      const idx = prev.findIndex((ev) => ev.id === event.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = event
      return next
    })
    void mutateActivePipeline()
    refreshSchedulerData()
  }

  const handleJobCompletedFromQuickAction = useCallback(
    (event: SchedulerEvent) => {
      const completedAt = event.completed_at ?? new Date().toISOString()
      const completedEvent: SchedulerEvent = {
        ...event,
        job_status: "completed",
        completed_at: completedAt,
      }
      registerJobCompletedToday(event.id, completedAt)
      setEvents((prev) => {
        const idx = prev.findIndex((ev) => ev.id === event.id)
        if (idx === -1) return [...prev, completedEvent]
        const next = [...prev]
        next[idx] = completedEvent
        return next
      })
      setDrawerPoolJob((prev) => (prev?.id === event.id ? null : prev))
      setDrawerScheduledEvent((prev) => (prev?.id === event.id ? null : prev))
      setHighlightId(null)
      void mutateActivePipeline()
      void mutatePool()
      refreshSchedulerData()
    },
    [mutateActivePipeline, mutatePool, refreshSchedulerData, registerJobCompletedToday]
  )

  const { markComplete, completingId, error: markCompleteError } = useMarkJobComplete(
    handleJobCompletedFromQuickAction
  )

  const handleMarkJobComplete = useCallback(
    (jobId: string) => {
      void markComplete(jobId)
    },
    [markComplete]
  )

  function closeJobDrawer() {
    document.body.style.overflow = ""
    suppressUrlFocusRef.current = false
    setDrawerPoolJob(null)
    setDrawerScheduledEvent(null)
  }

  const completeScheduleIntent = useCallback(
    (event?: SchedulerEvent) => {
      setScheduleIntentLeadId(null)
      setIntakeScheduleJob(null)
      router.replace("/dashboard/scheduler", { scroll: false })
      if (!suppressUrlFocusRef.current) {
        setDrawerPoolJob(null)
        setDrawerScheduledEvent(null)
      }
      void mutatePool()
      void mutateActivePipeline()
      if (event) {
        setHighlightId(event.id)
      }
    },
    [router, mutatePool, mutateActivePipeline]
  )

  function handleJobDeleted(jobId: string) {
    deletedJobIdsRef.current.add(jobId)
    setDeletedJobIds((prev) => {
      const next = new Set(prev)
      next.add(jobId)
      return next
    })
    loadSeqRef.current += 1
    closeJobDrawer()
    setHighlightId(null)
    setEvents((prev) => prev.filter((ev) => ev.id !== jobId))

    const orgCacheKey = orgId ?? "default"
    const nextPool = poolJobs.filter((j) => j.id !== jobId)
    const nextPipeline = activePipelineJobs.filter((j) => j.id !== jobId)
    const hopperUrl = jobPoolHopperUrl(activeOrganizationId)
    const pipelineUrl = jobPoolActiveUrl(activeOrganizationId, pipelineDayKey)

    writePersistedCache(persistedCacheKey("job-pool-hopper", orgCacheKey), nextPool)
    writePersistedCache(
      persistedCacheKey("job-pool-active", `${orgCacheKey}:${pipelineDayKey}`),
      nextPipeline
    )

    void mutatePool(nextPool, { revalidate: false })
    void mutateActivePipeline(nextPipeline, { revalidate: false })
    void globalMutate(hopperUrl, nextPool, { revalidate: false })
    void globalMutate(pipelineUrl, nextPipeline, { revalidate: false })
  }

  const handlePhoneLookupResults = useCallback(
    (result: SchedulerPhoneLookupResult | null) => {
      if (!result || (result.pool.length === 0 && result.scheduled.length === 0)) {
        // Empty lookup — do not close an editor the user opened from the job list.
        return
      }
      const poolMatch = result.pool[0]
      if (poolMatch) {
        focusPipelineJob(poolMatch)
        return
      }
      const scheduledMatch = result.scheduled[0]
      if (scheduledMatch) {
        focusScheduledMapJob(scheduledMatch)
        const eventDay = dayKeyLocal(new Date(scheduledMatch.scheduled_at))
        const currentKey = dayKeyLocal(selectedDay)
        if (eventDay !== currentKey) {
          const d = new Date(scheduledMatch.scheduled_at)
          setSelectedDay(d)
          setVisibleMonth(d)
        }
      }
    },
    [selectedDay]
  )

  function resolveDropHour(techUserId: string, preferredHour: number, durationMinutes: number): number {
    const duration = durationMinutes || 60
    const preferredStart = dateAtLocalHour(selectedDay, preferredHour)
    const preferredEnd = preferredStart.getTime() + duration * 60000
    const techEvents = dayEvents.filter((ev) => ev.assigned_tech_id === techUserId)

    const conflict = techEvents.some((ev) => {
      const start = new Date(ev.scheduled_at).getTime()
      const end = start + (ev.duration_minutes || 60) * 60000
      return start < preferredEnd && end > preferredStart.getTime()
    })
    if (!conflict) return preferredHour

    let latestEnd = preferredStart.getTime()
    for (const ev of techEvents) {
      const start = new Date(ev.scheduled_at).getTime()
      const end = start + (ev.duration_minutes || 60) * 60000
      if (end > latestEnd) latestEnd = end
    }
    const bumped = new Date(latestEnd)
    let hour = bumped.getHours()
    if (bumped.getMinutes() > 0 || bumped.getSeconds() > 0) hour += 1
    return Math.max(SCHEDULER_GRID_START_HOUR, Math.min(hour, SCHEDULER_GRID_END_HOUR - 1))
  }

  async function schedulePoolOnTechLane(jobId: string, techUserId: string, hour24: number) {
    const job = poolJobs.find((j) => j.id === jobId)
    if (!job || gridScheduleSaving) return
    setGridScheduleError(null)
    setGridScheduleSaving(true)
    const hour = resolveDropHour(techUserId, hour24, job.duration_minutes)
    const scheduledIso = dateAtLocalHour(selectedDay, hour).toISOString()
    try {
      const res = await fetch(`/api/owner/jobs/pool/${jobId}/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: scheduledIso, assigned_tech_id: techUserId }),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not schedule job")
      const event = json.data?.event
      if (!event) throw new Error("No event returned")
      const techName =
        assignableTechs.find((t) => t.portal_user_id === techUserId)?.name ?? event.assigned_tech_name
      void mutatePool(
        (current) => (current ?? []).filter((j) => j.id !== jobId),
        { revalidate: false }
      )
      handleAppointmentCreated({
        ...event,
        dispatch_status: "DISPATCHED",
        job_status: "assigned",
        assigned_tech_id: techUserId,
        assigned_tech_name: techName ?? null,
      })
      void mutatePool()
      if (scheduleIntentLeadId === jobId) {
        completeScheduleIntent({
          ...event,
          dispatch_status: "DISPATCHED",
          job_status: "assigned",
          assigned_tech_id: techUserId,
          assigned_tech_name: techName ?? null,
        })
      } else {
        void mutateActivePipeline()
      }
    } catch (e) {
      setGridScheduleError(e instanceof Error ? e.message : "Could not schedule job")
    } finally {
      setGridScheduleSaving(false)
    }
  }

  function handleAppointmentCreated(event: SchedulerEvent) {
    setEvents((prev) => {
      const next = [...prev.filter((e) => e.id !== event.id), event]
      next.sort(sortEventsByTime)
      return next
    })
    const eventDay = dayKeyLocal(new Date(event.scheduled_at))
    if (eventDay !== selectedKey) {
      const d = new Date(event.scheduled_at)
      setSelectedDay(d)
      setVisibleMonth(d)
    }
  }

  const handleScheduleCommitted = useCallback(
    (event: SchedulerEvent) => {
      handleAppointmentCreated(event)
      completeScheduleIntent(event)
    },
    [completeScheduleIntent, selectedKey]
  )

  const handleIntakeScheduleSkip = useCallback(() => {
    const job = intakeScheduleJob
    completeScheduleIntent()
    if (job) {
      setHighlightId(job.id)
    }
  }, [intakeScheduleJob, completeScheduleIntent])

  const intakeScheduleDialogOpen = Boolean(
    scheduleFromIntake && focusLeadId && scheduleIntentLeadId === focusLeadId
  )

  const intakeScheduleNotFound = Boolean(
    intakeScheduleDialogOpen &&
      !poolLoading &&
      !intakeScheduleJob &&
      !events.some((e) => e.id === focusLeadId)
  )

  useEffect(() => {
    if (!isActive || !focusLeadId) return
    if (scheduleFromIntake) {
      setScheduleIntentLeadId(focusLeadId)
      void mutatePool()
    }
  }, [isActive, focusLeadId, scheduleFromIntake, mutatePool])

  useEffect(() => {
    if (!isActive || !focusLeadId || suppressUrlFocusRef.current) return

    const poolJob = poolJobs.find((j) => j.id === focusLeadId)
    const scheduled = events.find((e) => e.id === focusLeadId)
    const pipelineJob = activePipelineJobs.find((j) => j.id === focusLeadId)

    if (scheduleFromIntake && scheduleIntentLeadId === focusLeadId) {
      if (poolJob) {
        setIntakeScheduleJob(poolJob)
        setHighlightId(focusLeadId)
        return
      }
      if (scheduled) {
        completeScheduleIntent(scheduled)
        return
      }
      if (pipelineJob && !poolJob && !poolLoading) {
        completeScheduleIntent()
        openJobForEdit(pipelineJob, { fromUrl: true })
      }
      return
    }

    if (!scheduleFromIntake) {
      if (scheduled) {
        const eventDay = dayKeyLocal(new Date(scheduled.scheduled_at))
        if (eventDay !== dayKeyLocal(selectedDay)) {
          const d = new Date(scheduled.scheduled_at)
          setSelectedDay(d)
          setVisibleMonth(d)
        }
        openJobForEdit(scheduled, { fromUrl: true })
      } else if (poolJob) {
        openJobForEdit(poolJob, { fromUrl: true })
      } else if (pipelineJob) {
        focusPipelineJob(pipelineJob)
      }
    }
  }, [
    isActive,
    focusLeadId,
    scheduleFromIntake,
    scheduleIntentLeadId,
    poolJobs,
    events,
    activePipelineJobs,
    selectedDay,
    completeScheduleIntent,
    poolLoading,
  ])

  const headerAction = (
    <PhoneLookupBar
      organizationId={orgId}
      onResults={handlePhoneLookupResults}
      className="w-full sm:w-auto"
    />
  )

  return (
    <>
      <WorkspacePage>
        <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" action={headerAction} />

        <p className="text-sm text-zinc-500 lg:text-xs">
          {intakeProfile === "locksmith"
            ? "Locksmith workspace — vehicle cascade, VIN lookup, AKL / key-type flags, and validated job addresses."
            : intakeProfile === "detailing"
              ? "Detailing workspace — vehicle size, pet hair, on-site utilities, and validated job addresses."
              : "Automotive field jobs with industry-specific intake fields and validated addresses."}
        </p>

        <div className="grid w-full grid-cols-1 items-start gap-4 pb-28 lg:grid-cols-4 lg:gap-6 lg:pb-0">
          {/* Left control column — new intake, hopper, live metrics */}
          <div className="flex w-full min-w-0 flex-col gap-4 lg:col-span-1 lg:sticky lg:top-[calc(var(--shell-header-h)+0.75rem)]">
            {inboundCallPanel ? (
              <button
                type="button"
                onClick={openNewIntake}
                className="inline-flex w-full items-center justify-center rounded-lg bg-cyan-500 py-2.5 text-sm font-medium text-black transition-colors hover:bg-cyan-400"
              >
                + New Intake
              </button>
            ) : null}

            <div className="lg:hidden">
              <JobPoolPanel
                jobs={displayPoolJobs}
                highlightId={highlightId}
                onSelectJob={openPoolJobDrawer}
                onMobileAssignJob={queueMobilePoolAssign}
              />
            </div>
            <div className="hidden w-full lg:block">
              <JobPoolPanel
                jobs={displayPoolJobs}
                highlightId={highlightId}
                onSelectJob={openPoolJobDrawer}
                onMobileAssignJob={queueMobilePoolAssign}
                variant="sidebar"
              />
            </div>

            <div className="lg:hidden">
              <SchedulerDispatchLiveStatus
                hidePrimaryAction
                selectedDay={selectedDay}
                poolJobs={displayPoolJobs}
                activePipelineJobs={displayPipelineJobs}
                dayEvents={dayEvents}
                rawCalendarJobs={displayEvents}
                todayKey={todayKey}
                completedTodayLedger={completedTodayLedger}
                onSelectJob={focusJobById}
                onMarkComplete={handleMarkJobComplete}
                completingJobId={completingId}
              />
            </div>
            <div className="hidden lg:block">
              <SchedulerDispatchLiveStatus
                sidebar
                hidePrimaryAction
                selectedDay={selectedDay}
                poolJobs={displayPoolJobs}
                activePipelineJobs={displayPipelineJobs}
                dayEvents={dayEvents}
                rawCalendarJobs={displayEvents}
                todayKey={todayKey}
                completedTodayLedger={completedTodayLedger}
                onSelectJob={focusJobById}
                onMarkComplete={handleMarkJobComplete}
                completingJobId={completingId}
              />
            </div>
          </div>

          {/* Main workspace — pipeline + swimlanes */}
          <div className="flex w-full min-w-0 flex-col gap-4 lg:col-span-3 lg:gap-6">
            {markCompleteError ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {markCompleteError}
              </p>
            ) : null}

            <WorkspacePanel className="flex w-full flex-col overflow-hidden">
              <div className="border-b border-border/60 px-3 py-1.5 lg:px-4 lg:py-2">
                <h2 className="text-sm font-semibold text-foreground">Active pipeline</h2>
                <p className="text-xs text-zinc-500">
                  {displayPipelineJobs.length} active job{displayPipelineJobs.length === 1 ? "" : "s"} today
                </p>
              </div>
              <div className="max-h-[min(420px,50vh)] overflow-y-auto bg-card/40 lg:max-h-[min(160px,22vh)]">
                <ActivePipelinePanelStream
                  jobs={displayPipelineJobs}
                  dayKey={pipelineDayKey}
                  useStreamedInitialDay={useStreamedPipeline}
                  highlightId={highlightId}
                  onFocusJob={highlightPipelineJob}
                  onEditJob={editPipelineJob}
                  onMarkComplete={handleMarkJobComplete}
                  completingJobId={completingId}
                />
              </div>
            </WorkspacePanel>

            <WorkspacePanel className="flex w-full min-w-0 flex-col overflow-hidden">
              <details className="group border-b border-border/60 lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  <span>
                    {selectedDay.toLocaleDateString([], {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="px-2 pb-2">
                  <Calendar
                    mode="single"
                    selected={selectedDay}
                    onSelect={(d) => d && setSelectedDay(d)}
                    month={visibleMonth}
                    onMonthChange={setVisibleMonth}
                    modifiers={{ hasJob: [...daysWithEvents] }}
                    modifiersClassNames={{
                      hasJob:
                        "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                    }}
                    className="mx-auto"
                  />
                  {loading ? (
                    <SchedulerCalendarStatsSkeleton />
                  ) : (
                    <p className="mt-1 text-center text-xs text-zinc-500">
                      {displayEvents.length} scheduled this month
                      {displayPoolJobs.length > 0 ? ` · ${displayPoolJobs.length} in hopper` : ""}
                    </p>
                  )}
                </div>
              </details>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 lg:px-4 lg:py-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Tech swimlanes · {assignableTechs.length} technician
                    {assignableTechs.length === 1 ? "" : "s"} · {dayEvents.length} job
                    {dayEvents.length === 1 ? "" : "s"} scheduled
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
                  <button
                    type="button"
                    onClick={() => setSelectedDay((day) => shiftCalendarDay(day, -1))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-zinc-400 hover:bg-muted/50 hover:text-foreground"
                    aria-label="Previous day"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDay(() => new Date())}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 hover:bg-muted/50 hover:text-foreground"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDay((day) => shiftCalendarDay(day, 1))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-zinc-400 hover:bg-muted/50 hover:text-foreground"
                    aria-label="Next day"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              {gridScheduleError ? (
                <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive lg:px-4">
                  {gridScheduleError}
                </div>
              ) : null}
              <TechnicianSwimlaneBoard
                technicians={technicians}
                dayEvents={dayEvents}
                loading={loading || gridScheduleSaving}
                highlightId={highlightId}
                onSelectEvent={openScheduledJobDrawer}
                onDropPoolJob={schedulePoolOnTechLane}
                onBookEmptySlot={openManualCallFromScheduler}
                mobileAssignRequest={mobileAssignRequest}
                onMobileAssignRequestClear={() => setMobileAssignRequest(null)}
              />
            </WorkspacePanel>
          </div>
        </div>
      </WorkspacePage>

      <JobDetailDrawer
        open={drawerOpen}
        poolJob={drawerPoolJob}
        scheduledEvent={drawerScheduledEvent}
        technicians={technicians}
        onClose={closeJobDrawer}
        onSaved={applyJobEventUpdate}
        onStatusChanged={applyJobEventUpdate}
        onDeleted={handleJobDeleted}
        scheduleIntent={Boolean(scheduleIntentLeadId && drawerPoolJob?.id === scheduleIntentLeadId)}
        onScheduleCommitted={handleScheduleCommitted}
      />

      <IntakeScheduleDialog
        open={intakeScheduleDialogOpen}
        loading={poolLoading && !intakeScheduleJob}
        notFound={intakeScheduleNotFound}
        job={intakeScheduleJob}
        technicians={technicians}
        scheduledEvents={events}
        organizationQuery={orgQuery}
        onSchedule={handleScheduleCommitted}
        onSkip={handleIntakeScheduleSkip}
      />
    </>
  )
}
