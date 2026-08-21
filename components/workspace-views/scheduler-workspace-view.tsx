"use client"

// Owner job scheduler — month calendar, tech swimlanes, manual-call dispatch.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { SCHEDULER_GLASS_CARD } from "@/lib/scheduler-ui-tokens"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { Calendar } from "@/components/ui/calendar"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import {
  ClientSearchParamsBridge,
  readWindowSearchQuery,
  searchQueryToParams,
} from "@/components/client-search-params-bridge"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useSessionCacheReady } from "@/components/session-cache-hydration-gate"
import { useSessionSeed } from "@/lib/hooks/use-client-seed"
import { resolveWorkspaceIntakeProfile } from "@/lib/workspace-intake-profile"
import {
  SCHEDULER_GRID_END_HOUR,
  SCHEDULER_GRID_START_HOUR,
  dayKeyLocal,
  dateAtLocalHour,
} from "@/lib/scheduler-utils"
import { isActivePipelineFeedJob, isHopperPoolJob, isTerminalOperatorJobStatus } from "@/lib/scheduler-job-status"
import { isCrmSalvageOrQuoteDispatch } from "@/lib/job-pool"
import { schedulerEventToPoolJob } from "@/lib/job-pipeline-status"
import {
  buildCrmReturnUrl,
  parseSchedulerFocusSearch,
} from "@/lib/scheduler-focus-url"
import { emitReturnToIntakeFromMap } from "@/lib/dispatch-map-focus"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import {
  optimisticRemovePoolJob,
  useActivePipelineQuery,
  useJobPoolQuery,
} from "@/lib/hooks/use-job-pool-query"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import {
  writeSchedulerPaintSeed,
} from "@/lib/scheduler-paint-cache"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { JobPoolPanel } from "@/components/scheduler/job-pool-panel"
import { SchedulerDispatchLiveStatus } from "@/components/scheduler/scheduler-dispatch-live-status"
import { ActivePipelinePanelStream } from "@/components/scheduler/active-pipeline-panel-stream"
import {
  TechnicianSwimlaneBoard,
  type MobileSchedulerAssignRequest,
} from "@/components/scheduler/technician-swimlane-board"
import { JobDetailDrawer } from "@/components/scheduler/job-detail-drawer"
import { IntakeScheduleDialog } from "@/components/scheduler/intake-schedule-dialog"
import { AddBlockoutModal } from "@/components/scheduler/add-blockout-modal"
import { ScheduleBlockoutsPanel } from "@/components/scheduler/schedule-blockouts-panel"
import { BookingDepositSettings } from "@/components/scheduler/booking-deposit-settings"
import { useRegisterDispatchCommands } from "@/lib/dispatch-command-bridge"
import { useMarkJobComplete } from "@/lib/hooks/use-mark-job-complete"
import { useEscapeDismiss } from "@/lib/hooks/use-workspace-keyboard"
import { defaultIntakeScheduleDate } from "@/lib/intake-schedule-helpers"
import { useHeldList } from "@/lib/hooks/use-held-list"
import { SettledCount } from "@/components/settled-text"
import { useFlickerCountWatch } from "@/lib/debug/flicker-debug"
import type {
  ActivePipelineJob,
  FieldTechnician,
  ScheduleBlockout,
  SchedulerEvent,
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

type SchedulerBootstrapCache = {
  events: SchedulerEvent[]
  blockouts: ScheduleBlockout[]
  technicians: FieldTechnician[]
  lineIndustryTags: string[]
  ownerUserId: string | null
}

function schedulerBootstrapCacheKey(monthKey: string, orgId: string | null): string {
  return persistedCacheKey("scheduler-bootstrap", `${orgId ?? "default"}:${monthKey}`)
}

function readSchedulerBootstrapCache(
  monthKey: string,
  orgId: string | null
): SchedulerBootstrapCache | null {
  const cached = readPersistedCache<SchedulerBootstrapCache>(
    schedulerBootstrapCacheKey(monthKey, orgId)
  )
  if (!cached || !Array.isArray(cached.events)) return null
  return cached
}

/** True when cache has techs or jobs — empty envelopes must not clear loading (quiet flash). */
function schedulerBootstrapHasContent(
  cached: SchedulerBootstrapCache | null | undefined
): boolean {
  if (!cached) return false
  return (
    (Array.isArray(cached.technicians) && cached.technicians.length > 0) ||
    (Array.isArray(cached.events) && cached.events.length > 0)
  )
}

function SchedulerWorkspaceViewInner({
  isActive = true,
  urlQuery,
}: {
  isActive?: boolean
  // Live URL query from ClientSearchParamsBridge (does not suspend this pane).
  urlQuery: string
}) {
  const router = useRouter()
  // Parse ?focus= without useSearchParams() remounting Scheduler on tab click.
  const searchParams = useMemo(() => searchQueryToParams(urlQuery), [urlQuery])
  const inboundCallPanel = useInboundCallPanelOptional()
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const orgIdForSeed =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date())
  // Lazy session read once — never call sessionStorage on every render (#185).
  const [events, setEvents] = useState<SchedulerEvent[]>(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return readSchedulerBootstrapCache(monthKey, orgIdForSeed)?.events ?? []
  })
  const [blockouts, setBlockouts] = useState<ScheduleBlockout[]>(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return readSchedulerBootstrapCache(monthKey, orgIdForSeed)?.blockouts ?? []
  })
  const [blockoutModalOpen, setBlockoutModalOpen] = useState(false)
  const [deletingBlockoutId, setDeletingBlockoutId] = useState<string | null>(null)
  const [technicians, setTechnicians] = useState<FieldTechnician[]>(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return readSchedulerBootstrapCache(monthKey, orgIdForSeed)?.technicians ?? []
  })
  const [lineIndustryTags, setLineIndustryTags] = useState<string[]>(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return readSchedulerBootstrapCache(monthKey, orgIdForSeed)?.lineIndustryTags ?? []
  })
  // Skip loading shell only when session already has a real board (techs or events).
  // Empty envelopes must not set loading=false — that flashes “Board is quiet” → jobs.
  const [loading, setLoading] = useState(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return !schedulerBootstrapHasContent(readSchedulerBootstrapCache(monthKey, orgIdForSeed))
  })
  // Network bootstrap finished for this month/org — gates the true empty “Board is quiet”.
  const [bootstrapSettled, setBootstrapSettled] = useState(() => {
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    return schedulerBootstrapHasContent(readSchedulerBootstrapCache(monthKey, orgIdForSeed))
  })
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
  /** Avoid re-fetching the same CRM Convert focus id when lists miss it. */
  const focusFetchAttemptedRef = useRef<string | null>(null)
  /** CRM return context survives URL clear when the drawer opens from ?from=crm. */
  const crmReturnRef = useRef<{ customerId: string | null } | null>(null)
  /** Intake View job — close drawer should expand PiP / restore the sheet. */
  const intakeReturnRef = useRef(false)

  const sessionReady = useSessionCacheReady()
  // SSR cannot read sessionStorage — re-apply cache before paint so reload is not empty → rows.
  // Re-run when session unlocks (first layout pass is often still gated).
  useLayoutEffect(() => {
    if (!sessionReady) return
    const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`
    const cached = readSchedulerBootstrapCache(monthKey, orgIdForSeed)
    if (!cached) return
    setEvents((prev) => (prev.length > 0 ? prev : cached.events))
    setBlockouts((prev) => (prev.length > 0 ? prev : cached.blockouts))
    setTechnicians((prev) => (prev.length > 0 ? prev : cached.technicians))
    setLineIndustryTags((prev) => (prev.length > 0 ? prev : cached.lineIndustryTags))
    if (cached.ownerUserId) setOwnerUserId((prev) => prev ?? cached.ownerUserId)
    // Only leave loading when the seed actually has a board to paint.
    if (schedulerBootstrapHasContent(cached)) {
      setLoading(false)
      setBootstrapSettled(true)
    }
  }, [orgIdForSeed, visibleMonth, sessionReady])

  const {
    focusLeadId,
    scheduleFromIntake,
    fromCrm,
    fromIntake,
    customerId: focusCustomerId,
  } = useMemo(() => parseSchedulerFocusSearch(searchParams.toString()), [searchParams])

  // Capture CRM / intake return before openJobForEdit clears focus/from/customer params.
  useEffect(() => {
    if (fromCrm) {
      crmReturnRef.current = { customerId: focusCustomerId }
      intakeReturnRef.current = false
    } else if (fromIntake) {
      intakeReturnRef.current = true
      crmReturnRef.current = null
    }
  }, [fromCrm, fromIntake, focusCustomerId])

  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const orgQuery = orgId ? `&organization_id=${encodeURIComponent(orgId)}` : ""
  // Re-reads after session unlock so hard refresh is not empty → jobs.
  const bootstrapSeed = useSessionSeed(
    () => readSchedulerBootstrapCache(monthKey, orgId),
    null,
    `${orgId ?? "default"}:${monthKey}`
  )
  const bootstrapCacheIdentity = `${orgId ?? "default"}:${monthKey}`
  const appliedBootstrapSeedRef = useRef<string | null>(null)

  // Paint last month bootstrap once per month/org — do not re-apply after live refresh writes cache.
  useLayoutEffect(() => {
    if (!bootstrapSeed) return
    const hasContent = schedulerBootstrapHasContent(bootstrapSeed)
    if (appliedBootstrapSeedRef.current === bootstrapCacheIdentity) {
      // Locked after a non-empty apply — ignore empty re-reads for this month/org.
      return
    }
    if (!hasContent) return
    appliedBootstrapSeedRef.current = bootstrapCacheIdentity
    setEvents(bootstrapSeed.events)
    setBlockouts(bootstrapSeed.blockouts)
    setTechnicians(bootstrapSeed.technicians)
    setLineIndustryTags(bootstrapSeed.lineIndustryTags)
    if (bootstrapSeed.ownerUserId) setOwnerUserId(bootstrapSeed.ownerUserId)
    setLoading(false)
    setBootstrapSettled(true)
  }, [bootstrapCacheIdentity, bootstrapSeed])

  // Pause hopper + pipeline SWR while Scheduler pane / browser tab is hidden.
  const pollEnabled = usePollBudget(isActive)

  const {
    jobs: poolJobs,
    isLoading: poolLoading,
    mutate: mutatePool,
  } = useJobPoolQuery(activeOrganizationId, pollEnabled)

  const pipelineDayKey = dayKeyLocal(selectedDay)
  const streamedPipelineDayKey = dayKeyLocal(new Date())
  const useStreamedPipeline = pipelineDayKey === streamedPipelineDayKey

  const {
    jobs: activePipelineJobs,
    isLoading: pipelineLoading,
    isValidating: pipelineValidating,
    hasResolved: pipelineHasResolved,
    mutate: mutateActivePipeline,
  } = useActivePipelineQuery(activeOrganizationId, pipelineDayKey, pollEnabled)

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

  const poolFiltered = useMemo(
    () => excludeDeletedJobs(poolJobs),
    [poolJobs, excludeDeletedJobs]
  )
  const displayPoolJobs = useHeldList(poolFiltered, {
    scopeKey: activeOrganizationId ?? "default",
    loading: poolLoading || loading || !bootstrapSettled,
  })

  const pipelineFiltered = useMemo(
    () => excludeDeletedJobs(activePipelineJobs).filter(isActivePipelineFeedJob),
    [activePipelineJobs, excludeDeletedJobs]
  )
  // App-wide hold helper — keeps last non-empty pipeline while validating.
  const displayPipelineJobs = useHeldList(pipelineFiltered, {
    scopeKey: pipelineDayKey,
    loading: pipelineLoading || loading || !bootstrapSettled,
    validating: pipelineValidating,
  })

  const boardCountsPending =
    !bootstrapSettled ||
    loading ||
    pipelineLoading ||
    !pipelineHasResolved ||
    (pipelineValidating && displayPipelineJobs.length === 0)
  const techCountsPending = !bootstrapSettled || loading
  const metricsPending =
    !bootstrapSettled ||
    loading ||
    (poolLoading && displayPoolJobs.length === 0) ||
    pipelineLoading ||
    !pipelineHasResolved

  useFlickerCountWatch("SchedulerWorkspaceView", {
    label: "active-pipeline",
    count: displayPipelineJobs.length,
    pending: boardCountsPending,
  })
  useFlickerCountWatch("SchedulerWorkspaceView", {
    label: "assignable-techs",
    count: assignableTechs.length,
    pending: techCountsPending,
  })

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
  // Swimlane subtitle — only jobs that actually land on a tech column (matches lane headers).
  const assignedDayJobCount = useMemo(() => {
    const techIds = new Set(
      assignableTechs.map((t) => t.portal_user_id).filter((id): id is string => Boolean(id))
    )
    return dayEvents.filter((ev) => {
      const id = ev.assigned_tech_id?.trim()
      return Boolean(id && techIds.has(id))
    }).length
  }, [dayEvents, assignableTechs])
  const selectedDayIsToday = selectedKey === todayKey
  const pipelineDayLabel = selectedDayIsToday ? "today" : selectedKey

  /** Clear intake deep-link params so URL focus logic does not override manual job clicks. */
  const clearSchedulerFocusUrl = useCallback(() => {
    const hasFocus =
      searchParams.get("focus") ||
      searchParams.get("schedule") ||
      searchParams.get("from") ||
      searchParams.get("customer")
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
    openPoolJobDrawer(job)
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

  /** Coming Up Next / live-status chip tap — open the same job sheet as pool & pipeline cards. */
  const focusJobById = useCallback(
    (jobId: string) => {
      const pipeline = displayPipelineJobs.find((j) => j.id === jobId)
      if (pipeline) {
        editPipelineJob(pipeline)
        return
      }
      const scheduled = dayEvents.find((ev) => ev.id === jobId)
      if (scheduled) {
        editPipelineJob(scheduled)
        return
      }
      const pool = displayPoolJobs.find((j) => j.id === jobId)
      if (pool) {
        editPipelineJob(pool)
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
    const seeded = schedulerBootstrapHasContent(readSchedulerBootstrapCache(monthKey, orgId))
    // Keep calendar painted from session cache while silently refreshing.
    if (!seeded && !initialBootstrapDoneRef.current) setLoading(true)
    // Month/org change — do not show “Board is quiet” until this fetch finishes.
    if (!seeded) setBootstrapSettled(false)
    const bootstrapUrl = `/api/owner/scheduler/bootstrap?month=${encodeURIComponent(monthKey)}${orgQuery}`

    const bootstrapFetch = fetch(bootstrapUrl, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then(
        (j: {
          data?: {
            events?: SchedulerEvent[]
            blockouts?: ScheduleBlockout[]
            technicians?: FieldTechnician[]
            lineIndustryTags?: string[]
            ownerUserId?: string
          }
        }) => {
          if (seq !== loadSeqRef.current) return
          const deleted = deletedJobIdsRef.current
          const rawEvents = Array.isArray(j.data?.events) ? j.data!.events! : []
          const nextEvents =
            deleted.size > 0 ? rawEvents.filter((ev) => !deleted.has(ev.id)) : rawEvents
          const nextBlockouts = Array.isArray(j.data?.blockouts) ? j.data!.blockouts! : []
          const nextTechs = Array.isArray(j.data?.technicians) ? j.data!.technicians! : []
          const nextTags = Array.isArray(j.data?.lineIndustryTags) ? j.data!.lineIndustryTags! : []
          const nextOwner = j.data?.ownerUserId ?? null
          setEvents(nextEvents)
          setBlockouts(nextBlockouts)
          setTechnicians(nextTechs)
          setLineIndustryTags(nextTags)
          if (nextOwner) setOwnerUserId(nextOwner)
          writePersistedCache(schedulerBootstrapCacheKey(monthKey, orgId), {
            events: nextEvents,
            blockouts: nextBlockouts,
            technicians: nextTechs,
            lineIndustryTags: nextTags,
            ownerUserId: nextOwner,
          } satisfies SchedulerBootstrapCache)
          writeSchedulerPaintSeed(monthKey, nextEvents.length, nextTechs.length, orgId)
          if (nextTechs.length > 0 || nextEvents.length > 0) {
            appliedBootstrapSeedRef.current = `${orgId ?? "default"}:${monthKey}`
          }
        }
      )
      .catch(() => {
        // Keep seed on failure — only blank when we had nothing to show.
        if (!seeded) {
          setEvents([])
          setBlockouts([])
          setTechnicians([])
          setLineIndustryTags([])
        }
      })

    return bootstrapFetch.finally(() => {
      initialBootstrapDoneRef.current = true
      setBootstrapSettled(true)
      setLoading(false)
    })
  }, [monthKey, orgQuery, orgId])

  useEffect(() => {
    // Skip bootstrap network while Scheduler pane is hidden (SWR already paused via pollEnabled).
    if (!isActive) return
    void load()
  }, [load, isActive])

  const refreshSchedulerData = useCallback(() => {
    load()
    void mutatePool(undefined, { revalidate: true })
    void mutateActivePipeline(undefined, { revalidate: true })
  }, [load, mutatePool, mutateActivePipeline])

  useEffect(() => {
    if (!isActive) return
    const onWorkspaceChanged = () => refreshSchedulerData()
    window.addEventListener("lyncr-workspace-data-changed", onWorkspaceChanged)
    return () => window.removeEventListener("lyncr-workspace-data-changed", onWorkspaceChanged)
  }, [refreshSchedulerData, isActive])

  // Pool/pipeline SWR already fetch when keys are live — don't burst-revalidate on every tab focus.

  useEffect(() => {
    if (!isActive || !ownerUserId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`owner-${ownerUserId}`)

    const onJobStatus = (payload: { leadId?: string; status?: string }) => {
      if (!payload?.leadId || !payload?.status) return
      const status = payload.status
      if (status === "completed") {
        registerJobCompletedToday(payload.leadId)
      }
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === payload.leadId
            ? {
                ...ev,
                job_status: status ?? ev.job_status,
                completed_at:
                  status === "completed"
                    ? ev.completed_at ?? new Date().toISOString()
                    : ev.completed_at,
                dispatch_status:
                  status === "assigned" || status === "en_route"
                    ? "DISPATCHED"
                    : ev.dispatch_status,
              }
            : ev
        )
      )
      // Terminal close-outs leave the active pipeline feed.
      if (
        status === "completed" ||
        status === "cancelled" ||
        status === "unresolved" ||
        status === "referred"
      ) {
        void mutateActivePipeline()
        void mutatePool()
      } else {
        void mutateActivePipeline()
      }
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
      // Unbind only — CallAnsweredModal may share owner-* for legacy events.
      channel.unbind("job-status-updated", onJobStatus)
      channel.unbind("job-booked", refreshSchedulerData)
      channel.unbind("job-assigned", onJobAssigned)
      channel.unbind("disposition-updated", refreshSchedulerData)
    }
  }, [ownerUserId, refreshSchedulerData, load, mutatePool, mutateActivePipeline, registerJobCompletedToday, isActive])

  const drawerOpen = Boolean(drawerPoolJob || drawerScheduledEvent)
  const [drawerEditIntentTick, setDrawerEditIntentTick] = useState(0)
  const liveStatusRef = useRef<HTMLDivElement>(null)

  useRegisterDispatchCommands(
    [
      {
        id: "dispatch-status",
        slash: "/status",
        label: "Focus dispatch live status",
        keywords: "live metrics upcoming",
        run: () => {
          liveStatusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        },
      },
      {
        id: "dispatch-tech",
        slash: "/tech",
        label: "Open team roster",
        keywords: "technicians assign",
        run: () => {
          router.push("/dashboard/contacts")
        },
      },
      {
        id: "dispatch-edit",
        slash: "/edit",
        label: "Edit selected job",
        keywords: "drawer details",
        run: () => {
          if (drawerOpen) {
            setDrawerEditIntentTick((tick) => tick + 1)
            return
          }
          router.push("/dashboard/scheduler")
        },
      },
    ],
    [drawerOpen, router]
  )

  function applyJobEventUpdate(event: SchedulerEvent) {
    setHighlightId(event.id)

    // Price denied / CRM quote salvage — leave calendar + hopper; live in CRM Recover.
    const isSalvageOrQuote = isCrmSalvageOrQuoteDispatch({
      dispatch_status: event.dispatch_status,
      job_status: event.job_status,
      disposition: event.disposition,
    })
    if (isSalvageOrQuote) {
      setEvents((prev) => prev.filter((ev) => ev.id !== event.id))
      void mutatePool(
        (current) => (current ?? []).filter((j) => j.id !== event.id),
        { revalidate: true }
      )
      void mutateActivePipeline(
        (current) => (current ?? []).filter((j) => j.id !== event.id),
        { revalidate: true }
      )
      // Keep the drawer open on the saved salvage row so the operator can close it.
      setDrawerScheduledEvent(event)
      setDrawerPoolJob(null)
      refreshSchedulerData()
      return
    }

    // Cancel / Complete / Referred / Unresolved — leave In pool + active pipeline immediately.
    if (isTerminalOperatorJobStatus(event.job_status)) {
      void mutatePool(
        (current) => (current ?? []).filter((j) => j.id !== event.id),
        { revalidate: true }
      )
      void mutateActivePipeline(
        (current) => (current ?? []).filter((j) => j.id !== event.id),
        { revalidate: true }
      )
      // Keep real appointments on the day board; drop unscheduled pool close-outs.
      if (event.scheduled_at && !event.scheduled_tentative) {
        setEvents((prev) => {
          const idx = prev.findIndex((ev) => ev.id === event.id)
          if (idx === -1) {
            const next = [...prev, event]
            next.sort(sortEventsByTime)
            return next
          }
          const next = [...prev]
          next[idx] = event
          return next
        })
        setDrawerScheduledEvent(event)
        setDrawerPoolJob(null)
      } else {
        setEvents((prev) => prev.filter((ev) => ev.id !== event.id))
        setDrawerScheduledEvent(null)
        setDrawerPoolJob(null)
      }
      refreshSchedulerData()
      return
    }

    const inHopper = isHopperPoolJob(event)

    if (inHopper) {
      setDrawerPoolJob(schedulerEventToPoolJob(event))
      setDrawerScheduledEvent(null)
      setEvents((prev) => prev.filter((ev) => ev.id !== event.id))
      void mutatePool(
        (current) => {
          const list = current ?? []
          const poolJob = schedulerEventToPoolJob(event)
          const idx = list.findIndex((j) => j.id === event.id)
          if (idx === -1) return [...list, poolJob]
          const next = [...list]
          next[idx] = poolJob
          return next
        },
        { revalidate: true }
      )
    } else {
      setDrawerScheduledEvent(event)
      setDrawerPoolJob(null)
      setEvents((prev) => {
        const idx = prev.findIndex((ev) => ev.id === event.id)
        if (idx === -1) {
          const next = [...prev, event]
          next.sort(sortEventsByTime)
          return next
        }
        const next = [...prev]
        next[idx] = event
        return next
      })
      void mutatePool(
        (current) => (current ?? []).filter((j) => j.id !== event.id),
        { revalidate: true }
      )
    }

    void mutateActivePipeline(undefined, { revalidate: true })
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
    // Journey started in CRM — return to customers (reopen profile when customer id known).
    const crmReturn = crmReturnRef.current
    if (crmReturn) {
      crmReturnRef.current = null
      intakeReturnRef.current = false
      router.push(buildCrmReturnUrl(crmReturn.customerId))
      return
    }
    // Intake View job / Recent Job Active — expand PiP or reopen the sheet if still active.
    if (intakeReturnRef.current) {
      intakeReturnRef.current = false
      clearSchedulerFocusUrl()
      emitReturnToIntakeFromMap()
      return
    }
    clearSchedulerFocusUrl()
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

  const handleJobDeleted = useCallback(
    (jobId: string) => {
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

      const orgCacheKey = activeOrganizationId ?? "default"
      const nextPool = poolJobs.filter((j) => j.id !== jobId)
      const nextPipeline = activePipelineJobs.filter((j) => j.id !== jobId)

      writePersistedCache(persistedCacheKey("job-pool-hopper", orgCacheKey), nextPool)
      writePersistedCache(
        persistedCacheKey("job-pool-active", `${orgCacheKey}:${pipelineDayKey}`),
        nextPipeline
      )

      void mutatePool(
        (current) => (Array.isArray(current) ? current : poolJobs).filter((j) => j.id !== jobId),
        { revalidate: false, populateCache: true }
      )
      void mutateActivePipeline(
        (current) => (Array.isArray(current) ? current : activePipelineJobs).filter((j) => j.id !== jobId),
        { revalidate: false, populateCache: true }
      )
      void optimisticRemovePoolJob(activeOrganizationId, pipelineDayKey, jobId)
    },
    [
      activeOrganizationId,
      activePipelineJobs,
      closeJobDrawer,
      mutateActivePipeline,
      mutatePool,
      pipelineDayKey,
      poolJobs,
    ]
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

  const dismissSchedulerOverlay = useCallback(() => {
    if (mobileAssignRequest) {
      setMobileAssignRequest(null)
      return
    }
    if (intakeScheduleDialogOpen) {
      handleIntakeScheduleSkip()
      return
    }
    if (drawerPoolJob || drawerScheduledEvent) {
      closeJobDrawer()
    }
  }, [
    mobileAssignRequest,
    intakeScheduleDialogOpen,
    handleIntakeScheduleSkip,
    drawerPoolJob,
    drawerScheduledEvent,
  ])

  useEscapeDismiss(
    isActive && Boolean(mobileAssignRequest || intakeScheduleDialogOpen || drawerPoolJob || drawerScheduledEvent),
    dismissSchedulerOverlay
  )

  useEffect(() => {
    if (!isActive || !focusLeadId) return
    if (scheduleFromIntake) {
      setScheduleIntentLeadId(focusLeadId)
      void mutatePool()
    }
  }, [isActive, focusLeadId, scheduleFromIntake, mutatePool])

  // Allow a fresh CRM Convert deep-link to fetch again after the prior focus cleared.
  useEffect(() => {
    if (!focusLeadId) focusFetchAttemptedRef.current = null
  }, [focusLeadId])

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
        return
      }
      if (poolJob) {
        openJobForEdit(poolJob, { fromUrl: true })
        return
      }
      if (pipelineJob) {
        focusPipelineJob(pipelineJob)
        return
      }
      // CRM Convert: job may be Waiting Pool / callback but not in the current list yet.
      // Fetch by id and open the same JobDetailDrawer Coming Up Next uses.
      if (poolLoading) return
      if (focusFetchAttemptedRef.current === focusLeadId) return
      focusFetchAttemptedRef.current = focusLeadId
      let cancelled = false
      void fetch(`/api/owner/scheduler/${encodeURIComponent(focusLeadId)}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then(async (res) => {
          if (!res.ok) return null
          const json = (await res.json().catch(() => ({}))) as {
            data?: { event?: SchedulerEvent }
          }
          return json.data?.event ?? null
        })
        .then((event) => {
          if (cancelled) return
          if (!event) {
            clearSchedulerFocusUrl()
            return
          }
          setHighlightId(event.id)
          if (event.scheduled_at && !event.scheduled_tentative) {
            const eventDay = dayKeyLocal(new Date(event.scheduled_at))
            if (eventDay !== dayKeyLocal(selectedDay)) {
              const d = new Date(event.scheduled_at)
              setSelectedDay(d)
              setVisibleMonth(d)
            }
            openJobForEdit(event, { fromUrl: true })
          } else {
            openJobForEdit(schedulerEventToPoolJob(event), { fromUrl: true })
          }
        })
        .catch(() => {
          if (!cancelled) clearSchedulerFocusUrl()
        })
      return () => {
        cancelled = true
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

  // Lines pattern: board chrome paints from session; no full-page skeleton cover.
  return (
    <>
      <WorkspacePage>
        <WorkspacePageHeader eyebrow="Dispatch" title="Scheduler" />

        <p className="mb-4 hidden text-xs text-zinc-500 md:block">
          {intakeProfile === "locksmith"
            ? "Vehicle cascade, VIN lookup, and validated job addresses."
            : intakeProfile === "detailing"
              ? "Vehicle size, on-site utilities, and validated job addresses."
              : "Field jobs with intake fields and validated addresses."}
        </p>

        <div className="grid w-full grid-cols-1 items-start gap-3 pb-28 lg:grid-cols-4 lg:gap-4 lg:pb-0">
          {/* Left rail — primary path only: intake → pool → live status */}
          <div className="flex w-full min-w-0 flex-col gap-2 lg:col-span-1 lg:sticky lg:top-[calc(var(--shell-header-h)+0.75rem)] lg:gap-3">
            <div className={cn(SCHEDULER_GLASS_CARD, "overflow-hidden p-0")}>
              {/* Always reserve New Intake height — panel hydrate must not push the board. */}
              <div className="min-h-[3.25rem] border-b border-zinc-800/80 p-2.5">
                <button
                  type="button"
                  onClick={openNewIntake}
                  disabled={!inboundCallPanel}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New Intake
                </button>
              </div>

              <div className="max-h-[min(320px,38vh)] overflow-y-auto border-b border-zinc-800/80 px-2.5 py-2.5 lg:max-h-none lg:overflow-visible">
                <JobPoolPanel
                  jobs={displayPoolJobs}
                  loading={poolLoading && displayPoolJobs.length === 0}
                  highlightId={highlightId}
                  onSelectJob={openPoolJobDrawer}
                  onMobileAssignJob={queueMobilePoolAssign}
                  variant="sidebar"
                  embedded
                />
              </div>

              <div ref={liveStatusRef}>
                <SchedulerDispatchLiveStatus
                  sidebar
                  hidePrimaryAction
                  className="rounded-none border-0 bg-transparent backdrop-blur-none"
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
                  metricsPending={metricsPending}
                />
              </div>
            </div>

            {/* Settings off the primary path — collapsed unless this day already has blockouts. */}
            <details
              className="group rounded-xl border border-zinc-800/80 bg-zinc-950/40 open:bg-zinc-950/60"
              defaultOpen={blockouts.some((b) => b.date === selectedKey)}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-zinc-300 [&::-webkit-details-marker]:hidden">
                <span>Booking &amp; blockouts</span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="space-y-3 border-t border-zinc-800/80 px-3 py-3">
                <BookingDepositSettings className="border-zinc-800/60 bg-zinc-950/40" />
                <ScheduleBlockoutsPanel
                  embedded
                  dateKey={selectedKey}
                  blockouts={blockouts}
                  deletingId={deletingBlockoutId}
                  onAdd={() => setBlockoutModalOpen(true)}
                  onDelete={(id) => {
                    void (async () => {
                      setDeletingBlockoutId(id)
                      try {
                        const res = await fetch(
                          `/api/owner/scheduler/blockouts/${encodeURIComponent(id)}`,
                          {
                            method: "DELETE",
                            credentials: "include",
                          }
                        )
                        if (!res.ok) return
                        setBlockouts((prev) => prev.filter((b) => b.id !== id))
                      } finally {
                        setDeletingBlockoutId(null)
                      }
                    })()
                  }}
                />
              </div>
            </details>
          </div>

          {/* Main workspace — pipeline + swimlanes */}
          <div className="flex w-full min-w-0 flex-col gap-2 lg:col-span-3 lg:gap-3">
            {markCompleteError ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {markCompleteError}
              </p>
            ) : null}

            {/* Always mount pipeline + swimlanes — never swap “quiet” for the board (CLS). */}
            <WorkspacePanel className="flex w-full flex-col overflow-hidden">
              <div className="border-b border-border/60 px-3 py-1.5 lg:px-4 lg:py-2">
                <h2 className="text-sm font-semibold text-foreground">Active pipeline</h2>
                <SettledCount
                  pending={boardCountsPending}
                  count={displayPipelineJobs.length}
                  format={(n) =>
                    `${n} active job${n === 1 ? "" : "s"} ${pipelineDayLabel}`
                  }
                  className="min-h-[1rem] truncate text-xs text-zinc-500"
                />
              </div>
              <div className="max-h-[min(420px,50vh)] min-h-[4.5rem] overflow-y-auto bg-card/40 lg:max-h-[min(160px,22vh)]">
                {/* Always mount — empty/null swap was the flash under pipeline data. */}
                <ActivePipelinePanelStream
                  jobs={displayPipelineJobs}
                  dayKey={pipelineDayKey}
                  useStreamedInitialDay={useStreamedPipeline}
                  highlightId={highlightId}
                  onFocusJob={highlightPipelineJob}
                  onEditJob={editPipelineJob}
                  onMarkComplete={handleMarkJobComplete}
                  completingJobId={completingId}
                  loading={
                    (pipelineLoading || loading || !bootstrapSettled) &&
                    displayPipelineJobs.length === 0
                  }
                />
              </div>
            </WorkspacePanel>

            <WorkspacePanel className="relative flex w-full min-w-0 flex-col overflow-hidden">
              {/* No “Board is quiet” overlay — it flashed over swimlanes while techs loaded. */}
              <details className="group border-b border-border/60 lg:hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                      {/* Label only — live date/time already sits in the status card above. */}
                      <span>Calendar</span>
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
                      <p className="mt-1 min-h-[1rem] truncate text-center text-xs text-zinc-500">
                        {!bootstrapSettled && events.length === 0
                          ? "\u00a0"
                          : `${displayEvents.length} scheduled this month${
                              displayPoolJobs.length > 0
                                ? ` · ${displayPoolJobs.length} in hopper`
                                : ""
                            }`}
                      </p>
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 lg:px-4 lg:py-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Tech swimlanes</h2>
                      <SettledCount
                        pending={techCountsPending && assignableTechs.length === 0}
                        count={assignableTechs.length}
                        format={(n) =>
                          `${n} technician${n === 1 ? "" : "s"} · ${assignedDayJobCount} job${
                            assignedDayJobCount === 1 ? "" : "s"
                          } on lanes`
                        }
                        className="min-h-[1rem] truncate text-xs text-zinc-500"
                      />
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
                    loading={loading || gridScheduleSaving || !bootstrapSettled}
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
        activePipelineJobs={displayPipelineJobs}
        editIntentTick={drawerEditIntentTick}
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

      <AddBlockoutModal
        open={blockoutModalOpen}
        onClose={() => setBlockoutModalOpen(false)}
        organizationId={orgId}
        defaultDate={selectedKey || defaultIntakeScheduleDate()}
        onCreated={(row) => {
          setBlockouts((prev) => [...prev.filter((b) => b.id !== row.id), row])
        }}
      />
    </>
  )
}

/** Outer wrapper: URL bridge is isolated — Inner stays mounted across tab clicks. */
export function SchedulerWorkspaceView({ isActive = true }: { isActive?: boolean }) {
  // Seed from window so ?focus= / ?from= paint before the bridge hydrates.
  const [urlQuery, setUrlQuery] = useState(readWindowSearchQuery)
  const onQuery = useCallback((q: string) => setUrlQuery(q), [])
  return (
    <>
      <ClientSearchParamsBridge onQuery={onQuery} />
      <SchedulerWorkspaceViewInner isActive={isActive} urlQuery={urlQuery} />
    </>
  )
}
