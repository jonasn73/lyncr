"use client"

// Unified Call Flow configure drawer — tabbed Routing / Greetings / Security + one Save.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Bot,
  ChevronDown,
  Clock,
  Forward,
  Loader2,
  Phone,
  Radio,
  Users,
} from "lucide-react"
import type { ComponentType } from "react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DrawerScrollBody,
  DrawerStepHeader,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  ACTIVE_ROUTING_MODE_OPTIONS,
  LYNCR_ROUTING_MODE_CHANGED,
  normalizeActiveRoutingMode,
  type ActiveRoutingMode,
} from "@/lib/active-routing-mode"
import {
  DEFAULT_IVR_VOICE_ENGINE_MODEL,
  IVR_VOICE_PERSONA_OPTIONS,
  toDatetimeLocalValue,
} from "@/lib/ivr-automation-settings"
import { TELNYX_MENU_BUSY_PROMPT } from "@/lib/telnyx-menu"
import { formatPhoneDisplay, snapDashboardRingTimeoutSec } from "@/lib/dashboard-routing-utils"
import type { FallbackOption } from "@/lib/dashboard-routing-utils"
import { fallbackOptions } from "@/components/dashboard-routing-fallback-options"
import { HoldMusicPresetPicker } from "@/components/dashboard/hold-music-preset-picker"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { WeeklyHoursDay } from "@/lib/account-weekly-hours"
import { useAccountPresence } from "@/components/dashboard/account-presence-context"

/** Icon + tone per "who answers first" mode — matches the tone-tinted tile convention used
 * elsewhere (fallbackOptions, settings-menu-row) so routing and fallback read as one system. */
const ROUTING_MODE_VISUALS: Record<
  ActiveRoutingMode,
  { icon: ComponentType<{ className?: string }>; color: string; bgColor: string }
> = {
  your_phone: { icon: Phone, color: "text-primary", bgColor: "bg-primary/10" },
  team_receptionist: { icon: Users, color: "text-chart-4", bgColor: "bg-chart-4/10" },
  smart_ivr: { icon: Bot, color: "text-operator", bgColor: "bg-operator/10" },
  lyncr_pool: { icon: Radio, color: "text-chart-2", bgColor: "bg-chart-2/10" },
  custom_routing: { icon: Forward, color: "text-muted-foreground", bgColor: "bg-muted/40" },
}

const fieldClass =
  "w-full rounded-lg border border-border bg-card/50 px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

const RING_OPTIONS = [15, 20, 30, 45, 60] as const

const TABS = [
  { id: "routing" as const, label: "Call Routing" },
  { id: "greetings" as const, label: "Greetings & Voice AI" },
  { id: "hours" as const, label: "Hours" },
  { id: "security" as const, label: "Advanced Rules" },
]

type ConfigureTab = (typeof TABS)[number]["id"]

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

const TIMEZONE_OPTIONS = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona (no DST)" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
] as const

function defaultWeeklyHoursDays(): WeeklyHoursDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: "09:00",
    endTime: "17:00",
  }))
}

type ConfigureDraft = {
  mode: ActiveRoutingMode
  customPhone: string
  /** Team receptionist who answers first (team_receptionist mode). */
  selectedReceptionistId: string | null
  ringTimeout: number
  voice: string
  /** Unified Busy greeting — written to both on-job and closed columns. */
  busy: string
  holidayStart: string
  holidayEnd: string
  holidayText: string
  bypass: string
  fallbackType: FallbackOption
  /** Optional public HTTPS MP3/WAV for Busy hold music. */
  holdMusicUrl: string
  /** Blank = product/env default. Seconds before SMS + hangup. */
  holdMaxWaitSecs: string
  /** Blank = product/env default. Seconds of music between re-prompts. */
  holdRepromptSecs: string
  /** Auto-flip Presence from the weekly schedule below (cron every 5 min). */
  hoursScheduleEnabled: boolean
  hoursTimezone: string
  weeklyHours: WeeklyHoursDay[]
  /** After-hours on-call tech (166) — rings this tech's cell instead of the receptionist/hold menu while Closed. */
  oncallTechnicianId: string | null
}

const DEFAULT_DRAFT: ConfigureDraft = {
  mode: "your_phone",
  customPhone: "",
  selectedReceptionistId: null,
  ringTimeout: 30,
  voice: DEFAULT_IVR_VOICE_ENGINE_MODEL,
  busy: TELNYX_MENU_BUSY_PROMPT,
  holidayStart: "",
  holidayEnd: "",
  holidayText: "",
  bypass: "",
  fallbackType: "owner",
  holdMusicUrl: "",
  holdMaxWaitSecs: "",
  holdRepromptSecs: "",
  hoursScheduleEnabled: false,
  hoursTimezone: "America/New_York",
  weeklyHours: defaultWeeklyHoursDays(),
  oncallTechnicianId: null,
}

function draftSnapshot(d: ConfigureDraft): string {
  return JSON.stringify(d)
}

function phoneDigits10(raw: string | null | undefined): string {
  return String(raw || "")
    .replace(/^\+1/, "")
    .replace(/\D/g, "")
    .slice(-10)
}

