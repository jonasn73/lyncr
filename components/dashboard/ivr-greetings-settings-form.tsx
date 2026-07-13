"use client"

// Greetings → Traditional IVR settings (no AI) — greeting text + keypress 1/2 actions.

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_IVR_GREETING_TEXT,
  DEFAULT_IVR_MENU_SETTINGS,
  IVR_MENU_ACTION_OPTIONS,
  type IvrMenuAction,
  type IvrMenuSettings,
} from "@/lib/ivr-menu-settings"

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
  const [option1, setOption1] = useState<IvrMenuAction>(DEFAULT_IVR_MENU_SETTINGS.ivrOption1Action)
  const [option2, setOption2] = useState<IvrMenuAction>(DEFAULT_IVR_MENU_SETTINGS.ivrOption2Action)
  const [baseline, setBaseline] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = routingBusinessNumber
        ? `?number=${encodeURIComponent(routingBusinessNumber)}`
        : ""
      const res = await fetch(`/api/routing/ivr${qs}`, { credentials: "include" })
      const json = (await res.json()) as { data?: IvrMenuSettings; error?: string }
      const data = json.data || DEFAULT_IVR_MENU_SETTINGS
      setGreeting(data.ivrGreetingText || DEFAULT_IVR_GREETING_TEXT)
      setOption1(data.ivrOption1Action)
      setOption2(data.ivrOption2Action)
      setBaseline(
        JSON.stringify({
          ivrGreetingText: data.ivrGreetingText || DEFAULT_IVR_GREETING_TEXT,
          ivrOption1Action: data.ivrOption1Action,
          ivrOption2Action: data.ivrOption2Action,
        })
      )
    } catch {
      setGreeting(DEFAULT_IVR_GREETING_TEXT)
      setOption1("sms_link")
      setOption2("live_booking")
    } finally {
      setLoading(false)
    }
  }, [routingBusinessNumber])

  useEffect(() => {
    void load()
  }, [load])

  const dirty =
    JSON.stringify({
      ivrGreetingText: greeting,
      ivrOption1Action: option1,
      ivrOption2Action: option2,
    }) !== baseline

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/routing/ivr", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_number: routingBusinessNumber,
          ivrGreetingText: greeting,
          ivrOption1Action: option1,
          ivrOption2Action: option2,
        }),
      })
      const json = (await res.json()) as {
        data?: IvrMenuSettings
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
      const data = json.data || {
        ivrGreetingText: greeting,
        ivrOption1Action: option1,
        ivrOption2Action: option2,
      }
      setGreeting(data.ivrGreetingText)
      setOption1(data.ivrOption1Action)
      setOption2(data.ivrOption2Action)
      setBaseline(JSON.stringify(data))
      toast({
        title: "IVR settings saved",
        description: "Callers will hear your updated greeting and keypress actions.",
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
          No AI required. Control the automated voice greeting and what happens when callers press 1
          or 2 on the phone keypad.
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
              IVR greeting text
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
            <ActionSelect
              id="ivr-option-1"
              label="Keypress 1"
              value={option1}
              onChange={setOption1}
            />
            <ActionSelect
              id="ivr-option-2"
              label="Keypress 2"
              value={option2}
              onChange={setOption2}
            />
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

function ActionSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: IvrMenuAction
  onChange: (v: IvrMenuAction) => void
}) {
  const active = IVR_MENU_ACTION_OPTIONS.find((o) => o.value === value)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-zinc-300">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as IvrMenuAction)}
        className={cn(fieldClass, "h-11 px-3")}
      >
        {IVR_MENU_ACTION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {active ? <p className="text-[10px] leading-snug text-zinc-600">{active.description}</p> : null}
    </div>
  )
}
