"use client"

// Owner SMS templates — booking, en route, review copy + review link.
// Toggles = auto-send; templates stay editable for Today one-tap even when auto is off.

import { useEffect, useState } from "react"
import { Loader2, Star } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

type SmsSettings = {
  sms_booking_enabled: boolean
  sms_route_enabled: boolean
  sms_review_enabled: boolean
  sms_booking_template: string
  sms_route_template: string
  sms_review_template: string
  google_review_url: string
}

const EMPTY: SmsSettings = {
  sms_booking_enabled: false,
  sms_route_enabled: false,
  sms_review_enabled: false,
  sms_booking_template: "",
  sms_route_template: "",
  sms_review_template: "",
  google_review_url: "",
}

const PLACEHOLDERS = {
  booking:
    "Hi {{customer_name}}, this is {{business_name}}. Your appointment is confirmed for {{time_slot}}. Reply here if anything changes.",
  route: "Hi {{customer_name}}, your {{business_name}} technician {{tech_name}} is on the way. See you soon!",
  review: "Thanks for choosing {{business_name}}, {{customer_name}}! Leave us a quick review: {{review_url}}",
}

const TAGS = ["{{customer_name}}", "{{business_name}}", "{{time_slot}}", "{{tech_name}}", "{{review_url}}"]

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/60 focus:outline-none"

type Props = {
  onSaved?: () => void
}

export function SmsAutomationForm({ onSaved }: Props) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SmsSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/owner/sms-settings", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        const s = data?.data
        if (!s) return
        setSettings({
          sms_booking_enabled: s.sms_booking_enabled === true,
          sms_route_enabled: s.sms_route_enabled === true,
          sms_review_enabled: s.sms_review_enabled === true,
          sms_booking_template: s.sms_booking_template ?? "",
          sms_route_template: s.sms_route_template ?? "",
          sms_review_template: s.sms_review_template ?? "",
          google_review_url: s.google_review_url ?? "",
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patch<K extends keyof SmsSettings>(key: K, value: SmsSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/owner/sms-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || "Save failed")
      }
      toast({ title: "SMS templates saved" })
      onSaved?.()
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading templates…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">
        Write the texts you want customers to get. Use tags like{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300">{"{{customer_name}}"}</code> — they
        fill in automatically. The switch only controls <span className="text-zinc-300">automatic</span> sends; your
        wording is always saved for Today’s one-tap buttons too.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {TAGS.map((t) => (
          <span
            key={t}
            className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 font-mono text-[11px] text-zinc-400"
          >
            {t}
          </span>
        ))}
      </div>

      <PhaseBlock
        title="Booking confirmation"
        description="When a job is booked — confirms the appointment time."
        autoLabel="Send automatically on booking"
        enabled={settings.sms_booking_enabled}
        onToggle={(v) => patch("sms_booking_enabled", v)}
        value={settings.sms_booking_template}
        onChange={(v) => patch("sms_booking_template", v)}
        placeholder={PLACEHOLDERS.booking}
        disabled={saving}
      />
      <PhaseBlock
        title="On the way"
        description="When someone starts the route (Scheduler, tech app, or Today)."
        autoLabel="Send automatically on Start route"
        enabled={settings.sms_route_enabled}
        onToggle={(v) => patch("sms_route_enabled", v)}
        value={settings.sms_route_template}
        onChange={(v) => patch("sms_route_template", v)}
        placeholder={PLACEHOLDERS.route}
        disabled={saving}
      />
      <PhaseBlock
        title="Thanks + review"
        description="Used by Today’s Thanks + review button, and (if auto is on) ~15 minutes after a job completes."
        autoLabel="Also send automatically after job complete"
        enabled={settings.sms_review_enabled}
        onToggle={(v) => patch("sms_review_enabled", v)}
        value={settings.sms_review_template}
        onChange={(v) => patch("sms_review_template", v)}
        placeholder={PLACEHOLDERS.review}
        disabled={saving}
      />

      <label className="block">
        <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <Star className="h-3.5 w-3.5 text-amber-300" aria-hidden /> Google review link
        </span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://g.page/r/your-business/review"
          className={fieldClass}
          value={settings.google_review_url}
          onChange={(e) => patch("google_review_url", e.target.value)}
          disabled={saving}
        />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Pasted into {"{{review_url}}"} in the Thanks + review message. Leave blank for a thank-you with no link.
        </p>
      </label>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save SMS templates"}
      </button>
    </div>
  )
}

function PhaseBlock(props: {
  title: string
  description: string
  autoLabel: string
  enabled: boolean
  onToggle: (v: boolean) => void
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled: boolean
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="text-xs text-zinc-500">{props.description}</p>
      </div>
      <textarea
        rows={3}
        className={fieldClass + " resize-y"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        maxLength={480}
        disabled={props.disabled}
        aria-label={`${props.title} message`}
      />
      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2">
        <p className="text-xs text-zinc-400">{props.autoLabel}</p>
        <Switch
          checked={props.enabled}
          onCheckedChange={props.onToggle}
          disabled={props.disabled}
          aria-label={props.autoLabel}
        />
      </div>
    </div>
  )
}