type CallFlowStep = {
  icon: ComponentType<{ className?: string }>
  label: string
  color: string
  bgColor: string
}

/** `text-primary` → `border-primary/25` — reuses the same tone tokens as the fill/icon color
 * instead of a separate borderColor field, matching the icon-tile convention used elsewhere
 * (e.g. who-rings-console's `border-primary/25 bg-primary/10`). */
function toneBorderClass(colorClass: string): string {
  return `${colorClass.replace("text-", "border-")}/25`
}

/**
 * Plain-English call chain for the current draft — this is the single most direct answer to
 * "what will my phones actually do", computed live from the same fields that get saved, so it
 * can never drift from reality the way a hand-written status label can.
 */
function buildCallFlowSteps(params: {
  mode: ActiveRoutingMode
  ringTimeout: number
  fallbackType: FallbackOption
  ownerPhoneDisplay: string
  lineLabel: string | null
  teamMemberName: string | null
  customPhoneDigits: string
}): CallFlowStep[] {
  const steps: CallFlowStep[] = [
    {
      icon: Phone,
      label: params.lineLabel ? `Call to ${params.lineLabel}` : "Customer calls",
      color: "text-muted-foreground",
      bgColor: "bg-muted/40",
    },
  ]

  const modeVisual = ROUTING_MODE_VISUALS[params.mode]
  const modeLabel =
    params.mode === "your_phone"
      ? `Rings ${params.ownerPhoneDisplay || "your phone"}`
      : params.mode === "team_receptionist"
        ? `Rings ${params.teamMemberName || "your team"}`
        : params.mode === "smart_ivr"
          ? "Plays keypad menu"
          : params.mode === "lyncr_pool"
            ? "Rings Lyncr Pool"
            : params.customPhoneDigits
              ? `Forwards to ${formatPhoneDisplay(params.customPhoneDigits)}`
              : "Forwards to a number"
  steps.push({ icon: modeVisual.icon, label: modeLabel, color: modeVisual.color, bgColor: modeVisual.bgColor })

  // Smart IVR / Lyncr Pool / Custom Routing are self-contained — their own description already
  // says what happens on a miss. Ring timeout + Advanced Rules fallback only apply when a
  // specific cell phone (yours or a teammate's) is what's actually ringing.
  if (params.mode === "your_phone" || params.mode === "team_receptionist") {
    steps.push({
      icon: Clock,
      label: `No answer in ${params.ringTimeout}s`,
      color: "text-muted-foreground",
      bgColor: "bg-muted/40",
    })
    const fb = fallbackOptions.find((o) => o.id === params.fallbackType)
    if (fb) {
      steps.push({ icon: fb.icon, label: fb.label, color: fb.color, bgColor: fb.bgColor })
    }
  }

  return steps
}

export type DashboardCallFlowConfigureDrawerProps = {
  ownerPhoneDisplay: string
  routingBusinessNumber: string | null
  routingLineDetailLoading?: boolean
  /** Which tab to show when the drawer opens. */
  initialTab?: ConfigureTab
  setRoutingStrategy: (s: "private_only" | "lyncr_only" | "hybrid_fallback") => void
  setFallback: (f: FallbackOption) => void
  setRingTimeoutSec: (n: number) => void
  onClose: () => void
  onRegisterDiscard?: (discard: () => void) => void
}

