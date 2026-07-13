"use client"

// Greetings → Traditional IVR settings — TTS greeting + locked Digits 1 / 2 routes.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_IVR_GREETING_TEXT,
  DEFAULT_IVR_MENU_SETTINGS,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"

/** API may return camelCase fields plus snake_case aliases. */
type IvrApiPayload = IvrMenuSettings & {
  ivr_greeting?: string
  digit_1_action?: string
  digit_2_action?: string
  ivr_menu_enabled?: boolean
}

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/40"

export function IvrGreetingsSettingsForm({
  routingBusinessNumber,
  className,
}: {
  /** Active line E.164 — scopes per-number IVR config. */
  routingBusinessNumber: string | null
  className?: string
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [greeting, setGreeting] = useState(DEFAULT_IVR_GREETING_TEXT)
  const [baseline, setBaseline] = useState("")

  // Digits are fixed product routes — 1 = SMS /book/[id], 2 = ring owner cell (+ busy SMS fallback).
  const digit1Action = "sms_link" as const
  const digit2Action = "ring_phone" as const

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = routingBusinessNumber
        ? `?number=${encodeURIComponent(routingBusinessNumber)}`
        : ""
      const res = await fetch(`/api/routing/ivr${qs}`, { credentials: "include" })
      const json = (await res.json()) as {
        data?: IvrApiPayload
        error?: string
      }
      const data: IvrApiPayload = json.data || { ...DEFAULT_IVR_MENU_SETTINGS }
      const greetingText =
        data.ivrGreetingText || data.ivr_greeting || DEFAULT_IVR_GREETING_TEXT
      setGreeting(greetingText)
      setBaseline(JSON.stringify({ ivr_greeting: greetingText }))
    } catch {
      setGreeting(DEFAULT_IVR_GREETING_TEXT)
    } finally {
      setLoading(false)
    }
  }, [routingBusinessNumber])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = JSON.stringify({ ivr_greeting: greeting }) !== baseline

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/ivr", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_number: routingBusinessNumber,
          // TTS script the keypad menu speaks to callers.
          ivrGreetingText: greeting,
          ivr_greeting: greeting,
          // Strict mappings — always commit the product routes on save.
          ivrOption1Action: digit1Action,
          digit_1_action: digit1Action,
          ivrOption2Action: digit2Action,
          digit_2_action: digit2Action,
        }),
      })
      const json = (await res.json()) as {
        data?: IvrApiPayload
        error?: string
        migration?: string
      }
      if (!res.ok) {
        toast({
          title: "Could not save IVR settings",
          description: json.migration
            ? `Run ${json.migration} in Neon SQL Editor, then try again.`
            : json.error || res.statusText,
          variant: "destructive",
        })
        return
      }
      const data: IvrApiPayload = json.data || {
        ...DEFAULT_IVR_MENU_SETTINGS,
        ivrGreetingText: greeting,
      }
      const greetingText = data.ivrGreetingText || data.ivr_greeting || greeting
      setGreeting(greetingText)
      setBaseline(JSON.stringify({ ivr_greeting: greetingText }))
      toast({
        title: "IVR greetings saved",
        description: "Callers hear your updated script. Press 1 texts the booking link; Press 2 holds tomorrow.",
      })
    } catch (e) {
      toast({
        title: "Could not save IVR settings",
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
        "space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4",
        className
      )}
      aria-labelledby="ivr-greetings-heading"
    >
      <div>
        <p
          id="ivr-greetings-heading"
          className="text-xs font-semibold uppercase tracking-wide text-blue-300"
        >
          Greetings · Traditional IVR
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Edit what the text-to-speech engine reads when Off-duty IVR answers. Keypress routes are
          fixed below.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading IVR settings…
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label htmlFor="ivr-greeting-text" className="text-xs font-semibold text-zinc-300">
              Spoken greeting (text-to-speech)
            </label>
            <textarea
              id="ivr-greeting-text"
              rows={5}
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              className={cn(fieldClass, "min-h-[7.5rem] resize-y px-3 py-2.5")}
              placeholder={DEFAULT_IVR_GREETING_TEXT}
            />
            <p className="text-[10px] text-zinc-600">
              Spoken exactly as written when Telnyx answers with the keypad menu.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
                Digit 1 Action
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">Send SMS Booking Link</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                Texts a secure lyncr.app/book/[id] tracking link, then hangs up.
              </p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
                Digit 2 Action
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">Ring Our Phone</p>
              <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                Dials your cell for 20 seconds. If no answer, offers an SMS booking link.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void handleSave()}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition-opacity",
              "bg-blue-600 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save Settings"
            )}
          </button>
        </>
      )}
    </section>
  )
}
