// Owner-facing "Lyncr Automated SMS Engine" — per-phase toggles, editable templates with tag tokens,
// and the review link. Self-contained: loads + saves via /api/owner/sms-settings.

"use client"

import { useEffect, useState } from "react"
import { MessageSquare, Star } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"

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

export function SmsEngineCard() {
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
      .catch(() => {
        /* optional until migration 062 */
      })
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
      toast({ title: "Automated SMS settings saved" })
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

  return (
    <WorkspacePanel className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <MessageSquare className="h-5 w-5 text-emerald-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-6">
          <div>
            <p className="text-sm font-semibold text-foreground">Lyncr Automated SMS Engine</p>
            <p className="mt-1 text-xs text-zinc-500">
              Send white-labeled texts to your customers at each stage of the job. Use tags like{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300">{"{{customer_name}}"}</code>{" "}
              and they fill in automatically.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <>
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
                title="Booking Confirmation"
                description="Sent when a job is booked, confirming the appointment time."
                enabled={settings.sms_booking_enabled}
                onToggle={(v) => patch("sms_booking_enabled", v)}
                value={settings.sms_booking_template}
                onChange={(v) => patch("sms_booking_template", v)}
                placeholder={PLACEHOLDERS.booking}
                disabled={saving}
              />

              <PhaseBlock
                title="Technician En Route"
                description="Sent when you assign a tech or they press Start Route."
                enabled={settings.sms_route_enabled}
                onToggle={(v) => patch("sms_route_enabled", v)}
                value={settings.sms_route_template}
                onChange={(v) => patch("sms_route_template", v)}
                placeholder={PLACEHOLDERS.route}
                disabled={saving}
              />

              <PhaseBlock
                title="Post-Job Review Request"
                description="Drops 15 minutes after the job is completed, with your review link."
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
                <p className="mt-2 text-xs text-zinc-500">
                  Paste your Google Business Profile review link — it's injected into the{" "}
                  <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300">{"{{review_url}}"}</code> tag.
                </p>
              </label>

              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save SMS engine"}
              </button>
            </>
          )}
        </div>
      </div>
    </WorkspacePanel>
  )
}

function PhaseBlock(props: {
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  value: string
  onChange: (v: string) => void
  placeholder: string
  disabled: boolean
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{props.title}</p>
          <p className="text-xs text-zinc-500">{props.description}</p>
        </div>
        <Switch
          checked={props.enabled}
          onCheckedChange={props.onToggle}
          disabled={props.disabled}
          aria-label={props.title}
        />
      </div>
      {props.enabled && (
        <textarea
          rows={3}
          className={fieldClass + " resize-y"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          maxLength={480}
          disabled={props.disabled}
        />
      )}
    </div>
  )
}