export function DashboardCallFlowConfigureDrawer({
  ownerPhoneDisplay,
  routingBusinessNumber,
  routingLineDetailLoading,
  initialTab = "routing",
  setRoutingStrategy,
  setFallback,
  setRingTimeoutSec,
  onClose,
  onRegisterDiscard,
}: DashboardCallFlowConfigureDrawerProps) {
  const { toast } = useToast()
  const { refresh: refreshPresence } = useAccountPresence()
  const [currentTab, setCurrentTab] = useState<ConfigureTab>(initialTab)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [holidayOpen, setHolidayOpen] = useState(false)
  /** Lyncr Pool / Custom Routing — collapsed so the first screen stays simple. */
  const [moreRoutingOpen, setMoreRoutingOpen] = useState(false)
  const [draft, setDraft] = useState<ConfigureDraft>(DEFAULT_DRAFT)
  const baselineRef = useRef(draftSnapshot(DEFAULT_DRAFT))
  /** Product defaults from API (for placeholders). */
  const [holdDefaults, setHoldDefaults] = useState({ maxWaitSecs: 600, repromptSecs: 45 })
  // Team list for the receptionist picker (id + name + availability).
  const [teamMembers, setTeamMembers] = useState<
    { id: string; name: string; is_active: boolean }[]
  >([])
  // Field tech roster for the after-hours on-call picker (166).
  const [techMembers, setTechMembers] = useState<
    { id: string; name: string; is_active: boolean }[]
  >([])

  // Keep tab in sync when opener switches (Who Answers vs Greetings card).
  useEffect(() => {
    setCurrentTab(initialTab)
  }, [initialTab])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = routingBusinessNumber
        ? `?number=${encodeURIComponent(routingBusinessNumber)}`
        : ""
      // Load configure payload + Team roster + tech roster in parallel.
      const [res, teamRes, techRes] = await Promise.all([
        fetch(`/api/routing/configure${qs}`, { credentials: "include" }),
        fetch("/api/receptionists", { credentials: "include" }),
        fetch("/api/technicians", { credentials: "include" }),
      ])
      const json = (await res.json()) as {
        data?: {
          activeRoutingMode?: string
          customRoutingPhone?: string | null
          ringTimeoutSeconds?: number
          selectedReceptionistId?: string | null
          fallbackType?: string
          onJobGreetingText?: string
          closedGreetingText?: string
          ivrBypassCode?: string | null
          ivrVoiceEngineModel?: string
          holidayOverrideStart?: string | null
          holidayOverrideEnd?: string | null
          holidayGreetingText?: string | null
          holdMusicUrl?: string | null
          hold_music_url?: string | null
          holdMaxWaitSecs?: number | null
          hold_max_wait_secs?: number | null
          holdRepromptSecs?: number | null
          hold_reprompt_secs?: number | null
          holdDefaults?: { maxWaitSecs?: number; repromptSecs?: number }
          hoursScheduleEnabled?: boolean
          hoursTimezone?: string
          weeklyHours?: WeeklyHoursDay[]
          oncallTechnicianId?: string | null
        }
      }
      const teamJson = (await teamRes.json()) as {
        data?: { id: string; name: string; is_active?: boolean }[]
      }
      const members = Array.isArray(teamJson.data)
        ? teamJson.data.map((r) => ({
            id: r.id,
            name: r.name,
            is_active: r.is_active !== false,
          }))
        : []
      setTeamMembers(members)

      const techJson = (await techRes.json()) as {
        data?: { id: string; name: string; is_active?: boolean }[]
      }
      const techs = Array.isArray(techJson.data)
        ? techJson.data.map((t) => ({
            id: t.id,
            name: t.name,
            is_active: t.is_active !== false,
          }))
        : []
      setTechMembers(techs)

      const d = json.data || {}
      if (d.holdDefaults?.maxWaitSecs || d.holdDefaults?.repromptSecs) {
        setHoldDefaults({
          maxWaitSecs: d.holdDefaults.maxWaitSecs || 600,
          repromptSecs: d.holdDefaults.repromptSecs || 45,
        })
      }
      const nextRing = Number(d.ringTimeoutSeconds ?? 30)
      const ring = RING_OPTIONS.includes(nextRing as (typeof RING_OPTIONS)[number]) ? nextRing : 30
      const fb = String(d.fallbackType || "owner").toLowerCase()
      // Accept hold (and legacy hold_queue alias) from API / DB.
      const fallbackType: FallbackOption =
        fb === "ai" || fb === "voicemail" || fb === "hold" || fb === "hold_queue"
          ? fb === "hold_queue"
            ? "hold"
            : (fb as FallbackOption)
          : "owner"
      const savedRecId =
        typeof d.selectedReceptionistId === "string" && d.selectedReceptionistId.trim()
          ? d.selectedReceptionistId.trim()
          : null
      const savedOncallTechId =
        typeof d.oncallTechnicianId === "string" && d.oncallTechnicianId.trim()
          ? d.oncallTechnicianId.trim()
          : null
      const maxWait =
        d.holdMaxWaitSecs ?? d.hold_max_wait_secs
      const reprompt =
        d.holdRepromptSecs ?? d.hold_reprompt_secs
      const next: ConfigureDraft = {
        mode: normalizeActiveRoutingMode(d.activeRoutingMode),
        customPhone: phoneDigits10(d.customRoutingPhone),
        selectedReceptionistId:
          savedRecId && members.some((m) => m.id === savedRecId)
            ? savedRecId
            : members[0]?.id || null,
        ringTimeout: ring,
        voice: d.ivrVoiceEngineModel || DEFAULT_IVR_VOICE_ENGINE_MODEL,
        busy:
          (d.onJobGreetingText || d.closedGreetingText || TELNYX_MENU_BUSY_PROMPT).trim() ||
          TELNYX_MENU_BUSY_PROMPT,
        holidayStart: toDatetimeLocalValue(d.holidayOverrideStart || null),
        holidayEnd: toDatetimeLocalValue(d.holidayOverrideEnd || null),
        holidayText: d.holidayGreetingText || "",
        bypass: String(d.ivrBypassCode || ""),
        fallbackType,
        holdMusicUrl: String(d.holdMusicUrl ?? d.hold_music_url ?? "").trim(),
        holdMaxWaitSecs: maxWait != null && Number.isFinite(Number(maxWait)) ? String(maxWait) : "",
        holdRepromptSecs:
          reprompt != null && Number.isFinite(Number(reprompt)) ? String(reprompt) : "",
        hoursScheduleEnabled: d.hoursScheduleEnabled === true,
        hoursTimezone: d.hoursTimezone || "America/New_York",
        weeklyHours:
          Array.isArray(d.weeklyHours) && d.weeklyHours.length === 7
            ? d.weeklyHours
            : defaultWeeklyHoursDays(),
        // Unlike the receptionist pick, "off" (null) is a valid state here — don't
        // force-default to the first tech if the saved one is gone/inactive.
        oncallTechnicianId:
          savedOncallTechId && techs.some((t) => t.id === savedOncallTechId && t.is_active)
            ? savedOncallTechId
            : null,
      }
      setDraft(next)
      baselineRef.current = draftSnapshot(next)
      if (next.holidayStart || next.holidayEnd || next.holidayText) setHolidayOpen(true)
      if (next.mode === "lyncr_pool" || next.mode === "custom_routing") setMoreRoutingOpen(true)
    } catch {
      setDraft(DEFAULT_DRAFT)
      baselineRef.current = draftSnapshot(DEFAULT_DRAFT)
    } finally {
      setLoading(false)
    }
  }, [routingBusinessNumber])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    onRegisterDiscard?.(() => {
      void load()
    })
  }, [onRegisterDiscard, load])

  const dirty = useMemo(() => draftSnapshot(draft) !== baselineRef.current, [draft])

  const lineLabel = routingBusinessNumber
    ? `Line ${formatPhoneDisplay(routingBusinessNumber)}`
    : null

  const teamMemberName =
    draft.mode === "team_receptionist"
      ? teamMembers.find((m) => m.id === draft.selectedReceptionistId)?.name || null
      : null

  const flowSteps = useMemo(
    () =>
      buildCallFlowSteps({
        mode: draft.mode,
        ringTimeout: draft.ringTimeout,
        fallbackType: draft.fallbackType,
        ownerPhoneDisplay,
        lineLabel,
        teamMemberName,
        customPhoneDigits: draft.customPhone,
      }),
    [
      draft.mode,
      draft.ringTimeout,
      draft.fallbackType,
      draft.customPhone,
      ownerPhoneDisplay,
      lineLabel,
      teamMemberName,
    ]
  )

  const sheetTitle =
    currentTab === "greetings"
      ? "Greetings"
      : currentTab === "hours"
        ? "Hours"
        : currentTab === "security"
          ? "Advanced Rules"
          : "Call Routing"

  const sheetSubtitle =
    currentTab === "greetings"
      ? `Busy greeting, hold music, and voice for ${ownerPhoneDisplay || "this line"}.`
      : currentTab === "hours"
        ? "Set your weekly hours so Presence flips Available / Closed on its own."
        : currentTab === "security"
          ? "Technician bypass digit — the missed-call fallback moved to Call Routing."
          : `Who rings first, and where a miss goes next, for ${ownerPhoneDisplay || "this line"}.`

  const primaryRoutingModes = ACTIVE_ROUTING_MODE_OPTIONS.filter(
    (o) => o.value === "your_phone" || o.value === "team_receptionist" || o.value === "smart_ivr"
  )
  const advancedRoutingModes = ACTIVE_ROUTING_MODE_OPTIONS.filter(
    (o) => o.value === "lyncr_pool" || o.value === "custom_routing"
  )

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/configure", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_number: routingBusinessNumber,
          active_routing_mode: draft.mode,
          custom_routing_phone: draft.mode === "custom_routing" ? draft.customPhone : null,
          selected_receptionist_id:
            draft.mode === "team_receptionist" ? draft.selectedReceptionistId : null,
          ring_timeout_seconds:
            draft.mode === "your_phone" || draft.mode === "team_receptionist"
              ? draft.ringTimeout
              : undefined,
          fallback_type: draft.fallbackType,
          onJobGreetingText: draft.busy,
          closedGreetingText: draft.busy,
          ivrBypassCode: draft.bypass.trim() || null,
          ivrVoiceEngineModel: draft.voice,
          holidayOverrideStart: draft.holidayStart || null,
          holidayOverrideEnd: draft.holidayEnd || null,
          holidayGreetingText: draft.holidayText.trim() || null,
          holdMusicUrl: draft.holdMusicUrl.trim() || null,
          hold_music_url: draft.holdMusicUrl.trim() || null,
          holdMaxWaitSecs: draft.holdMaxWaitSecs.trim()
            ? Number(draft.holdMaxWaitSecs)
            : null,
          holdRepromptSecs: draft.holdRepromptSecs.trim()
            ? Number(draft.holdRepromptSecs)
            : null,
          hoursScheduleEnabled: draft.hoursScheduleEnabled,
          hoursTimezone: draft.hoursTimezone,
          weeklyHours: draft.weeklyHours,
          oncall_technician_id: draft.oncallTechnicianId,
        }),
      })
      const json = (await res.json()) as { error?: string; migration?: string }
      if (!res.ok) {
        toast({
          title: "Could not save",
          description: json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }

      if (draft.mode === "lyncr_pool") setRoutingStrategy("lyncr_only")
      else setRoutingStrategy("private_only")
      setFallback(draft.fallbackType)
      if (draft.mode === "your_phone" || draft.mode === "team_receptionist") {
        setRingTimeoutSec(snapDashboardRingTimeoutSec(draft.ringTimeout))
      }

      // Hours may have just applied a new schedule (and cleared a manual lock) —
      // refresh the Presence bar so it reflects that immediately instead of on
      // the next poll tick.
      if (draft.hoursScheduleEnabled) void refreshPresence()

      baselineRef.current = draftSnapshot(draft)
      window.dispatchEvent(
        new CustomEvent(LYNCR_ROUTING_MODE_CHANGED, {
          detail: {
            mode: draft.mode,
            businessNumber: routingBusinessNumber,
            selectedReceptionistId:
              draft.mode === "team_receptionist" ? draft.selectedReceptionistId : null,
          },
        })
      )
      toast({
        title: "Call flow saved",
        description: "Routing, greetings, and advanced rules updated.",
      })
      onClose()
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        submitFormEvent(e)
        if (!saving && dirty) void handleSave()
      }}
    >
      <DrawerStepHeader
        title={sheetTitle}
        subtitle={sheetSubtitle}
        lineLabel={lineLabel}
      />

      {/* Segmented tab bar */}
      <div className="shrink-0 border-b border-border px-4 pt-1 sm:px-6">
        <div
          role="tablist"
          aria-label="Call flow settings"
          className="flex gap-1 rounded-xl border border-border bg-background/80 p-1"
        >
          {TABS.map((tab) => {
            const active = currentTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCurrentTab(tab.id)}
                className={cn(
                  "min-h-9 flex-1 rounded-lg px-2 py-2 text-2xs font-semibold transition-colors sm:text-xs",
                  active
                    ? "bg-muted text-foreground shadow-resting"
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {!loading && !routingLineDetailLoading ? (
        <div className="shrink-0 border-b border-border/60 bg-muted/10 px-4 py-3 sm:px-6">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            What happens on a call
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {flowSteps.map((step, i) => (
              <Fragment key={i}>
                {i > 0 ? (
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-2xs font-semibold",
                    step.bgColor,
                    step.color,
                    toneBorderClass(step.color)
                  )}
                >
                  <step.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {step.label}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}

      <DrawerScrollBody>
        {loading || routingLineDetailLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading configuration…
          </div>
        ) : (
          <>
            {currentTab === "routing" ? (
              <div className="space-y-6">
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Who answers first
                  </legend>
                  <div role="radiogroup" aria-label="Active routing mode" className="space-y-2">
                    {primaryRoutingModes.map((opt) => {
                      const active = draft.mode === opt.value
                      const visual = ROUTING_MODE_VISUALS[opt.value]
                      return (
                        <div key={opt.value} className="space-y-2">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setDraft((d) => ({ ...d, mode: opt.value }))}
                            className={cn(
                              "flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors touch-manipulation",
                              active
                                ? "border-success/40 bg-success/10"
                                : "border-border bg-background/40 hover:border-border"
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                                toneBorderClass(visual.color),
                                visual.bgColor
                              )}
                            >
                              <visual.icon className={cn("h-4 w-4", visual.color)} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground">
                                {opt.label}
                              </span>
                              <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">
                                {opt.description}
                              </span>
                            </span>
                            <span
                              aria-hidden
                              className={cn(
                                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                active
                                  ? "border-success bg-success/20"
                                  : "border-border bg-transparent"
                              )}
                            >
                              {active ? (
                                <span className="h-2 w-2 rounded-full bg-success" />
                              ) : null}
                            </span>
                          </button>

                          {opt.value === "team_receptionist" && active ? (
                            <section className="ml-1 space-y-3 rounded-xl border border-border bg-card/40 p-4">
                              <label
                                htmlFor="configure-team-receptionist"
                                className="text-xs font-semibold text-foreground"
                              >
                                Who on your Team answers first
                              </label>
                              {teamMembers.length === 0 ? (
                                <p className="text-2xs text-warning/90">
                                  Add a receptionist on the Team page first, then come back here.
                                </p>
                              ) : (
                                <Select
                                  value={draft.selectedReceptionistId || undefined}
                                  onValueChange={(v) =>
                                    setDraft((d) => ({ ...d, selectedReceptionistId: v || null }))
                                  }
                                >
                                  <SelectTrigger
                                    id="configure-team-receptionist"
                                    className={cn(fieldClass, "min-h-11 w-full")}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {teamMembers.map((m) => (
                                      <SelectItem key={m.id} value={m.id}>
                                        {m.name}
                                        {m.is_active ? "" : " (Unavailable)"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <p className="text-2xs text-muted-foreground">
                                Available → rings them first. Unavailable → your phone if Available,
                                otherwise the busy voice menu (press 1 for booking form).
                              </p>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Ring delay before next step
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {RING_OPTIONS.map((sec) => (
                                  <button
                                    key={sec}
                                    type="button"
                                    onClick={() => setDraft((d) => ({ ...d, ringTimeout: sec }))}
                                    className={cn(
                                      "min-h-10 rounded-lg border px-3 text-sm font-semibold transition-colors",
                                      draft.ringTimeout === sec
                                        ? "border-primary bg-primary/15 text-primary"
                                        : "border-border text-foreground hover:border-border"
                                    )}
                                  >
                                    {sec}s
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {opt.value === "your_phone" && active ? (
                            <section className="ml-1 space-y-3 rounded-xl border border-border bg-card/40 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Ring delay before fallback
                              </p>
                              <p className="text-2xs text-muted-foreground">
                                How long to ring your cell before emergency / missed handling.
                                Tip: with Hold queue, prefer 15–20s so carrier voicemail does not
                                pick up first (we also detect machines automatically).
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {RING_OPTIONS.map((sec) => (
                                  <button
                                    key={sec}
                                    type="button"
                                    onClick={() => setDraft((d) => ({ ...d, ringTimeout: sec }))}
                                    className={cn(
                                      "min-h-10 rounded-lg border px-3 text-sm font-semibold transition-colors",
                                      draft.ringTimeout === sec
                                        ? "border-primary bg-primary/15 text-primary"
                                        : "border-border text-foreground hover:border-border"
                                    )}
                                  >
                                    {sec}s
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                        </div>
                      )
                    })}

                    <div className="overflow-hidden rounded-xl border border-border bg-background/30">
                      <button
                        type="button"
                        onClick={() => setMoreRoutingOpen((o) => !o)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-3 text-left"
                        aria-expanded={moreRoutingOpen}
                      >
                        <span className="text-xs font-semibold text-muted-foreground">
                          More options · Lyncr Pool / Custom
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            moreRoutingOpen && "rotate-180"
                          )}
                          aria-hidden
                        />
                      </button>
                      {moreRoutingOpen ? (
                        <div className="space-y-2 border-t border-border px-2 pb-3 pt-2">
                          {advancedRoutingModes.map((opt) => {
                            const active = draft.mode === opt.value
                            const visual = ROUTING_MODE_VISUALS[opt.value]
                            return (
                              <div key={opt.value} className="space-y-2">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  onClick={() => setDraft((d) => ({ ...d, mode: opt.value }))}
                                  className={cn(
                                    "flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors touch-manipulation",
                                    active
                                      ? "border-success/40 bg-success/10"
                                      : "border-border bg-background/40 hover:border-border"
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                                      toneBorderClass(visual.color),
                                      visual.bgColor
                                    )}
                                  >
                                    <visual.icon className={cn("h-4 w-4", visual.color)} />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-foreground">
                                      {opt.label}
                                    </span>
                                    <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">
                                      {opt.description}
                                    </span>
                                  </span>
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                      active
                                        ? "border-success bg-success/20"
                                        : "border-border bg-transparent"
                                    )}
                                  >
                                    {active ? (
                                      <span className="h-2 w-2 rounded-full bg-success" />
                                    ) : null}
                                  </span>
                                </button>

                                {opt.value === "custom_routing" && active ? (
                                  <section className="ml-1 space-y-2 rounded-xl border border-border bg-card/40 p-4">
                                    <label
                                      htmlFor="configure-custom-phone"
                                      className="text-xs font-semibold text-foreground"
                                    >
                                      Target 10-digit phone number
                                    </label>
                                    <input
                                      id="configure-custom-phone"
                                      type="tel"
                                      inputMode="numeric"
                                      placeholder="5025551234"
                                      value={draft.customPhone}
                                      onChange={(e) =>
                                        setDraft((d) => ({
                                          ...d,
                                          customPhone: e.target.value.replace(/\D/g, "").slice(0, 10),
                                        }))
                                      }
                                      className={cn(fieldClass, "h-11")}
                                    />
                                    <p className="text-2xs text-muted-foreground">
                                      Every inbound call to this business line forwards to this number.
                                    </p>
                                  </section>
                                ) : null}

                                {opt.value === "lyncr_pool" && active ? (
                                  <p className="ml-1 rounded-xl border border-operator/20 bg-operator/5 px-3 py-3 text-2xs text-operator/90">
                                    Lyncr Pool is active — certified shared agents answer in-browser.
                                  </p>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </fieldset>

                {draft.mode === "your_phone" || draft.mode === "team_receptionist" ? (
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      If nobody answers
                    </legend>
                    <p className="text-2xs text-muted-foreground">
                      When the ring above times out, where should the caller go next?
                    </p>
                    <div role="radiogroup" aria-label="Missed-call fallback" className="space-y-2">
                      {fallbackOptions.map((opt) => {
                        const active = draft.fallbackType === opt.id
                        const Icon = opt.icon
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setDraft((d) => ({ ...d, fallbackType: opt.id }))}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors touch-manipulation",
                              active
                                ? "border-primary/50 bg-primary/10"
                                : "border-border bg-background/40 hover:border-border"
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                                toneBorderClass(opt.color),
                                opt.bgColor
                              )}
                            >
                              <Icon className={cn("h-4 w-4", opt.color)} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground">
                                {opt.label}
                              </span>
                              <span className="mt-0.5 block text-2xs text-muted-foreground">
                                {opt.description}
                              </span>
                            </span>
                            <span
                              aria-hidden
                              className={cn(
                                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                active
                                  ? "border-primary bg-primary/20"
                                  : "border-border bg-transparent"
                              )}
                            >
                              {active ? (
                                <span className="h-2 w-2 rounded-full bg-primary" />
                              ) : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {draft.fallbackType === "hold" ? (
                      <p className="rounded-xl border border-border bg-card/40 px-3 py-3 text-2xs leading-relaxed text-muted-foreground">
                        We hang up if your cell&apos;s carrier voicemail answers, then start hold
                        music so you can Answer from Lines. Prefer a 20s ring delay above (25s max
                        with Hold — longer often hits personal voicemail first). Music and max-wait
                        time live under Greetings.
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            {currentTab === "greetings" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="configure-voice-persona" className="text-xs font-semibold text-foreground">
                    AI Voice Persona
                  </label>
                  <Select value={draft.voice} onValueChange={(v) => setDraft((d) => ({ ...d, voice: v }))}>
                    <SelectTrigger id="configure-voice-persona" className={cn(fieldClass, "min-h-11 w-full")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IVR_VOICE_PERSONA_OPTIONS.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs text-muted-foreground">
                    {IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === draft.voice)?.description ||
                      "Tone callers hear on greetings and hold prompts."}
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
                  <label htmlFor="configure-busy" className="text-xs font-semibold text-foreground">
                    Busy greeting
                  </label>
                  <p className="hidden text-2xs text-muted-foreground md:block">
                    Played when Presence is Busy — press 1 texts a booking link; stay on the line
                    enters the hold queue (music + Lines Answer).
                  </p>
                  <textarea
                    id="configure-busy"
                    rows={5}
                    value={draft.busy}
                    onChange={(e) => setDraft((d) => ({ ...d, busy: e.target.value }))}
                    className={cn(fieldClass, "min-h-[7.5rem] resize-y")}
                  />
                </div>

                <HoldMusicPresetPicker
                  idPrefix="configure-hold-music"
                  value={draft.holdMusicUrl}
                  onChange={(next) => setDraft((d) => ({ ...d, holdMusicUrl: next }))}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="configure-hold-reprompt" className="text-xs font-semibold text-foreground">
                      Re-prompt every (sec)
                    </label>
                    <input
                      id="configure-hold-reprompt"
                      type="number"
                      inputMode="numeric"
                      min={20}
                      max={90}
                      value={draft.holdRepromptSecs}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          holdRepromptSecs: e.target.value.replace(/[^\d]/g, ""),
                        }))
                      }
                      className={cn(fieldClass, "min-h-11")}
                      placeholder={String(holdDefaults.repromptSecs)}
                    />
                    <p className="hidden text-2xs text-muted-foreground md:block">
                      Music length before we re-speak Busy (20–90). Blank = {holdDefaults.repromptSecs}s.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="configure-hold-maxwait" className="text-xs font-semibold text-foreground">
                      Max wait (sec)
                    </label>
                    <input
                      id="configure-hold-maxwait"
                      type="number"
                      inputMode="numeric"
                      min={120}
                      max={900}
                      value={draft.holdMaxWaitSecs}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          holdMaxWaitSecs: e.target.value.replace(/[^\d]/g, ""),
                        }))
                      }
                      className={cn(fieldClass, "min-h-11")}
                      placeholder={String(holdDefaults.maxWaitSecs)}
                    />
                    <p className="hidden text-2xs text-muted-foreground md:block">
                      Then one booking SMS + hangup (120–900). Blank = {holdDefaults.maxWaitSecs}s.
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-border bg-background/40">
                  <button
                    type="button"
                    onClick={() => setHolidayOpen((o) => !o)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-3 text-left"
                    aria-expanded={holidayOpen}
                  >
                    <span className="text-xs font-semibold text-foreground">
                      Scheduled Holiday Closures
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        holidayOpen && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>
                  {holidayOpen ? (
                    <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label htmlFor="configure-holiday-start" className="text-2xs font-medium text-muted-foreground">
                            Starts
                          </label>
                          <input
                            id="configure-holiday-start"
                            type="datetime-local"
                            value={draft.holidayStart}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, holidayStart: e.target.value }))
                            }
                            className={cn(fieldClass, "min-h-10")}
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="configure-holiday-end" className="text-2xs font-medium text-muted-foreground">
                            Ends
                          </label>
                          <input
                            id="configure-holiday-end"
                            type="datetime-local"
                            value={draft.holidayEnd}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, holidayEnd: e.target.value }))
                            }
                            className={cn(fieldClass, "min-h-10")}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="configure-holiday-text" className="text-2xs font-medium text-muted-foreground">
                          Holiday greeting (text-to-speech)
                        </label>
                        <textarea
                          id="configure-holiday-text"
                          rows={4}
                          value={draft.holidayText}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, holidayText: e.target.value }))
                          }
                          className={cn(fieldClass, "min-h-[6rem] resize-y")}
                          placeholder="Thanks for calling. We are closed for the holiday…"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            holidayStart: "",
                            holidayEnd: "",
                            holidayText: "",
                          }))
                        }
                        className="text-2xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Clear holiday window
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {currentTab === "hours" ? (
              <div className="space-y-4">
                <section className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Auto-schedule Presence</p>
                    <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">
                      Flips Presence Available during the hours below, and Closed outside them —
                      even if you forget to toggle it. Saving here clears any manual Busy/Closed
                      override and applies the schedule immediately. Tapping Busy afterward will
                      again block the schedule until you tap Available or re-save.
                    </p>
                  </div>
                  <Switch
                    checked={draft.hoursScheduleEnabled}
                    onCheckedChange={(next) =>
                      setDraft((d) => ({ ...d, hoursScheduleEnabled: next }))
                    }
                    aria-label="Auto-schedule Presence from weekly hours"
                  />
                </section>

                <div className="space-y-2">
                  <label
                    htmlFor="configure-hours-timezone"
                    className="text-xs font-semibold text-foreground"
                  >
                    Timezone
                  </label>
                  <Select
                    value={draft.hoursTimezone}
                    onValueChange={(v) => setDraft((d) => ({ ...d, hoursTimezone: v }))}
                  >
                    <SelectTrigger id="configure-hours-timezone" className={cn(fieldClass, "min-h-11 w-full")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.id} value={tz.id}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  {WEEKDAY_LABELS.map((label, dayOfWeek) => {
                    const day =
                      draft.weeklyHours.find((d) => d.dayOfWeek === dayOfWeek) ??
                      defaultWeeklyHoursDays()[dayOfWeek]
                    return (
                      <div
                        key={dayOfWeek}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 p-3"
                      >
                        <label className="flex min-w-[7rem] items-center gap-2 text-sm font-medium text-foreground">
                          <input
                            type="checkbox"
                            checked={day.enabled}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                weeklyHours: d.weeklyHours.map((wd) =>
                                  wd.dayOfWeek === dayOfWeek
                                    ? { ...wd, enabled: e.target.checked }
                                    : wd
                                ),
                              }))
                            }
                            className="h-4 w-4 rounded border-border"
                          />
                          {label}
                        </label>
                        {day.enabled ? (
                          <div className="flex flex-1 flex-wrap items-center gap-2">
                            <input
                              type="time"
                              value={day.startTime}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  weeklyHours: d.weeklyHours.map((wd) =>
                                    wd.dayOfWeek === dayOfWeek
                                      ? { ...wd, startTime: e.target.value }
                                      : wd
                                  ),
                                }))
                              }
                              className={cn(fieldClass, "min-h-10 w-auto flex-none px-2 py-1")}
                            />
                            <span className="text-2xs text-muted-foreground">to</span>
                            <input
                              type="time"
                              value={day.endTime}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  weeklyHours: d.weeklyHours.map((wd) =>
                                    wd.dayOfWeek === dayOfWeek
                                      ? { ...wd, endTime: e.target.value }
                                      : wd
                                  ),
                                }))
                              }
                              className={cn(fieldClass, "min-h-10 w-auto flex-none px-2 py-1")}
                            />
                          </div>
                        ) : (
                          <span className="text-2xs text-muted-foreground">Closed all day</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2 border-t border-border pt-4">
                  <label
                    htmlFor="configure-oncall-tech"
                    className="text-xs font-semibold text-foreground"
                  >
                    On-call tech (after hours)
                  </label>
                  <Select
                    value={draft.oncallTechnicianId || "__off__"}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, oncallTechnicianId: v === "__off__" ? null : v }))
                    }
                  >
                    <SelectTrigger id="configure-oncall-tech" className={cn(fieldClass, "min-h-11 w-full")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__off__">Off — use receptionist / hold menu</SelectItem>
                      {techMembers
                        .filter((t) => t.is_active)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs leading-snug text-muted-foreground">
                    Rings this tech&apos;s cell during Closed / after-hours instead of your
                    receptionist or hold menu. No screen alert — have them save your business
                    number as a contact so they recognize the call.
                  </p>
                </div>
              </div>
            ) : null}

            {currentTab === "security" ? (
              <div className="space-y-6">
                <section className="space-y-2 rounded-xl border border-warning/20 bg-warning/5 p-4">
                  <label htmlFor="configure-bypass" className="text-xs font-semibold text-warning">
                    Secret technician bypass
                  </label>
                  <input
                    id="configure-bypass"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    value={draft.bypass}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        bypass: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                    className={cn(fieldClass, "min-h-11")}
                    placeholder="e.g. 9 or 1234"
                  />
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    Digits dialed during the automation greeting ring your cell and skip presence
                    blocks. Avoid &quot;1&quot; (booking key).
                  </p>
                </section>

                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Looking for missed-call handling (what happens if nobody answers)? That moved to
                  the <span className="font-semibold text-foreground">Call Routing</span> tab, right
                  under who rings first — so the whole flow lives in one place.
                </p>
              </div>
            ) : null}
          </>
        )}
      </DrawerScrollBody>

      <DrawerStickyFooter
        dirty={dirty}
        saving={saving}
        onSave={() => void handleSave()}
        onCancel={() => {
          void load()
          onClose()
        }}
        saveLabel="Save Changes"
        saveAsSubmit
      />
    </form>
  )
}
