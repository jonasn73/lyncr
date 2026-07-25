"use client"

// Owner SMS templates — booking, en route, review copy + review link.
// Tap merge-tag chips to insert into the message field you’re editing.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Loader2, Star } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type SmsSettings = {
  sms_booking_enabled: boolean
  sms_route_enabled: boolean
  sms_review_enabled: boolean
  sms_booking_template: string
  sms_route_template: string
  sms_review_template: string
  google_review_url: string
}

/** Which message box the tag chips insert into. */
type TemplateFieldKey = "sms_booking_template" | "sms_route_template" | "sms_review_template"

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

/** Tags Lyncr fills in at send time — tap to drop into the active message. */
const TAGS: { tag: string; label: string }[] = [
  { tag: "{{customer_name}}", label: "Customer name" },
  { tag: "{{business_name}}", label: "Business name" },
  { tag: "{{time_slot}}", label: "Appointment time" },
  { tag: "{{tech_name}}", label: "Tech name" },
  { tag: "{{review_url}}", label: "Review link" },
]

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
  // Last message box the owner tapped — tags insert here.
  const [activeField, setActiveField] = useState<TemplateFieldKey>("sms_review_template")
  const bookingRef = useRef<HTMLTextAreaElement | null>(null)
  const routeRef = useRef<HTMLTextAreaElement | null>(null)
  const reviewRef = useRef<HTMLTextAreaElement | null>(null)
  // Remember caret so a chip tap inserts where they were typing.
  const caretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

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

  function refFor(key: TemplateFieldKey) {
    if (key === "sms_booking_template") return bookingRef
    if (key === "sms_route_template") return routeRef
    return reviewRef
  }

  function rememberCaret(el: HTMLTextAreaElement) {
    caretRef.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    }
  }

  const insertTag = useCallback(
    (tag: string) => {
      const key = activeField
      const el = refFor(key).current
      const current = settings[key] ?? ""
      const start = el ? el.selectionStart ?? caretRef.current.start : caretRef.current.start
      const end = el ? el.selectionEnd ?? caretRef.current.end : caretRef.current.end
      const next = current.slice(0, start) + tag + current.slice(end)
      if (next.length > 480) {
        toast({
          title: "Message too long",
          description: "Remove some text before adding another tag.",
          variant: "destructive",
        })
        return
      }
      patch(key, next)
      const cursor = start + tag.length
      caretRef.current = { start: cursor, end: cursor }
      // Put the caret after the inserted tag on the next paint.
      requestAnimationFrame(() => {
        const box = refFor(key).current
        if (!box) return
        box.focus()
        box.setSelectionRange(cursor, cursor)
      })
    },
    // settings + activeField needed for insert; toast is stable enough
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    [activeField, settings, toast]
  )

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

  const activeLabel =
    activeField === "sms_booking_template"
      ? "Booking confirmation"
      : activeField === "sms_route_template"
        ? "On the way"
        : "Thanks + review"

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 -mx-1 space-y-2 rounded-xl border border-primary/25 bg-card/95 px-3 py-3 shadow-sm backdrop-blur">
        <p className="text-xs text-zinc-400">
          Tap a tag to drop it into{" "}
          <span className="font-semibold text-foreground">{activeLabel}</span> (where you’re typing). Lyncr fills these
          in when the text sends.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map(({ tag, label }) => (
            <button
              key={tag}
              type="button"
              disabled={saving}
              onMouseDown={(e) => {
                // Keep focus/caret on the textarea instead of stealing it.
                e.preventDefault()
              }}
              onClick={() => insertTag(tag)}
              className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              title={`Insert ${label}`}
            >
              {tag}
            </button>
          ))}
        </div>
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
        active={activeField === "sms_booking_template"}
        textareaRef={bookingRef}
        onActivate={() => setActiveField("sms_booking_template")}
        onCaret={rememberCaret}
      />
      <PhaseBlock
        title="On the way"
        description="When someone starts the route (Scheduler or tech app)."
        autoLabel="Send automatically on Start route"
        enabled={settings.sms_route_enabled}
        onToggle={(v) => patch("sms_route_enabled", v)}
        value={settings.sms_route_template}
        onChange={(v) => patch("sms_route_template", v)}
        placeholder={PLACEHOLDERS.route}
        disabled={saving}
        active={activeField === "sms_route_template"}
        textareaRef={routeRef}
        onActivate={() => setActiveField("sms_route_template")}
        onCaret={rememberCaret}
      />
      <PhaseBlock
        title="Thanks + review"
        description="Used by the Thanks + review button, and (if auto is on) ~15 minutes after a job completes."
        autoLabel="Also send automatically after job complete"
        enabled={settings.sms_review_enabled}
        onToggle={(v) => patch("sms_review_enabled", v)}
        value={settings.sms_review_template}
        onChange={(v) => patch("sms_review_template", v)}
        placeholder={PLACEHOLDERS.review}
        disabled={saving}
        active={activeField === "sms_review_template"}
        textareaRef={reviewRef}
        onActivate={() => setActiveField("sms_review_template")}
        onCaret={rememberCaret}
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
  active: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onActivate: () => void
  onCaret: (el: HTMLTextAreaElement) => void
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-muted/20 p-4",
        props.active ? "border-primary/40 ring-1 ring-primary/20" : "border-border/70"
      )}
    >
      <div>
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="text-xs text-zinc-500">{props.description}</p>
      </div>
      <textarea
        ref={props.textareaRef}
        rows={3}
        className={fieldClass + " resize-y"}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value)
          props.onCaret(e.currentTarget)
        }}
        onFocus={(e) => {
          props.onActivate()
          props.onCaret(e.currentTarget)
        }}
        onClick={(e) => props.onCaret(e.currentTarget)}
        onKeyUp={(e) => props.onCaret(e.currentTarget)}
        onSelect={(e) => props.onCaret(e.currentTarget)}
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
