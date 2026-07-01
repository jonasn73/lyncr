"use client"

// Owner job scheduler — month calendar, tech swimlanes or map route view, manual booking.

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { mutate as globalMutate } from "swr"
import { ChevronDown, LayoutGrid, Loader2, Map as MapIcon, Plus } from "lucide-react"
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
import { cn } from "@/lib/utils"
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
import { DispatchOperationsMetricStrip } from "@/components/scheduler/dispatch-operations-metric-strip"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import { SchedulerCalendarStatsSkeleton } from "@/components/scheduler/scheduler-panel-skeletons"
import type { SchedulerRouteMapHandle, DrivingRouteFocus } from "@/components/scheduler-route-map"
import { PhoneLookupBar } from "@/components/scheduler/phone-lookup-bar"
import { TechnicianSwimlaneBoard } from "@/components/scheduler/technician-swimlane-board"
import { SchedulerMobileDispatchShell } from "@/components/scheduler/scheduler-mobile-dispatch-shell"
import { JobDetailDrawer } from "@/components/scheduler/job-detail-drawer"
import { IntakeScheduleDialog } from "@/components/scheduler/intake-schedule-dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { setMainScrollLocked } from "@/lib/mobile-scroll-lock"
import type {
  ActivePipelineJob,
  FieldTechnician,
  SchedulerEvent,
  SchedulerPhoneLookupResult,
  TechLiveLocation,
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

const MapLoadingSkeleton = () => (
  <div className="h-full min-h-[320px] w-full animate-pulse bg-zinc-950/40" aria-hidden />
)

const SchedulerRouteMap = dynamic(
  () => import("@/components/scheduler-route-map").then((m) => ({ default: m.SchedulerRouteMap })),
  {
    ssr: false,
    loading: MapLoadingSkeleton,
  }
)

type SchedulerViewMode = "grid" | "map"

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
  const [viewMode, setViewMode] = useState<SchedulerViewMode>("map")
  const isMobile = useIsMobile()
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [intakeValues, setIntakeValues] = useState<IntakeFormValues>({})
  const [bookingDurationMinutes, setBookingDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [bookingSaving, setBookingSaving] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [techLocations, setTechLocations] = useState<TechLiveLocation[]>([])
  const mapRef = useRef<SchedulerRouteMapHandle>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [drawerPoolJob, setDrawerPoolJob] = useState<UnassignedPoolJob | null>(null)
  const [drawerScheduledEvent, setDrawerScheduledEvent] = useState<SchedulerEvent | null>(null)
  const [gridScheduleError, setGridScheduleError] = useState<string | null>(null)
  const [gridScheduleSaving, setGridScheduleSaving] = useState(false)
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
  const selectedDayLabel = selectedDay.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  const mapRouteFocus = useMemo((): DrivingRouteFocus | null => {
    if (viewMode !== "grid") return null
    const drawerOpen = Boolean(drawerPoolJob || drawerScheduledEvent)
    if (!drawerOpen) return null

    const job = drawerScheduledEvent ?? drawerPoolJob
    if (!job || typeof job.latitude !== "number" || typeof job.longitude !== "number") return null

    const techId =
      "assigned_tech_id" in job && job.assigned_tech_id ? job.assigned_tech_id : null
    let techLat: number | null = null
    let techLng: number | null = null
    if (techId) {
      const live = techLocations.find((t) => t.tech_user_id === techId)
      if (live && typeof live.latitude === "number" && typeof live.longitude === "number") {
        techLat = live.latitude
        techLng = live.longitude
      }
    }

    return {
      jobLat: job.latitude,
      jobLng: job.longitude,
      techLat,
      techLng,
      accountForDrawer: true,
    }
  }, [viewMode, drawerPoolJob, drawerScheduledEvent, techLocations])

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

  /** Pan the map to a job pin when map view is active. */
  function panMapToJob(
    job: ActivePipelineJob | SchedulerEvent | UnassignedPoolJob,
    accountForDrawer = false
  ) {
    const lat =
      typeof job.latitude === "number" ? job.latitude : Number.parseFloat(String(job.latitude ?? ""))
    const lng =
      typeof job.longitude === "number" ? job.longitude : Number.parseFloat(String(job.longitude ?? ""))
    const validLat = Number.isFinite(lat) ? lat : undefined
    const validLng = Number.isFinite(lng) ? lng : undefined
    mapRef.current?.focusJob(job.id, validLat, validLng, { accountForDrawer })
  }

  function openPoolJobDrawer(job: UnassignedPoolJob) {
    openJobForEdit(job)
  }

  function openScheduledJobDrawer(ev: SchedulerEvent) {
    openJobForEdit(ev)
  }

  /** List card tap — highlight on map only (does not open or close the editor). */
  function highlightPipelineJob(job: ActivePipelineJob) {
    setHighlightId(job.id)
    if (viewMode === "map") panMapToJob(job, false)
  }

  /** Edit button / card — open the job editor on the next frame (avoids dialog dismissing the opening click). */
  function editPipelineJob(job: ActivePipelineJob | UnassignedPoolJob | SchedulerEvent) {
    suppressUrlFocusRef.current = true
    setHighlightId(job.id)
    if (viewMode === "map") panMapToJob(job, false)

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

  const loadTechLocations = useCallback(() => {
    return fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("jobs"))))
      .then((j: { data?: { techLocations?: TechLiveLocation[] } }) => {
        setTechLocations(Array.isArray(j.data?.techLocations) ? j.data!.techLocations! : [])
      })
      .catch(() => setTechLocations([]))
  }, [])

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

    return Promise.all([
      bootstrapFetch,
      viewMode === "map" ? loadTechLocations() : Promise.resolve(),
    ]).finally(() => {
      initialBootstrapDoneRef.current = true
      setLoading(false)
    })
  }, [monthKey, orgQuery, viewMode, loadTechLocations])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (viewMode !== "map") return
    void loadTechLocations()
  }, [viewMode, loadTechLocations])

  const refreshSchedulerData = useCallback(() => {
    load()
    void mutatePool()
    if (viewMode === "map") {
      void mutateActivePipeline()
      loadTechLocations()
    }
  }, [load, mutatePool, viewMode, mutateActivePipeline, loadTechLocations])

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
      if (viewMode === "map") void mutateActivePipeline()
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
    channel.bind("tech-location-updated", () => {
      if (viewMode === "map") loadTechLocations()
    })
    return () => {
      channel.unbind("job-status-updated", onJobStatus)
      channel.unbind("job-booked", refreshSchedulerData)
      channel.unbind("job-assigned", onJobAssigned)
      channel.unbind("disposition-updated", refreshSchedulerData)
      channel.unbind("tech-location-updated")
      pusher.unsubscribe(`owner-${ownerUserId}`)
    }
  }, [ownerUserId, refreshSchedulerData, load, viewMode, loadTechLocations, mutatePool, mutateActivePipeline])

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
    if (viewMode === "map") {
      void mutateActivePipeline()
    } else if (typeof event.latitude === "number" && typeof event.longitude === "number") {
      const techId = event.assigned_tech_id
      const live = techId ? techLocations.find((t) => t.tech_user_id === techId) : null
      mapRef.current?.fitDrivingRoute({
        jobLat: event.latitude,
        jobLng: event.longitude,
        techLat: live?.latitude ?? null,
        techLng: live?.longitude ?? null,
        accountForDrawer: true,
      })
    }
    if (viewMode === "map") void mutateActivePipeline()
    refreshSchedulerData()
  }

  function closeJobDrawer() {
    document.body.style.overflow = ""
    suppressUrlFocusRef.current = false
    setDrawerPoolJob(null)
    setDrawerScheduledEvent(null)
    if (viewMode === "map") setHighlightId(null)
  }

  const completeScheduleIntent = useCallback(
    (event?: SchedulerEvent) => {
      setScheduleIntentLeadId(null)
      setIntakeScheduleJob(null)
      router.replace("/dashboard/scheduler", { scroll: false })
      setViewMode("map")
      if (!suppressUrlFocusRef.current) {
        setDrawerPoolJob(null)
        setDrawerScheduledEvent(null)
      }
      void mutatePool()
      void mutateActivePipeline()
      if (event) {
        setHighlightId(event.id)
        const lat = typeof event.latitude === "number" ? event.latitude : undefined
        const lng = typeof event.longitude === "number" ? event.longitude : undefined
        window.setTimeout(() => mapRef.current?.focusJob(event.id, lat, lng), 120)
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
      } else if (viewMode === "map") {
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
      const lat = typeof job.latitude === "number" ? job.latitude : undefined
      const lng = typeof job.longitude === "number" ? job.longitude : undefined
      window.setTimeout(() => mapRef.current?.focusJob(job.id, lat, lng), 120)
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
        panMapToJob(pipelineJob)
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
        if (viewMode === "map") panMapToJob(scheduled)
      } else if (poolJob) {
        openJobForEdit(poolJob, { fromUrl: true })
        if (viewMode === "map") panMapToJob(poolJob as ActivePipelineJob)
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
    viewMode,
    completeScheduleIntent,
    dayEvents,
    poolLoading,
  ])

  useEffect(() => {
    const shouldLock = isActive && isMobile && viewMode === "map"
    if (!shouldLock) return
    setMainScrollLocked(true)
    return () => setMainScrollLocked(false)
  }, [isActive, isMobile, viewMode])

  const isMobileMap = isActive && isMobile && viewMode === "map"

  const headerAction = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <PhoneLookupBar
        organizationId={orgId}
        onResults={handlePhoneLookupResults}
        className={cn("order-first w-full sm:order-none sm:mr-1", isMobileMap && "hidden")}
      />
      <div className="hidden rounded-md border border-border/70 p-0.5 sm:flex">
        <Button
          type="button"
          size="sm"
          variant={viewMode === "map" ? "default" : "ghost"}
          className="gap-1.5 px-3 text-xs"
          onClick={() => setViewMode("map")}
        >
          <MapIcon className="h-3.5 w-3.5" aria-hidden />
          Map Route View
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewMode === "grid" ? "default" : "ghost"}
          className="gap-1.5 px-3 text-xs"
          onClick={() => setViewMode("grid")}
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
          Grid View
        </Button>
      </div>
      <Button type="button" size="sm" className="gap-1.5" onClick={openBookingDefault}>
        <Plus className="h-4 w-4" aria-hidden />
        Create appointment
      </Button>
    </div>
  )

  return (
    <>
      {isMobileMap ? (
        <SchedulerMobileDispatchShell
          mapRef={mapRef}
          dayEvents={dayEvents}
          activePipelineJobs={displayPipelineJobs}
          poolJobs={displayPoolJobs}
          techLocations={techLocations}
          selectedDayLabel={selectedDayLabel}
          selectedDay={selectedDay}
          highlightId={highlightId}
          pipelineDayKey={pipelineDayKey}
          useStreamedPipeline={useStreamedPipeline}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onCreate={openBookingDefault}
          onFocusJob={highlightPipelineJob}
          onEditJob={editPipelineJob}
          onSelectEvent={focusScheduledMapJob}
          onSelectPoolJob={(job) => focusPipelineJob(job as ActivePipelineJob)}
        />
      ) : (
        <WorkspacePage>
      <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" action={headerAction} />

      <p className="-mt-4 text-sm text-zinc-500">
        {intakeProfile === "locksmith"
          ? "Locksmith workspace — vehicle cascade, VIN lookup, AKL / key-type flags, and validated job addresses."
          : intakeProfile === "detailing"
            ? "Detailing workspace — vehicle size, pet hair, on-site utilities, and validated job addresses."
            : "Automotive field jobs with industry-specific intake fields and route map."}
      </p>

      <div className="flex gap-2 sm:hidden">
        <div className="flex w-full rounded-md border border-border/70 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={viewMode === "map" ? "default" : "ghost"}
            className="flex-1 gap-1 text-xs"
            onClick={() => setViewMode("map")}
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden />
            Map
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "grid" ? "default" : "ghost"}
            className="flex-1 gap-1 text-xs"
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            Grid
          </Button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <JobPoolPanel jobs={displayPoolJobs} highlightId={highlightId} onSelectJob={openPoolJobDrawer} />
      ) : null}

      {viewMode === "map" ? (
        <DispatchOperationsMetricStrip
          poolJobs={displayPoolJobs}
          activePipelineJobs={displayPipelineJobs}
          dayEvents={dayEvents}
        />
      ) : null}

      {viewMode === "grid" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <WorkspacePanel className="flex flex-col p-3">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
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
              <div className="mt-2">
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
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    {displayEvents.length} scheduled this month
                    {displayPoolJobs.length > 0 ? ` · ${displayPoolJobs.length} in hopper` : ""}
                  </p>
                )}
              </div>
            </details>
          </WorkspacePanel>

          <WorkspacePanel className="flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
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
              <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-sm text-destructive">
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
            />
          </WorkspacePanel>
        </div>
      ) : (
        <>
          <div className={cn("gap-4 lg:grid-cols-[minmax(0,320px)_1fr]", !isMobile ? "grid" : "hidden")}>
            <WorkspacePanel className="flex flex-col p-3">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
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
                <div className="mt-2">
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
                    <p className="mt-2 text-center text-xs text-zinc-500">
                      {displayEvents.length} scheduled this month
                      {displayPoolJobs.length > 0 ? ` · ${displayPoolJobs.length} in hopper` : ""}
                    </p>
                  )}
                </div>
              </details>
            </WorkspacePanel>

            <WorkspacePanel className="flex flex-col overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Dispatch map · {displayPipelineJobs.length} active job
                    {displayPipelineJobs.length === 1 ? "" : "s"} · {techLocations.length} tech
                    {techLocations.length === 1 ? "" : "s"} live
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5 lg:hidden" onClick={openBookingDefault}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Create
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col lg:min-h-[min(720px,70vh)] lg:flex-row">
                <div className="min-h-0 flex-1 overflow-y-auto border-b border-border/60 bg-card/40 lg:w-[40%] lg:flex-none lg:border-b-0 lg:border-r">
                  <ActivePipelinePanelStream
                    jobs={displayPipelineJobs}
                    dayKey={pipelineDayKey}
                    useStreamedInitialDay={useStreamedPipeline}
                    highlightId={highlightId}
                    onFocusJob={highlightPipelineJob}
                    onEditJob={editPipelineJob}
                  />
                </div>
                <div className="relative min-h-[320px] min-w-0 flex-1 lg:min-h-0">
                  <SchedulerRouteMap
                    ref={mapRef}
                    events={dayEvents}
                    pipelineJobs={displayPipelineJobs}
                    poolJobs={displayPoolJobs}
                    techLocations={techLocations}
                    selectedDayLabel={selectedDayLabel}
                    highlightId={highlightId}
                    routeFocus={null}
                    embedded
                    disableHoverTooltips={false}
                    onSelectEvent={focusScheduledMapJob}
                    onSelectPoolJob={(job) => focusPipelineJob(job as ActivePipelineJob)}
                  />
                </div>
              </div>
            </WorkspacePanel>
          </div>
        </>
      )}

        </WorkspacePage>
      )}

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
