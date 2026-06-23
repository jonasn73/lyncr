"use client"

// Owner job scheduler — month calendar, hourly grid or map route view, manual booking.

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Car, Clock, LayoutGrid, Loader2, Map as MapIcon, MapPin, Phone, Plus, User } from "lucide-react"
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
  SCHEDULER_HOUR_ROW_PX,
  dayKeyLocal,
  dateAtLocalHour,
  formatHourLabel,
  schedulerEventPlacement,
  schedulerHourSlots,
  toDatetimeLocalValue,
} from "@/lib/scheduler-utils"
import {
  SCHEDULER_CARD_STYLE,
  SCHEDULER_STATUS_LABEL,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import { HOPPER_DRAG_MIME } from "@/components/scheduler/job-pool-card"
import { JobDetailDrawer } from "@/components/scheduler/job-detail-drawer"
import { JobPoolTray } from "@/components/scheduler/job-pool-tray"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import type { SchedulerRouteMapHandle } from "@/components/scheduler-route-map"
import { PhoneLookupBar } from "@/components/scheduler/phone-lookup-bar"
import { PoolScheduleDialog } from "@/components/scheduler/pool-schedule-dialog"
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

const SchedulerRouteMap = dynamic(
  () => import("@/components/scheduler-route-map").then((m) => ({ default: m.SchedulerRouteMap })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[320px] items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" aria-hidden />
      </div>
    ),
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

function formatBlockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function formatVehicle(ev: SchedulerEvent): string | null {
  const parts = [ev.vehicle_year, ev.vehicle_make, ev.vehicle_model].filter(Boolean)
  return parts.length ? parts.join(" ") : null
}


function eventCardStyle(ev: SchedulerEvent): string {
  const phase = schedulerLifecyclePhase({
    job_status: ev.job_status,
    dispatch_status: ev.dispatch_status,
    assigned_tech_id: ev.assigned_tech_id,
  })
  return SCHEDULER_CARD_STYLE[phase]
}

function sortEventsByTime(a: SchedulerEvent, b: SchedulerEvent): number {
  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
}

function AppointmentBlock({
  ev,
  highlighted,
  onSelect,
}: {
  ev: SchedulerEvent
  highlighted?: boolean
  onSelect?: () => void
}) {
  const vehicle = formatVehicle(ev)
  const { topPx, heightPx } = schedulerEventPlacement(
    ev.scheduled_at,
    ev.duration_minutes,
    ev.scheduled_tentative
  )
  const phase = schedulerLifecyclePhase({
    job_status: ev.job_status,
    dispatch_status: ev.dispatch_status,
    assigned_tech_id: ev.assigned_tech_id,
  })
  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      className={cn(
        "absolute left-2 right-2 z-10 overflow-hidden rounded-lg border px-2 py-1.5 shadow-md",
        onSelect ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
        highlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        eventCardStyle(ev)
      )}
      style={{ top: topPx, height: heightPx, minHeight: 36 }}
    >
      <p className="truncate text-xs font-semibold">
        {ev.customer_name || formatPhone(ev.customer_phone) || "Customer"}
        <span className="ml-1 text-[9px] font-medium uppercase opacity-75">
          · {SCHEDULER_STATUS_LABEL[phase]}
        </span>
      </p>
      <p className="truncate text-[10px] opacity-90">
        {vehicle || ev.job_type || ev.summary || "Appointment"}
        {ev.assigned_tech_name ? ` · ${ev.assigned_tech_name}` : ""}
      </p>
      <p className="text-[10px] opacity-75">
        {formatBlockTime(ev.scheduled_at)}
        {ev.duration_minutes ? ` · ${ev.duration_minutes}m` : ""}
      </p>
    </div>
  )
}

function DayRouteList({ events }: { events: SchedulerEvent[] }) {
  const sorted = useMemo(() => [...events].sort(sortEventsByTime), [events])
  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-zinc-500">
        No appointments on this day — use Create appointment to book a route stop.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border/50">
      {sorted.map((ev, idx) => {
        const vehicle = formatVehicle(ev)
        const hasCoords = typeof ev.latitude === "number" && typeof ev.longitude === "number"
        const phase = schedulerLifecyclePhase({
          job_status: ev.job_status,
          dispatch_status: ev.dispatch_status,
          assigned_tech_id: ev.assigned_tech_id,
        })
        return (
          <li
            key={ev.id}
            className={cn(
              "flex gap-3 border-l-[3px] px-4 py-3 transition-colors",
              eventCardStyle(ev)
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                hasCoords ? "bg-teal-500/25 text-teal-100" : "bg-muted text-zinc-500"
              )}
            >
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {formatBlockTime(ev.scheduled_at)}
                <span className="ml-2 rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  {SCHEDULER_STATUS_LABEL[phase]}
                </span>
                <span className="ml-2 font-normal text-zinc-400">
                  {ev.customer_name || formatPhone(ev.customer_phone)}
                </span>
              </p>
              {vehicle ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
                  <Car className="h-3 w-3 shrink-0" aria-hidden />
                  {vehicle}
                </p>
              ) : null}
              {ev.job_type ? <p className="mt-0.5 text-xs text-zinc-500">{ev.job_type}</p> : null}
              {ev.location ? (
                <p className="mt-0.5 flex items-start gap-1 text-xs text-zinc-500">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="line-clamp-2">{ev.location}</span>
                </p>
              ) : null}
              {ev.job_notes ? (
                <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{ev.job_notes}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function SchedulerWorkspaceView() {
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date())
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date())
  const [events, setEvents] = useState<SchedulerEvent[]>([])
  const [technicians, setTechnicians] = useState<FieldTechnician[]>([])
  const [lineIndustryTags, setLineIndustryTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingStart, setBookingStart] = useState(() => toDatetimeLocalValue(new Date()))
  const [viewMode, setViewMode] = useState<SchedulerViewMode>("grid")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [intakeValues, setIntakeValues] = useState<IntakeFormValues>({})
  const [bookingDurationMinutes, setBookingDurationMinutes] = useState(60)
  const [assignedTechId, setAssignedTechId] = useState("")
  const [bookingSaving, setBookingSaving] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [poolJobs, setPoolJobs] = useState<UnassignedPoolJob[]>([])
  const [activePipelineJobs, setActivePipelineJobs] = useState<ActivePipelineJob[]>([])
  const [activePipelineLoading, setActivePipelineLoading] = useState(false)
  const [techLocations, setTechLocations] = useState<TechLiveLocation[]>([])
  const mapRef = useRef<SchedulerRouteMapHandle>(null)
  const [poolLoading, setPoolLoading] = useState(true)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [drawerPoolJob, setDrawerPoolJob] = useState<UnassignedPoolJob | null>(null)
  const [drawerScheduledEvent, setDrawerScheduledEvent] = useState<SchedulerEvent | null>(null)
  const [poolScheduleOpen, setPoolScheduleOpen] = useState(false)
  const [poolScheduleJob, setPoolScheduleJob] = useState<UnassignedPoolJob | null>(null)
  const [poolScheduleStart, setPoolScheduleStart] = useState(() => toDatetimeLocalValue(new Date()))
  const [poolScheduleTechId, setPoolScheduleTechId] = useState("")
  const [poolScheduleSaving, setPoolScheduleSaving] = useState(false)
  const [poolScheduleError, setPoolScheduleError] = useState<string | null>(null)
  const [dragOverHour, setDragOverHour] = useState<number | null>(null)
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)

  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const orgQuery = orgId ? `&organization_id=${encodeURIComponent(orgId)}` : ""

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
    setLoading(true)
    fetch(`/api/owner/scheduler?month=${encodeURIComponent(monthKey)}${orgQuery}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { events?: SchedulerEvent[]; ownerUserId?: string } }) => {
        setEvents(Array.isArray(j.data?.events) ? j.data!.events! : [])
        if (j.data?.ownerUserId) setOwnerUserId(j.data.ownerUserId)
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [monthKey, orgQuery])

  useEffect(() => {
    load()
  }, [load])

  const loadPool = useCallback(() => {
    setPoolLoading(true)
    const poolUrl = orgId
      ? `/api/owner/jobs/pool?organization_id=${encodeURIComponent(orgId)}`
      : "/api/owner/jobs/pool"
    fetch(poolUrl, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("pool"))))
      .then((j: { data?: { jobs?: UnassignedPoolJob[] } }) => {
        setPoolJobs(Array.isArray(j.data?.jobs) ? j.data!.jobs! : [])
      })
      .catch(() => setPoolJobs([]))
      .finally(() => setPoolLoading(false))
  }, [orgId])

  const loadActivePipeline = useCallback(() => {
    setActivePipelineLoading(true)
    const day = dayKeyLocal(selectedDay)
    const orgQs = orgId ? `&organization_id=${encodeURIComponent(orgId)}` : ""
    fetch(`/api/owner/jobs/pool?scope=active&day=${day}${orgQs}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("pipeline"))))
      .then((j: { data?: { jobs?: ActivePipelineJob[] } }) => {
        setActivePipelineJobs(Array.isArray(j.data?.jobs) ? j.data!.jobs! : [])
      })
      .catch(() => setActivePipelineJobs([]))
      .finally(() => setActivePipelineLoading(false))
  }, [orgId, selectedDay])

  const loadTechLocations = useCallback(() => {
    fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("jobs"))))
      .then((j: { data?: { techLocations?: TechLiveLocation[] } }) => {
        setTechLocations(Array.isArray(j.data?.techLocations) ? j.data!.techLocations! : [])
      })
      .catch(() => setTechLocations([]))
  }, [])

  useEffect(() => {
    loadPool()
  }, [loadPool])

  useEffect(() => {
    if (viewMode === "map") {
      loadActivePipeline()
      loadTechLocations()
    }
  }, [viewMode, loadActivePipeline, loadTechLocations])

  const refreshSchedulerData = useCallback(() => {
    load()
    loadPool()
    if (viewMode === "map") {
      loadActivePipeline()
      loadTechLocations()
    }
  }, [load, loadPool, viewMode, loadActivePipeline, loadTechLocations])

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
      if (viewMode === "map") loadActivePipeline()
    }

    const onJobAssigned = (payload: { leadId?: string; techUserId?: string }) => {
      if (payload?.leadId) {
        setPoolJobs((prev) => prev.filter((j) => j.id !== payload.leadId))
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
  }, [ownerUserId, refreshSchedulerData, load, viewMode, loadTechLocations])

  useEffect(() => {
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    fetch(`/api/technicians${qs}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("techs"))))
      .then((j: { data?: FieldTechnician[] }) => {
        setTechnicians(Array.isArray(j.data) ? j.data : [])
      })
      .catch(() => setTechnicians([]))
  }, [orgId])

  useEffect(() => {
    const base = "/api/numbers/mine"
    const url = orgId ? `${base}?organization_id=${encodeURIComponent(orgId)}` : base
    fetch(url, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lines"))))
      .then((j: { numbers?: Array<{ industry_tag?: string | null }> }) => {
        const tags = (Array.isArray(j.numbers) ? j.numbers : [])
          .map((n) => n.industry_tag?.trim())
          .filter((t): t is string => Boolean(t))
        setLineIndustryTags(tags)
      })
      .catch(() => setLineIndustryTags([]))
  }, [orgId])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, SchedulerEvent[]>()
    for (const ev of events) {
      const key = dayKeyLocal(new Date(ev.scheduled_at))
      const list = map.get(key) ?? []
      list.push(ev)
      map.set(key, list)
    }
    for (const [, list] of map) list.sort(sortEventsByTime)
    return map
  }, [events])

  const daysWithEvents = useMemo(() => {
    const set = new Set<Date>()
    for (const key of eventsByDay.keys()) {
      const [y, m, d] = key.split("-").map(Number)
      set.add(new Date(y, m - 1, d))
    }
    return set
  }, [eventsByDay])

  const selectedKey = dayKeyLocal(selectedDay)
  const dayEvents = eventsByDay.get(selectedKey) ?? []
  const hourSlots = schedulerHourSlots()
  const gridHeightPx = hourSlots.length * SCHEDULER_HOUR_ROW_PX
  const selectedDayLabel = selectedDay.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  function openBookingAtHour(hour24: number) {
    setBookingStart(toDatetimeLocalValue(dateAtLocalHour(selectedDay, hour24)))
    setBookingOpen(true)
  }

  function openPoolScheduleAtHour(hour24: number, job: UnassignedPoolJob) {
    setPoolScheduleJob(job)
    setPoolScheduleStart(toDatetimeLocalValue(dateAtLocalHour(selectedDay, hour24)))
    setPoolScheduleTechId("")
    setPoolScheduleError(null)
    setPoolScheduleOpen(true)
  }

  function closePoolScheduleDialog() {
    if (poolScheduleSaving) return
    setPoolScheduleOpen(false)
    setPoolScheduleJob(null)
    setPoolScheduleError(null)
  }

  function openPoolJobDrawer(job: UnassignedPoolJob) {
    setHighlightId(job.id)
    setDrawerPoolJob(job)
    setDrawerScheduledEvent(null)
  }

  function openScheduledJobDrawer(ev: SchedulerEvent) {
    setHighlightId(ev.id)
    setDrawerScheduledEvent(ev)
    setDrawerPoolJob(null)
  }

  function focusPipelineJob(job: ActivePipelineJob) {
    setHighlightId(job.id)
    if (typeof job.latitude === "number" && typeof job.longitude === "number") {
      mapRef.current?.panTo(job.latitude, job.longitude, 15)
    }
    const scheduled = dayEvents.find((ev) => ev.id === job.id)
    if (scheduled) {
      openScheduledJobDrawer(scheduled)
      return
    }
    openPoolJobDrawer(job)
  }

  function closeJobDrawer() {
    setDrawerPoolJob(null)
    setDrawerScheduledEvent(null)
    setHighlightId(null)
  }

  const handlePhoneLookupResults = useCallback(
    (result: SchedulerPhoneLookupResult | null) => {
      if (!result || (result.pool.length === 0 && result.scheduled.length === 0)) {
        setHighlightId(null)
        closeJobDrawer()
        return
      }
      const poolMatch = result.pool[0]
      if (poolMatch) {
        setHighlightId(poolMatch.id)
        setDrawerPoolJob(poolMatch)
        setDrawerScheduledEvent(null)
        return
      }
      const scheduledMatch = result.scheduled[0]
      if (scheduledMatch) {
        setHighlightId(scheduledMatch.id)
        setDrawerScheduledEvent(scheduledMatch)
        setDrawerPoolJob(null)
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

  async function confirmPoolSchedule() {
    if (!poolScheduleJob || !poolScheduleTechId) return
    setPoolScheduleSaving(true)
    setPoolScheduleError(null)
    try {
      const res = await fetch(`/api/owner/jobs/pool/${poolScheduleJob.id}/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: new Date(poolScheduleStart).toISOString(),
          assigned_tech_id: poolScheduleTechId,
        }),
      })
      const json = (await res.json()) as { error?: string; data?: { event?: SchedulerEvent } }
      if (!res.ok) throw new Error(json.error ?? "Could not schedule job")
      const event = json.data?.event
      if (!event) throw new Error("No event returned")
      const techName =
        assignableTechs.find((t) => t.portal_user_id === poolScheduleTechId)?.name ??
        event.assigned_tech_name
      setPoolJobs((prev) => prev.filter((j) => j.id !== poolScheduleJob.id))
      handleAppointmentCreated({
        ...event,
        dispatch_status: "DISPATCHED",
        job_status: "assigned",
        assigned_tech_id: poolScheduleTechId,
        assigned_tech_name: techName ?? null,
      })
      setPoolScheduleOpen(false)
      setPoolScheduleJob(null)
      loadPool()
    } catch (e) {
      setPoolScheduleError(e instanceof Error ? e.message : "Could not schedule job")
    } finally {
      setPoolScheduleSaving(false)
    }
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

  const headerAction = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <PhoneLookupBar organizationId={orgId} onResults={handlePhoneLookupResults} className="order-first w-full sm:order-none sm:mr-1" />
      <div className="hidden rounded-md border border-border/70 p-0.5 sm:flex">
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
      </div>
      <Button type="button" size="sm" className="gap-1.5" onClick={openBookingDefault}>
        <Plus className="h-4 w-4" aria-hidden />
        Create appointment
      </Button>
    </div>
  )

  return (
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
            variant={viewMode === "grid" ? "default" : "ghost"}
            className="flex-1 gap-1 text-xs"
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            Grid
          </Button>
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
        </div>
      </div>

      {viewMode === "grid" ? (
        <JobPoolTray
          jobs={poolJobs}
          loading={poolLoading}
          highlightId={highlightId}
          onSelectJob={openPoolJobDrawer}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <WorkspacePanel className="p-3">
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
            <p className="mt-2 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Loading…
            </p>
          ) : (
            <p className="mt-2 text-center text-xs text-zinc-500">
              {events.length} scheduled this month
              {poolJobs.length > 0
                ? ` · ${poolJobs.length} in hopper`
                : ""}
            </p>
          )}
        </WorkspacePanel>

        <WorkspacePanel className="flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {viewMode === "grid" ? (
                  <>
                    {formatHourLabel(SCHEDULER_GRID_START_HOUR)} – {formatHourLabel(SCHEDULER_GRID_END_HOUR)} ·{" "}
                    {dayEvents.length} appointment{dayEvents.length === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    Dispatch map · {activePipelineJobs.length} active job
                    {activePipelineJobs.length === 1 ? "" : "s"} · {techLocations.length} tech
                    {techLocations.length === 1 ? "" : "s"} live
                  </>
                )}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 lg:hidden" onClick={openBookingDefault}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create
            </Button>
          </div>

          {viewMode === "grid" ? (
            <>
              <div className="max-h-[min(720px,70vh)] flex-1 overflow-y-auto">
                <div className="flex min-h-0">
                  <div className="w-16 shrink-0 border-r border-border/40 bg-muted/20">
                    {hourSlots.map((hour) => (
                      <div
                        key={hour}
                        className="flex items-start justify-end border-b border-border/30 pr-2 pt-1 text-[10px] font-medium text-zinc-500"
                        style={{ height: SCHEDULER_HOUR_ROW_PX }}
                      >
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>

                  <div className="relative min-w-0 flex-1" style={{ height: gridHeightPx }}>
                    {hourSlots.map((hour) => (
                      <button
                        key={hour}
                        type="button"
                        aria-label={`Book appointment at ${formatHourLabel(hour)}`}
                        className={cn(
                          "absolute left-0 right-0 border-b border-border/30 bg-transparent transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          dragOverHour === hour && "bg-primary/15 ring-2 ring-inset ring-primary/50"
                        )}
                        style={{
                          top: (hour - SCHEDULER_GRID_START_HOUR) * SCHEDULER_HOUR_ROW_PX,
                          height: SCHEDULER_HOUR_ROW_PX,
                        }}
                        onClick={() => openBookingAtHour(hour)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = "move"
                          setDragOverHour(hour)
                        }}
                        onDragLeave={() => setDragOverHour((h) => (h === hour ? null : h))}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOverHour(null)
                          const jobId = e.dataTransfer.getData(HOPPER_DRAG_MIME)
                          if (!jobId) return
                          const job = poolJobs.find((j) => j.id === jobId)
                          if (!job) return
                          openPoolScheduleAtHour(hour, job)
                        }}
                      />
                    ))}

                    {dayEvents.map((ev) => (
                      <AppointmentBlock
                        key={ev.id}
                        ev={ev}
                        highlighted={highlightId === ev.id}
                        onSelect={() => openScheduledJobDrawer(ev)}
                      />
                    ))}

                    {dayEvents.length === 0 && !loading ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                        <p className="max-w-xs text-center text-sm text-zinc-500">
                          No appointments yet — drag from the pool above, click an hour row, or use Create appointment.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {dayEvents.length > 0 ? (
                <div className="border-t border-border/60 px-5 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Day summary</p>
                  <ul className="flex flex-wrap gap-2">
                    {dayEvents.map((ev) => (
                      <li
                        key={`sum-${ev.id}`}
                        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2 py-1 text-xs text-zinc-400"
                      >
                        <Clock className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{formatBlockTime(ev.scheduled_at)}</span>
                        <span className="truncate font-medium text-zinc-300">
                          {ev.customer_name || formatPhone(ev.customer_phone)}
                        </span>
                        {formatVehicle(ev) ? (
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <Car className="h-3 w-3" aria-hidden />
                            {formatVehicle(ev)}
                          </span>
                        ) : null}
                        {ev.customer_phone ? (
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <Phone className="h-3 w-3" aria-hidden />
                            {formatPhone(ev.customer_phone)}
                          </span>
                        ) : null}
                        {ev.assigned_tech_name ? (
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <User className="h-3 w-3" aria-hidden />
                            {ev.assigned_tech_name}
                          </span>
                        ) : null}
                        {ev.location ? (
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <MapPin className="h-3 w-3" aria-hidden />
                            {ev.location}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-[min(720px,70vh)] flex-1 flex-col lg:flex-row">
              <div className="max-h-[min(360px,45vh)] w-full shrink-0 overflow-y-auto border-b border-border/60 bg-card/40 lg:max-h-none lg:w-[40%] lg:border-b-0 lg:border-r">
                <ActivePipelinePanel
                  jobs={activePipelineJobs}
                  loading={activePipelineLoading}
                  highlightId={highlightId}
                  onFocusJob={focusPipelineJob}
                />
              </div>
              <div className="min-h-[320px] min-w-0 flex-1 lg:min-h-0">
                <SchedulerRouteMap
                  ref={mapRef}
                  events={dayEvents}
                  pipelineJobs={activePipelineJobs}
                  poolJobs={poolJobs}
                  techLocations={techLocations}
                  selectedDayLabel={selectedDayLabel}
                  highlightId={highlightId}
                  hideHoverCard={Boolean(drawerPoolJob || drawerScheduledEvent)}
                  embedded
                  onSelectEvent={openScheduledJobDrawer}
                  onSelectPoolJob={(job) => focusPipelineJob(job as ActivePipelineJob)}
                />
              </div>
            </div>
          )}
        </WorkspacePanel>
      </div>

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

      <PoolScheduleDialog
        open={poolScheduleOpen}
        job={poolScheduleJob}
        scheduledAtLocal={poolScheduleStart}
        technicians={technicians}
        techId={poolScheduleTechId}
        saving={poolScheduleSaving}
        error={poolScheduleError}
        onTechChange={setPoolScheduleTechId}
        onScheduledChange={setPoolScheduleStart}
        onClose={closePoolScheduleDialog}
        onConfirm={() => void confirmPoolSchedule()}
      />

      <JobDetailDrawer
        open={Boolean(drawerPoolJob || drawerScheduledEvent)}
        poolJob={drawerPoolJob}
        scheduledEvent={drawerScheduledEvent}
        technicians={technicians}
        onClose={closeJobDrawer}
        onSaved={(event) => {
          setDrawerScheduledEvent(event)
          setDrawerPoolJob(null)
          setEvents((prev) => {
            const idx = prev.findIndex((ev) => ev.id === event.id)
            if (idx === -1) return prev
            const next = [...prev]
            next[idx] = event
            return next
          })
          if (typeof event.latitude === "number" && typeof event.longitude === "number") {
            mapRef.current?.panTo(event.latitude, event.longitude, 15)
          }
          refreshSchedulerData()
        }}
      />
    </WorkspacePage>
  )
}
