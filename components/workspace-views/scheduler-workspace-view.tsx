"use client"

// Owner job scheduler — month calendar, tech swimlanes, manual booking.

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { mutate as globalMutate } from "swr"
import { ChevronDown, Loader2, Plus } from "lucide-react"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  intakeFieldsFromWorkspaceContext,
  intakeTitleFromWorkspaceContext,
  intakeValuesComplete,
  serializeIntakeValues,
  type IntakeFormValues,
} from "@/lib/intake-form-helpers"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { resolveWorkspaceIntakeProfile } from "@/lib/workspace-intake-profile"
import {
  SCHEDULER_DURATION_OPTIONS,
  SCHEDULER_GRID_END_HOUR,
  SCHEDULER_GRID_START_HOUR,
  dayKeyLocal,
  dateAtLocalHour,
  toDatetimeLocalValue,
} from "@/lib/scheduler-utils"
import { parseSchedulerFocusSearch } from "@/lib/scheduler-focus-url"
import {
  jobPoolActiveUrl,
  jobPoolHopperUrl,
  useActivePipelineQuery,
  useJobPoolQuery,
} from "@/lib/hooks/use-job-pool-query"
import { persistedCacheKey, writePersistedCache } from "@/lib/swr/persisted-cache"
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

const IndustryIntakeFormFields = dynamic(
  () =>
    import("@/components/industry-intake-form-fields").then((m) => ({
      default: m.IndustryIntakeFormFields,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" aria-hidden />
      </div>
    ),
  }
)

const bookingInputClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

function formatPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

function sortEventsByTime(a: SchedulerEvent, b: SchedulerEvent): number {
  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
}

export function SchedulerWorkspaceView({ isActive = true }: { isActive?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date())
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [lineIndustryTags, setLineIndustryTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingStart, setBookingStart] = useState(() => toDatetimeLocalValue(new Date()))
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [intakeValues, setIntakeValues] = useState<IntakeFormValues>({})
  const [bookingDurationMinutes, setBookingDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [bookingSaving, setBookingSaving] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
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

  const intakeFields = useMemo(
    () =>
      intakeFieldsFromWorkspaceContext({
        intakeProfile,
        organizationName: activeOrgName,
        industryTags: lineIndustryTags,
      }),
    [intakeProfile, activeOrgName, lineIndustryTags]
  )

  const intakeModalTitle = useMemo(
    () =>
      intakeTitleFromWorkspaceContext({
        intakeProfile,
        organizationName: activeOrgName,
        industryTags: lineIndustryTags,
      }),
    [intakeProfile, activeOrgName, lineIndustryTags]
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
    () => excludeDeletedJobs(activePipelineJobs),
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

  const canSaveBooking =
    customerName.trim() &&
    customerPhone.trim() &&
    intakeValuesComplete(intakeFields, intakeValues)

  useEffect(() => {
    if (bookingOpen) {
      setBookingError(null)
    } else {
      setCustomerName("")
      setCustomerPhone("")
      setIntakeValues({})
      setAssignedTechId("")
    }
  }, [bookingOpen])

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
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === payload.leadId
            ? {
                ...ev,
                job_status: payload.status ?? ev.job_status,
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
  }, [ownerUserId, refreshSchedulerData, load, mutatePool, mutateActivePipeline])

  const drawerOpen = Boolean(drawerPoolJob || drawerScheduledEvent)

  function openBookingAtHour(hour24: number) {
    setBookingStart(toDatetimeLocalValue(dateAtLocalHour(selectedDay, hour24)))
    setBookingOpen(true)
  }

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
      setEvents((prev) => {
        const idx = prev.findIndex((ev) => ev.id === event.id)
        if (idx === -1) return prev
        const next = [...prev]
        next[idx] = event
        return next
      })
      setDrawerPoolJob((prev) => (prev?.id === event.id ? null : prev))
      setDrawerScheduledEvent((prev) => (prev?.id === event.id ? null : prev))
      setHighlightId(null)
      void mutateActivePipeline()
      void mutatePool()
      refreshSchedulerData()
    },
    [mutateActivePipeline, mutatePool, refreshSchedulerData]
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

  function openBookingOnTechLane(techUserId: string, hour24: number) {
    setAssignedTechId(techUserId)
    openBookingAtHour(hour24)
  }

  function openBookingDefault() {
    const defaultHour = Math.max(SCHEDULER_GRID_START_HOUR, Math.min(new Date().getHours(), SCHEDULER_GRID_END_HOUR))
    openBookingAtHour(defaultHour)
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

  function setIntakeField(
    name: string,
    value: string | boolean | import("@/lib/structured-address").StructuredAddress | null
  ) {
    setIntakeValues((prev) => ({ ...prev, [name]: value }))
  }

  async function saveBooking() {
    setBookingSaving(true)
    setBookingError(null)
    try {
      const serialized = serializeIntakeValues(intakeValues)
      const res = await fetch("/api/owner/scheduler", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          scheduled_at: new Date(bookingStart).toISOString(),
          duration_minutes: bookingDurationMinutes,
          assigned_tech_id: assignedTechId.trim() || null,
          organization_id: orgId,
          job_type: String(serialized.job_type ?? "Other"),
          vehicle_year: serialized.vehicle_year ?? null,
          vehicle_make: serialized.vehicle_make ?? null,
          vehicle_model: serialized.vehicle_model ?? null,
          job_notes: serialized.job_notes ?? null,
          structured_address: intakeValues.job_address ?? null,
          intake_fields: serialized,
        }),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not save appointment")
      const event = json.data?.event
      if (!event) throw new Error("No event returned")
      handleAppointmentCreated(event)
      setBookingOpen(false)
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Could not save appointment")
    } finally {
      setBookingSaving(false)
    }
  }

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
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <PhoneLookupBar
        organizationId={orgId}
        onResults={handlePhoneLookupResults}
        className="order-first w-full sm:order-none sm:mr-1"
      />
      <Button type="button" size="sm" className="gap-1.5 lg:hidden" onClick={openBookingDefault}>
        <Plus className="h-4 w-4" aria-hidden />
        Create appointment
      </Button>
    </div>
  )

  return (
    <>
      <WorkspacePage>
        <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" action={headerAction} />

        <p className="text-sm text-zinc-500">
          {intakeProfile === "locksmith"
            ? "Locksmith workspace — vehicle cascade, VIN lookup, AKL / key-type flags, and validated job addresses."
            : intakeProfile === "detailing"
              ? "Detailing workspace — vehicle size, pet hair, on-site utilities, and validated job addresses."
              : "Automotive field jobs with industry-specific intake fields and validated addresses."}
        </p>

        <div className="grid w-full grid-cols-1 items-start gap-4 pb-28 lg:grid-cols-3 lg:gap-6 lg:pb-2">
          {/* Left control column — hopper, live metrics, calendar (desktop) */}
          <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
            <Button
              type="button"
              size="sm"
              className="hidden w-full gap-1.5 lg:inline-flex"
              onClick={openBookingDefault}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create appointment
            </Button>

            <div className="lg:hidden">
              <JobPoolPanel
                jobs={displayPoolJobs}
                highlightId={highlightId}
                onSelectJob={openPoolJobDrawer}
                onMobileAssignJob={queueMobilePoolAssign}
              />
            </div>
            <div className="hidden lg:block">
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
                selectedDay={selectedDay}
                poolJobs={displayPoolJobs}
                activePipelineJobs={displayPipelineJobs}
                dayEvents={dayEvents}
                onSelectJob={focusJobById}
                onMarkComplete={handleMarkJobComplete}
                completingJobId={completingId}
              />
            </div>
            <div className="hidden lg:block">
              <SchedulerDispatchLiveStatus
                sidebar
                selectedDay={selectedDay}
                poolJobs={displayPoolJobs}
                activePipelineJobs={displayPipelineJobs}
                dayEvents={dayEvents}
                onSelectJob={focusJobById}
                onMarkComplete={handleMarkJobComplete}
                completingJobId={completingId}
              />
            </div>

            <WorkspacePanel className="hidden flex-col p-2 lg:flex">
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
                className="mx-auto w-full p-0"
              />
              {loading ? (
                <SchedulerCalendarStatsSkeleton />
              ) : (
                <p className="mt-1 text-center text-[11px] text-zinc-500">
                  {displayEvents.length} scheduled this month
                  {displayPoolJobs.length > 0 ? ` · ${displayPoolJobs.length} in hopper` : ""}
                </p>
              )}
            </WorkspacePanel>
          </div>

          {/* Main workspace — pipeline + swimlanes */}
          <div className="flex w-full min-w-0 flex-col gap-3 lg:col-span-2 lg:gap-4">
            {markCompleteError ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {markCompleteError}
              </p>
            ) : null}

            <WorkspacePanel className="flex w-full flex-col overflow-hidden">
              <div className="border-b border-border/60 px-3 py-2 lg:px-4 lg:py-2.5">
                <h2 className="text-sm font-semibold text-foreground">Active pipeline</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {displayPipelineJobs.length} active job{displayPipelineJobs.length === 1 ? "" : "s"} today
                </p>
              </div>
              <div className="max-h-[min(420px,50vh)] overflow-y-auto bg-card/40 lg:max-h-[min(220px,30vh)]">
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

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 lg:px-4 lg:py-2.5">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Tech swimlanes · {assignableTechs.length} technician
                    {assignableTechs.length === 1 ? "" : "s"} · {dayEvents.length} job
                    {dayEvents.length === 1 ? "" : "s"} scheduled
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5 lg:hidden" onClick={openBookingDefault}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Create
                </Button>
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
                onBookEmptySlot={openBookingOnTechLane}
                mobileAssignRequest={mobileAssignRequest}
                onMobileAssignRequestClear={() => setMobileAssignRequest(null)}
              />
            </WorkspacePanel>
          </div>
        </div>
      </WorkspacePage>

      {bookingOpen ? (
        <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-card sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create appointment</DialogTitle>
              <DialogDescription>
                {intakeModalTitle}
                {activeOrgName ? ` · ${activeOrgName}` : ""}
                {lineIndustryTags[0] ? ` (${lineIndustryTags[0]})` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Customer name</span>
                <input
                  className={bookingInputClass}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Jane Smith"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Phone number</span>
                <input
                  className={bookingInputClass}
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(502) 555-0100"
                />
              </label>

              <IndustryIntakeFormFields
                intakeProfile={intakeProfile}
                organizationName={activeOrgName}
                industryTags={lineIndustryTags}
                values={intakeValues}
                onChange={setIntakeField}
                gridClassName="grid gap-4"
              />

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Assigned tech</span>
                <select
                  className={bookingInputClass}
                  value={assignedTechId}
                  onChange={(e) => setAssignedTechId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignableTechs.map((t) => (
                    <option key={t.id} value={t.portal_user_id!}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Start time</span>
                  <input
                    className={bookingInputClass}
                    type="datetime-local"
                    value={bookingStart}
                    onChange={(e) => setBookingStart(e.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-foreground">Duration</span>
                  <select
                    className={bookingInputClass}
                    value={bookingDurationMinutes}
                    onChange={(e) => setBookingDurationMinutes(Number(e.target.value))}
                  >
                    {SCHEDULER_DURATION_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {bookingError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {bookingError}
                </p>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setBookingOpen(false)} disabled={bookingSaving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveBooking()} disabled={bookingSaving || !canSaveBooking}>
                {bookingSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Save appointment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

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
