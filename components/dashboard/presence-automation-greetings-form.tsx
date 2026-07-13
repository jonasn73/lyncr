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
import {
  TELNYX_MENU_CLOSED_PROMPT,
  TELNYX_MENU_ON_JOB_PROMPT,
} from "@/lib/telnyx-menu"

const DEFAULT_ON_JOB_GREETING_TEXT = TELNYX_MENU_ON_JOB_PROMPT
const DEFAULT_CLOSED_GREETING_TEXT = TELNYX_MENU_CLOSED_PROMPT

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/40"

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
}

type DraftState = {
  onJob: string
  closed: string
  bypass: string
  voice: string
  holidayStart: string
  holidayEnd: string
  holidayText: string
}

function payloadToDraft(data: GreetingsPayload): DraftState {
  return {
    onJob: data.onJobGreetingText || data.on_job_greeting_text || DEFAULT_ON_JOB_GREETING_TEXT,
    closed: data.closedGreetingText || data.closed_greeting_text || DEFAULT_CLOSED_GREETING_TEXT,
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/presence-greetings", { credentials: "include" })
      const json = (await res.json()) as { data?: GreetingsPayload; error?: string }
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
          onJobGreetingText: draft.onJob,
          on_job_greeting_text: draft.onJob,
          closedGreetingText: draft.closed,
          closed_greeting_text: draft.closed,
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
      const next = payloadToDraft(json.data || draft)
      setDraft(next)
      setBaseline(JSON.stringify(next))
      toast({
        title: "Automation greetings saved",
        description: "Voice, bypass, holiday, and Speak scripts update on the next call.",
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
        "space-y-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4",
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
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Edit On-Job / Closed Speak scripts, TTS persona, secret bypass dial, and holiday
          closures.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading automation greetings…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="ivr-voice-persona" className="text-xs font-semibold text-zinc-300">
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
              <p className="text-[10px] text-zinc-600">
                {IVR_VOICE_PERSONA_OPTIONS.find((o) => o.id === draft.voice)?.description ||
                  "Tone callers hear on automation Speak."}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="ivr-bypass-code" className="text-xs font-semibold text-zinc-300">
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
              <p className="text-[10px] text-zinc-600">
                Digits dialed during the greeting ring your cell (+1 502-260-2716) and skip
                presence blocks. Avoid &quot;1&quot; (booking key).
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <label htmlFor="on-job-greeting-text" className="text-xs font-semibold text-zinc-300">
              On-Job Automation Greeting
            </label>
            <textarea
              id="on-job-greeting-text"
              rows={5}
              value={draft.onJob}
              onChange={(e) => setDraft((d) => ({ ...d, onJob: e.target.value }))}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-2.5")}
              placeholder={DEFAULT_ON_JOB_GREETING_TEXT}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <label htmlFor="closed-greeting-text" className="text-xs font-semibold text-zinc-300">
              Off-Duty / Closed Automation Greeting
            </label>
            <textarea
              id="closed-greeting-text"
              rows={5}
              value={draft.closed}
              onChange={(e) => setDraft((d) => ({ ...d, closed: e.target.value }))}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-2.5")}
              placeholder={DEFAULT_CLOSED_GREETING_TEXT}
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
                📅 Scheduled Holiday Closures
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
                <p className="text-[10px] leading-relaxed text-zinc-600">
                  When the current time falls in this window, callers hear the holiday greeting
                  instead of On-Job / Closed.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="holiday-start" className="text-[11px] font-medium text-zinc-400">
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
                  <div className="space-y-1.5">
                    <label htmlFor="holiday-end" className="text-[11px] font-medium text-zinc-400">
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
                <div className="space-y-1.5">
                  <label
                    htmlFor="holiday-greeting-text"
                    className="text-[11px] font-medium text-zinc-400"
                  >
                    Holiday greeting (text-to-speech)
                  </label>
                  <textarea
                    id="holiday-greeting-text"
                    rows={4}
                    value={draft.holidayText}
                    onChange={(e) => setDraft((d) => ({ ...d, holidayText: e.target.value }))}
                    className={cn(fieldClass, "min-h-[6rem] resize-y px-3 py-2.5")}
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
                  className="text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                >
                  Clear holiday window
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity",
              "bg-amber-600 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
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
