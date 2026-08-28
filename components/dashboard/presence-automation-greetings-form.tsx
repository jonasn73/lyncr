"use client"

// Lines → Automation Voice Greetings — Speak scripts + persona, bypass, holiday window.

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_IVR_VOICE_ENGINE_MODEL,
  IVR_VOICE_PERSONA_OPTIONS,
  toDatetimeLocalValue,
} from "@/lib/ivr-automation-settings"
import { HoldMusicPresetPicker } from "@/components/dashboard/hold-music-preset-picker"
import { TELNYX_MENU_BUSY_PROMPT } from "@/lib/telnyx-menu"

const DEFAULT_BUSY_GREETING_TEXT = TELNYX_MENU_BUSY_PROMPT

const fieldClass =
  "w-full rounded-lg border border-border bg-card/50 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground hover:border-border focus:border-teal-500/50 focus:outline-none focus:ring-1 focus:ring-teal-500/40"

type GreetingsPayload = {
  onJobGreetingText?: string
  closedGreetingText?: string
  on_job_greeting_text?: string
  closed_greeting_text?: string
  ivrBypassCode?: string | null
  ivr_bypass_code?: string | null
  ivrVoiceEngineModel?: string
  ivr_voice_engine_model?: string
  holidayOverrideStart?: string | null
  holiday_override_start?: string | null
  holidayOverrideEnd?: string | null
  holiday_override_end?: string | null
  holidayGreetingText?: string | null
  holiday_greeting_text?: string | null
  holdMusicUrl?: string | null
  hold_music_url?: string | null
  holdMaxWaitSecs?: number | null
  hold_max_wait_secs?: number | null
  holdRepromptSecs?: number | null
  hold_reprompt_secs?: number | null
  holdDefaults?: { maxWaitSecs?: number; repromptSecs?: number }
}

type DraftState = {
  /** Single Busy script — saved to both on-job and closed columns. */
  busy: string
  bypass: string
  voice: string
  holidayStart: string
  holidayEnd: string
  holidayText: string
  /** Optional public HTTPS MP3/WAV for Busy hold music (Phase C). */
  holdMusicUrl: string
  holdMaxWaitSecs: string
  holdRepromptSecs: string
}

function payloadToDraft(data: GreetingsPayload): DraftState {
  const onJob = data.onJobGreetingText || data.on_job_greeting_text || ""
  const closed = data.closedGreetingText || data.closed_greeting_text || ""
  const maxWait = data.holdMaxWaitSecs ?? data.hold_max_wait_secs
  const reprompt = data.holdRepromptSecs ?? data.hold_reprompt_secs
  return {
    busy: (onJob || closed || DEFAULT_BUSY_GREETING_TEXT).trim() || DEFAULT_BUSY_GREETING_TEXT,
    bypass: String(data.ivrBypassCode ?? data.ivr_bypass_code ?? ""),
    voice:
      data.ivrVoiceEngineModel || data.ivr_voice_engine_model || DEFAULT_IVR_VOICE_ENGINE_MODEL,
    holidayStart: toDatetimeLocalValue(
      data.holidayOverrideStart || data.holiday_override_start || null
    ),
    holidayEnd: toDatetimeLocalValue(
      data.holidayOverrideEnd || data.holiday_override_end || null
    ),
    holidayText: data.holidayGreetingText || data.holiday_greeting_text || "",
    holdMusicUrl: String(data.holdMusicUrl ?? data.hold_music_url ?? "").trim(),
    holdMaxWaitSecs: maxWait != null && Number.isFinite(Number(maxWait)) ? String(maxWait) : "",
    holdRepromptSecs:
      reprompt != null && Number.isFinite(Number(reprompt)) ? String(reprompt) : "",
  }
}

