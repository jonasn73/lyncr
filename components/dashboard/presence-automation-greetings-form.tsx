"use client"

// Lines → Automation Voice Greetings — edit On-Job / Closed TeXML Speak scripts.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
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
}

export function PresenceAutomationGreetingsForm({ className }: { className?: string }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Local drafts bound to the two textareas.
  const [onJob, setOnJob] = useState(DEFAULT_ON_JOB_GREETING_TEXT)
  const [closed, setClosed] = useState(DEFAULT_CLOSED_GREETING_TEXT)
  // Snapshot of last saved values — used to enable Save only when dirty.
  const [baseline, setBaseline] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/presence-greetings", { credentials: "include" })
      const json = (await res.json()) as { data?: GreetingsPayload; error?: string }
      const data = json.data || {}
      const onJobText =
        data.onJobGreetingText || data.on_job_greeting_text || DEFAULT_ON_JOB_GREETING_TEXT
      const closedText =
        data.closedGreetingText || data.closed_greeting_text || DEFAULT_CLOSED_GREETING_TEXT
      setOnJob(onJobText)
      setClosed(closedText)
      setBaseline(JSON.stringify({ onJob: onJobText, closed: closedText }))
    } catch {
      setOnJob(DEFAULT_ON_JOB_GREETING_TEXT)
      setClosed(DEFAULT_CLOSED_GREETING_TEXT)
      setBaseline(
        JSON.stringify({
          onJob: DEFAULT_ON_JOB_GREETING_TEXT,
          closed: DEFAULT_CLOSED_GREETING_TEXT,
        })
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = JSON.stringify({ onJob, closed }) !== baseline

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/presence-greetings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onJobGreetingText: onJob,
          on_job_greeting_text: onJob,
          closedGreetingText: closed,
          closed_greeting_text: closed,
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
      const data = json.data || {}
      const onJobText = data.onJobGreetingText || data.on_job_greeting_text || onJob
      const closedText = data.closedGreetingText || data.closed_greeting_text || closed
      setOnJob(onJobText)
      setClosed(closedText)
      setBaseline(JSON.stringify({ onJob: onJobText, closed: closedText }))
      toast({
        title: "Automation greetings saved",
        description: "Callers hear your updated On-Job / Closed scripts on the next call.",
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
          Edit what callers hear when Presence is On-Job or Closed. Text-to-speech reads these
          scripts exactly as written.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading automation greetings…
        </div>
      ) : (
        <>
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <label htmlFor="on-job-greeting-text" className="text-xs font-semibold text-zinc-300">
              On-Job Automation Greeting
            </label>
            <textarea
              id="on-job-greeting-text"
              rows={5}
              value={onJob}
              onChange={(e) => setOnJob(e.target.value)}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-2.5")}
              placeholder={DEFAULT_ON_JOB_GREETING_TEXT}
            />
            <p className="text-[10px] text-zinc-600">
              Spoken when Presence is On-Job (live lockout / busy automation).
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <label htmlFor="closed-greeting-text" className="text-xs font-semibold text-zinc-300">
              Off-Duty / Closed Automation Greeting
            </label>
            <textarea
              id="closed-greeting-text"
              rows={5}
              value={closed}
              onChange={(e) => setClosed(e.target.value)}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-2.5")}
              placeholder={DEFAULT_CLOSED_GREETING_TEXT}
            />
            <p className="text-[10px] text-zinc-600">
              Spoken when Presence is Closed (off-duty evening automation).
            </p>
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
