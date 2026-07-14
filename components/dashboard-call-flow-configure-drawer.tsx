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
import {
  TELNYX_MENU_CLOSED_PROMPT,
  TELNYX_MENU_ON_JOB_PROMPT,
} from "@/lib/telnyx-menu"
import { formatPhoneDisplay, snapDashboardRingTimeoutSec } from "@/lib/dashboard-routing-utils"
import type { FallbackOption } from "@/lib/dashboard-routing-utils"

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
  ringTimeout: number
  voice: string
  onJob: string
  closed: string
  holidayStart: string
  holidayEnd: string
  holidayText: string
  bypass: string
  fallbackType: FallbackOption
}

const DEFAULT_DRAFT: ConfigureDraft = {
  mode: "your_phone",
  customPhone: "",
  ringTimeout: 30,
  voice: DEFAULT_IVR_VOICE_ENGINE_MODEL,
  onJob: TELNYX_MENU_ON_JOB_PROMPT,
  closed: TELNYX_MENU_CLOSED_PROMPT,
  holidayStart: "",
  holidayEnd: "",
  holidayText: "",
  bypass: "",
  fallbackType: "owner",
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
  const [draft, setDraft] = useState<ConfigureDraft>(DEFAULT_DRAFT)
  const baselineRef = useRef(draftSnapshot(DEFAULT_DRAFT))

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
      const res = await fetch(`/api/routing/configure${qs}`, { credentials: "include" })
      const json = (await res.json()) as {
        data?: {
          activeRoutingMode?: string
          customRoutingPhone?: string | null
          ringTimeoutSeconds?: number
          fallbackType?: string
          onJobGreetingText?: string
          closedGreetingText?: string
          ivrBypassCode?: string | null
          ivrVoiceEngineModel?: string
          holidayOverrideStart?: string | null
          holidayOverrideEnd?: string | null
          holidayGreetingText?: string | null
        }
      }
      const d = json.data || {}
      const nextRing = Number(d.ringTimeoutSeconds ?? 30)
      const ring = RING_OPTIONS.includes(nextRing as (typeof RING_OPTIONS)[number]) ? nextRing : 30
      const fb = String(d.fallbackType || "owner").toLowerCase()
      const fallbackType: FallbackOption =
        fb === "ai" || fb === "voicemail" ? fb : "owner"
      const next: ConfigureDraft = {
        mode: normalizeActiveRoutingMode(d.activeRoutingMode),
        customPhone: phoneDigits10(d.customRoutingPhone),
        ringTimeout: ring,
        voice: d.ivrVoiceEngineModel || DEFAULT_IVR_VOICE_ENGINE_MODEL,
        onJob: d.onJobGreetingText || TELNYX_MENU_ON_JOB_PROMPT,
        closed: d.closedGreetingText || TELNYX_MENU_CLOSED_PROMPT,
        holidayStart: toDatetimeLocalValue(d.holidayOverrideStart || null),
        holidayEnd: toDatetimeLocalValue(d.holidayOverrideEnd || null),
        holidayText: d.holidayGreetingText || "",
        bypass: String(d.ivrBypassCode || ""),
        fallbackType,
      }
      setDraft(next)
      baselineRef.current = draftSnapshot(next)
      if (next.holidayStart || next.holidayEnd || next.holidayText) setHolidayOpen(true)
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
          ring_timeout_seconds: draft.mode === "your_phone" ? draft.ringTimeout : undefined,
          fallback_type: draft.fallbackType,
          onJobGreetingText: draft.onJob,
          closedGreetingText: draft.closed,
          ivrBypassCode: draft.bypass.trim() || null,
          ivrVoiceEngineModel: draft.voice,
          holidayOverrideStart: draft.holidayStart || null,
          holidayOverrideEnd: draft.holidayEnd || null,
          holidayGreetingText: draft.holidayText.trim() || null,
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
      if (draft.mode === "your_phone") setRingTimeoutSec(snapDashboardRingTimeoutSec(draft.ringTimeout))

      baselineRef.current = draftSnapshot(draft)
      window.dispatchEvent(
        new CustomEvent(LYNCR_ROUTING_MODE_CHANGED, {
          detail: { mode: draft.mode, businessNumber: routingBusinessNumber },
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
        title="Configure call flow"
        subtitle={`Settings for ${ownerPhoneDisplay || "this line"} — routing, voice greetings, and advanced rules.`}
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
                    {ACTIVE_ROUTING_MODE_OPTIONS.map((opt) => {
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

                          {/* Custom phone sits immediately under its selector */}
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

                          {opt.value === "lyncr_pool" && active ? (
                            <p className="ml-1 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5 text-[11px] text-violet-200/90">
                              Lyncr Pool is active — certified shared agents answer in-browser.
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
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
                  <label htmlFor="configure-on-job" className="text-xs font-semibold text-zinc-300">
                    On-Job Automation Greeting
                  </label>
                  <textarea
                    id="configure-on-job"
                    rows={5}
                    value={draft.onJob}
                    onChange={(e) => setDraft((d) => ({ ...d, onJob: e.target.value }))}
                    className={cn(fieldClass, "min-h-[7.5rem] resize-y")}
                  />
                </div>

                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <label htmlFor="configure-closed" className="text-xs font-semibold text-zinc-300">
                    Off-Duty / Closed Automation Greeting
                  </label>
                  <textarea
                    id="configure-closed"
                    rows={5}
                    value={draft.closed}
                    onChange={(e) => setDraft((d) => ({ ...d, closed: e.target.value }))}
                    className={cn(fieldClass, "min-h-[7.5rem] resize-y")}
                  />
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
