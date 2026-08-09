"use client"

// Unified Call Flow configure drawer — tabbed Routing / Greetings / Security + one Save.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
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
import { HoldMusicPresetPicker } from "@/components/dashboard/hold-music-preset-picker"

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"

const RING_OPTIONS = [15, 20, 30, 45, 60] as const

const TABS = [
  { id: "routing" as const, label: "Call Routing" },
  { id: "greetings" as const, label: "Greetings & Voice AI" },
  { id: "security" as const, label: "Advanced Rules" },
]

type ConfigureTab = (typeof TABS)[number]["id"]

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
      // Load configure payload + Team roster in parallel.
      const [res, teamRes] = await Promise.all([
        fetch(`/api/routing/configure${qs}`, { credentials: "include" }),
        fetch("/api/receptionists", { credentials: "include" }),
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
      const fallbackType: FallbackOption =
        fb === "ai" || fb === "voicemail" ? fb : "owner"
      const savedRecId =
        typeof d.selectedReceptionistId === "string" && d.selectedReceptionistId.trim()
          ? d.selectedReceptionistId.trim()
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

  const sheetTitle =
    currentTab === "greetings"
      ? "Greetings"
      : currentTab === "security"
        ? "Advanced Rules"
        : "Who answers"

  const sheetSubtitle =
    currentTab === "greetings"
      ? `Busy greeting, hold music, and voice for ${ownerPhoneDisplay || "this line"}.`
      : currentTab === "security"
        ? `Bypass digit and emergency fallback for ${ownerPhoneDisplay || "this line"}.`
        : `Who rings first for ${ownerPhoneDisplay || "this line"}.`

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

  const lineLabel = routingBusinessNumber
    ? `Line ${formatPhoneDisplay(routingBusinessNumber)}`
    : null

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
      <div className="shrink-0 border-b border-zinc-800 px-4 pt-1 sm:px-6">
        <div
          role="tablist"
          aria-label="Call flow settings"
          className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1"
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
                  "min-h-9 flex-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors sm:text-xs",
                  active
                    ? "bg-zinc-800 text-foreground shadow-sm"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <DrawerScrollBody>
        {loading || routingLineDetailLoading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading configuration…
          </div>
        ) : (
          <>
            {currentTab === "routing" ? (
              <div className="space-y-5">
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Who answers first
                  </legend>
                  <div role="radiogroup" aria-label="Active routing mode" className="space-y-2">
                    {primaryRoutingModes.map((opt) => {
                      const active = draft.mode === opt.value
                      return (
                        <div key={opt.value} className="space-y-2">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setDraft((d) => ({ ...d, mode: opt.value }))}
                            className={cn(
                              "flex w-full cursor-pointer gap-3 rounded-xl border px-3 py-3 text-left transition-colors touch-manipulation",
                              active
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                active
                                  ? "border-emerald-400 bg-emerald-500/20"
                                  : "border-zinc-600 bg-transparent"
                              )}
                            >
                              {active ? (
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              ) : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">
                                {opt.label}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                                {opt.description}
                              </span>
                            </span>
                          </button>

                          {opt.value === "team_receptionist" && active ? (
                            <section className="ml-1 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                              <label
                                htmlFor="configure-team-receptionist"
                                className="text-xs font-semibold text-zinc-300"
                              >
                                Who on your Team answers first
                              </label>
                              {teamMembers.length === 0 ? (
                                <p className="text-[11px] text-amber-200/90">
                                  Add a receptionist on the Team page first, then come back here.
                                </p>
                              ) : (
                                <select
                                  id="configure-team-receptionist"
                                  value={draft.selectedReceptionistId || ""}
                                  onChange={(e) =>
                                    setDraft((d) => ({
                                      ...d,
                                      selectedReceptionistId: e.target.value || null,
                                    }))
                                  }
                                  className={cn(fieldClass, "min-h-11")}
                                >
                                  {teamMembers.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                      {m.is_active ? "" : " (Unavailable)"}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <p className="text-[10px] text-zinc-600">
                                Available → rings them first. Unavailable → your phone if Available,
                                otherwise the busy voice menu (press 1 for booking form).
                              </p>
                              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
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
                                        : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                                    )}
                                  >
                                    {sec}s
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {opt.value === "your_phone" && active ? (
                            <section className="ml-1 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                Ring delay before fallback
                              </p>
                              <p className="text-[11px] text-zinc-500">
                                How long to ring your cell before emergency / missed handling.
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
                                        : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
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

                    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/30">
                      <button
                        type="button"
                        onClick={() => setMoreRoutingOpen((o) => !o)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                        aria-expanded={moreRoutingOpen}
                      >
                        <span className="text-xs font-semibold text-zinc-400">
                          More options · Lyncr Pool / Custom
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
                            moreRoutingOpen && "rotate-180"
                          )}
                          aria-hidden
                        />
                      </button>
                      {moreRoutingOpen ? (
                        <div className="space-y-2 border-t border-zinc-800 px-2 pb-3 pt-2">
                          {advancedRoutingModes.map((opt) => {
                            const active = draft.mode === opt.value
                            return (
                              <div key={opt.value} className="space-y-2">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  onClick={() => setDraft((d) => ({ ...d, mode: opt.value }))}
                                  className={cn(
                                    "flex w-full cursor-pointer gap-3 rounded-xl border px-3 py-3 text-left transition-colors touch-manipulation",
                                    active
                                      ? "border-emerald-500/40 bg-emerald-500/10"
                                      : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                                      active
                                        ? "border-emerald-400 bg-emerald-500/20"
                                        : "border-zinc-600 bg-transparent"
                                    )}
                                  >
                                    {active ? (
                                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                    ) : null}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-foreground">
                                      {opt.label}
                                    </span>
                                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                                      {opt.description}
                                    </span>
                                  </span>
                                </button>

                                {opt.value === "custom_routing" && active ? (
                                  <section className="ml-1 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                                    <label
                                      htmlFor="configure-custom-phone"
                                      className="text-xs font-semibold text-zinc-300"
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
                                    <p className="text-[10px] text-zinc-600">
                                      Every inbound call to this business line forwards to this number.
                                    </p>
                                  </section>
                                ) : null}

                                {opt.value === "lyncr_pool" && active ? (
                                  <p className="ml-1 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-[11px] text-violet-200/90">
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
              </div>
            ) : null}

            {currentTab === "greetings" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="configure-voice-persona" className="text-xs font-semibold text-zinc-300">
                    AI Voice Persona
                  </label>
                  <select
                    id="configure-voice-persona"
                    value={draft.voice}
                    onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
                    className={cn(fieldClass, "min-h-11")}
                  >
                    {IVR_VOICE_PERSONA_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-600">
                    {IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === draft.voice)?.description ||
                      "Tone callers hear on automation Speak."}
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <label htmlFor="configure-busy" className="text-xs font-semibold text-zinc-300">
                    Busy greeting
                  </label>
                  <p className="hidden text-[10px] text-zinc-600 md:block">
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
                  <div className="space-y-1.5">
                    <label htmlFor="configure-hold-reprompt" className="text-xs font-semibold text-zinc-300">
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
                    <p className="hidden text-[10px] text-zinc-600 md:block">
                      Music length before we re-speak Busy (20–90). Blank = {holdDefaults.repromptSecs}s.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="configure-hold-maxwait" className="text-xs font-semibold text-zinc-300">
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
                    <p className="hidden text-[10px] text-zinc-600 md:block">
                      Then one booking SMS + hangup (120–900). Blank = {holdDefaults.maxWaitSecs}s.
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
                  <button
                    type="button"
                    onClick={() => setHolidayOpen((o) => !o)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                    aria-expanded={holidayOpen}
                  >
                    <span className="text-xs font-semibold text-zinc-300">
                      Scheduled Holiday Closures
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-zinc-500 transition-transform",
                        holidayOpen && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </button>
                  {holidayOpen ? (
                    <div className="space-y-3 border-t border-zinc-800 px-3 pb-3 pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label htmlFor="configure-holiday-start" className="text-[11px] font-medium text-zinc-400">
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
                        <div className="space-y-1.5">
                          <label htmlFor="configure-holiday-end" className="text-[11px] font-medium text-zinc-400">
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
                      <div className="space-y-1.5">
                        <label htmlFor="configure-holiday-text" className="text-[11px] font-medium text-zinc-400">
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
                        className="text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                      >
                        Clear holiday window
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {currentTab === "security" ? (
              <div className="space-y-5">
                <section className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <label htmlFor="configure-bypass" className="text-xs font-semibold text-amber-200">
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
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Digits dialed during the automation greeting ring your cell and skip presence
                    blocks. Avoid &quot;1&quot; (booking key).
                  </p>
                </section>

                <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Emergency / missed-call handling
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    When the primary path does not connect, where should the caller go next?
                  </p>
                  <div role="radiogroup" aria-label="Emergency fallback" className="space-y-2">
                    {(
                      [
                        {
                          id: "owner" as const,
                          label: "Owner cell",
                          description: "Ring your phone as the emergency backup.",
                        },
                        {
                          id: "ai" as const,
                          label: "Voice AI receptionist",
                          description: "Hand off to AI to capture the lead.",
                        },
                        {
                          id: "voicemail" as const,
                          label: "Company voicemail",
                          description: "Play greeting and record a message.",
                        },
                      ] as const
                    ).map((opt) => {
                      const active = draft.fallbackType === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setDraft((d) => ({ ...d, fallbackType: opt.id }))}
                          className={cn(
                            "flex w-full gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                            active
                              ? "border-primary/50 bg-primary/10"
                              : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                              active
                                ? "border-primary bg-primary/20"
                                : "border-zinc-600 bg-transparent"
                            )}
                          >
                            {active ? (
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">
                              {opt.label}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-zinc-500">
                              {opt.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Hold queue (advanced)
                  </p>
                  <p className="hidden text-[11px] leading-relaxed text-zinc-500 md:block">
                    Position hints play automatically on re-prompts. Concurrent wait caps use{" "}
                    <code className="text-zinc-400">LYNCR_HOLD_MAX_CONCURRENT</code> (default 3) —
                    tune in Vercel env, not per-line.
                  </p>
                  <p className="text-[11px] text-zinc-500 md:hidden">
                    Concurrent wait cap is env-only (default 3). Music + max wait live under Greetings.
                  </p>
                </section>
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