export function PresenceAutomationGreetingsForm({ className }: { className?: string }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [holidayOpen, setHolidayOpen] = useState(false)
  const [draft, setDraft] = useState<DraftState>(() =>
    payloadToDraft({})
  )
  const [baseline, setBaseline] = useState("")
  const [holdDefaults, setHoldDefaults] = useState({ maxWaitSecs: 600, repromptSecs: 45 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/presence-greetings", { credentials: "include" })
      const json = (await res.json()) as { data?: GreetingsPayload; error?: string }
      if (json.data?.holdDefaults?.maxWaitSecs || json.data?.holdDefaults?.repromptSecs) {
        setHoldDefaults({
          maxWaitSecs: json.data.holdDefaults.maxWaitSecs || 600,
          repromptSecs: json.data.holdDefaults.repromptSecs || 45,
        })
      }
      const next = payloadToDraft(json.data || {})
      setDraft(next)
      setBaseline(JSON.stringify(next))
      // Auto-expand holiday section when a window is already configured.
      if (next.holidayStart || next.holidayEnd || next.holidayText) setHolidayOpen(true)
    } catch {
      const next = payloadToDraft({})
      setDraft(next)
      setBaseline(JSON.stringify(next))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = JSON.stringify(draft) !== baseline

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/presence-greetings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Keep both DB columns in sync — Presence Busy uses either path.
          onJobGreetingText: draft.busy,
          on_job_greeting_text: draft.busy,
          closedGreetingText: draft.busy,
          closed_greeting_text: draft.busy,
          ivrBypassCode: draft.bypass.trim() || null,
          ivr_bypass_code: draft.bypass.trim() || null,
          ivrVoiceEngineModel: draft.voice,
          ivr_voice_engine_model: draft.voice,
          holidayOverrideStart: draft.holidayStart || null,
          holiday_override_start: draft.holidayStart || null,
          holidayOverrideEnd: draft.holidayEnd || null,
          holiday_override_end: draft.holidayEnd || null,
          holidayGreetingText: draft.holidayText.trim() || null,
          holiday_greeting_text: draft.holidayText.trim() || null,
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
      const json = (await res.json()) as {
        data?: GreetingsPayload
        error?: string
        migration?: string
      }
      if (!res.ok) {
        toast({
          title: "Could not save greetings",
          description: json.migration
            ? `Run ${json.migration} in Neon SQL Editor, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      const next = payloadToDraft(json.data || { onJobGreetingText: draft.busy })
      setDraft(next)
      setBaseline(JSON.stringify(next))
      toast({
        title: "Automation greetings saved",
        description: "Busy greeting and voice settings update on the next call.",
      })
    } catch (e) {
      toast({
        title: "Could not save greetings",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 sm:space-y-4 sm:p-4",
        className
      )}
      aria-labelledby="automation-voice-greetings-heading"
    >
      <div>
        <p
          id="automation-voice-greetings-heading"
          className="text-xs font-semibold uppercase tracking-wide text-amber-300"
        >
          🤖 Automation Voice Greetings
        </p>
        <p className="hidden mt-0.5 text-2xs leading-snug text-muted-foreground md:block">
          Edit the Busy greeting callers hear when Presence is Busy — press 1 texts a booking link;
          stay on the line enters the hold queue — plus voice, bypass, and holiday closures.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading automation greetings…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="ivr-voice-persona" className="text-xs font-semibold text-foreground">
                AI Voice Persona
              </label>
              <select
                id="ivr-voice-persona"
                value={draft.voice}
                onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
                className={cn(fieldClass, "min-h-11 px-3 py-2")}
              >
                {IVR_VOICE_PERSONA_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-micro text-muted-foreground">
                {IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === draft.voice)?.description ||
                  "Tone callers hear on Busy gather and hold re-prompts."}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="ivr-bypass-code" className="text-xs font-semibold text-foreground">
                🔑 Secret Bypass Code
              </label>
              <input
                id="ivr-bypass-code"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={draft.bypass}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, bypass: e.target.value.replace(/\D/g, "") }))
                }
                className={cn(fieldClass, "min-h-11 px-3 py-2")}
                placeholder="e.g. 9 or 1234"
              />
              <p className="text-micro text-muted-foreground">
                Digits dialed during the greeting ring your cell (+1 502-260-2716) and skip
                presence blocks. Avoid &quot;1&quot; (booking key).
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
            <label htmlFor="busy-greeting-text" className="text-xs font-semibold text-foreground">
              Busy greeting
            </label>
            <p className="hidden text-micro text-muted-foreground md:block">
              Played when Presence is Busy — press 1 texts a booking link; stay on the line enters
              the hold queue (music + Lines Answer).
            </p>
            <textarea
              id="busy-greeting-text"
              rows={5}
              value={draft.busy}
              onChange={(e) => setDraft((d) => ({ ...d, busy: e.target.value }))}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-3")}
              placeholder={DEFAULT_BUSY_GREETING_TEXT}
            />
          </div>

          <HoldMusicPresetPicker
            idPrefix="hold-music"
            value={draft.holdMusicUrl}
            onChange={(next) => setDraft((d) => ({ ...d, holdMusicUrl: next }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="hold-reprompt-secs" className="text-xs font-semibold text-foreground">
                Re-prompt every (sec)
              </label>
              <input
                id="hold-reprompt-secs"
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
                className={cn(fieldClass, "min-h-11 px-3 py-2")}
                placeholder={String(holdDefaults.repromptSecs)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="hold-max-wait-secs" className="text-xs font-semibold text-foreground">
                Max wait (sec)
              </label>
              <input
                id="hold-max-wait-secs"
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
                className={cn(fieldClass, "min-h-11 px-3 py-2")}
                placeholder={String(holdDefaults.maxWaitSecs)}
              />
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
                📅 Scheduled Holiday Closures
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
                <p className="text-micro leading-relaxed text-muted-foreground">
                  When the current time falls in this window, callers hear the holiday greeting
                  instead of the Busy greeting.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="holiday-start" className="text-2xs font-medium text-muted-foreground">
                      Starts
                    </label>
                    <input
                      id="holiday-start"
                      type="datetime-local"
                      value={draft.holidayStart}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, holidayStart: e.target.value }))
                      }
                      className={cn(fieldClass, "min-h-10 px-3 py-2")}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="holiday-end" className="text-2xs font-medium text-muted-foreground">
                      Ends
                    </label>
                    <input
                      id="holiday-end"
                      type="datetime-local"
                      value={draft.holidayEnd}
                      onChange={(e) => setDraft((d) => ({ ...d, holidayEnd: e.target.value }))}
                      className={cn(fieldClass, "min-h-10 px-3 py-2")}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="holiday-greeting-text"
                    className="text-2xs font-medium text-muted-foreground"
                  >
                    Holiday greeting (text-to-speech)
                  </label>
                  <textarea
                    id="holiday-greeting-text"
                    rows={4}
                    value={draft.holidayText}
                    onChange={(e) => setDraft((d) => ({ ...d, holidayText: e.target.value }))}
                    className={cn(fieldClass, "min-h-[6rem] resize-y px-3 py-3")}
                    placeholder="Thanks for calling Key Squad. We are closed for the holiday…"
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

          <div className="rounded-lg border border-border bg-background/40 px-3 py-3">
            <p className="text-xs font-semibold text-foreground">Text after missed call</p>
            <p className="mt-1 text-micro leading-relaxed text-muted-foreground">
              Separate from Busy press 1. When someone rings your team and nobody answers, Missed Call
              Rescue can text “Sorry we missed your call — book here…” Turn it on/off under Lines →
              Missed Call Rescue (default on). Hanging up on Busy without pressing 1 does not text.
            </p>
          </div>

          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity",
              "bg-teal-600 hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save Greetings"
            )}
          </button>
        </>
      )}
    </section>
  )
}
