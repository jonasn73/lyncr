"use client"

// Owner SMS templates — booking, en route, review copy + review link.
// Tap merge-tag chips to insert into the message field you’re editing.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Loader2, Plus, Star, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  DEFAULT_SMS_STATUS_TEMPLATES,
  EXTRA_SMS_STATUS_KEYS,
  LEGACY_SMS_STATUS_TEMPLATES,
  PRIMARY_SMS_STATUS_KEYS,
  SMS_STATUS_TEMPLATE_META,
} from "@/lib/sms-status-templates"
import {
  DEFAULT_SMS_PHASE_TEMPLATES,
  LEGACY_SMS_PHASE_TEMPLATES,
  stockOrSaved,
} from "@/lib/sms-template-defaults"
import type { OwnerSmsSnippet, OwnerSmsStatusTemplates } from "@/lib/types"

type SmsSettings = {
  sms_booking_enabled: boolean
  sms_route_enabled: boolean
  sms_review_enabled: boolean
  sms_booking_template: string
  sms_route_template: string
  sms_review_template: string
  google_review_url: string
  sms_custom_snippets: OwnerSmsSnippet[]
  sms_status_templates: OwnerSmsStatusTemplates
}

/** Which message box the tag chips insert into. */
type TemplateFieldKey = "sms_booking_template" | "sms_route_template" | "sms_review_template"

/** One screen at a time — avoids a long scroll through every template. */
type SmsTabId = "booking" | "route" | "review" | "status" | "quick"

const SMS_TABS: { id: SmsTabId; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "route", label: "On the way" },
  { id: "review", label: "Thanks" },
  { id: "quick", label: "Your texts" },
  { id: "booking", label: "Extra" },
]

const MAX_CUSTOM_SNIPPETS = 20

/** Default copy shown as real editable text (not HTML placeholder — that disappears on click). */
const DEFAULT_TEMPLATES = DEFAULT_SMS_PHASE_TEMPLATES

const EMPTY: SmsSettings = {
  sms_booking_enabled: false,
  sms_route_enabled: false,
  sms_review_enabled: false,
  sms_booking_template: DEFAULT_TEMPLATES.booking,
  sms_route_template: DEFAULT_TEMPLATES.route,
  sms_review_template: DEFAULT_TEMPLATES.review,
  google_review_url: "",
  sms_custom_snippets: [],
  sms_status_templates: { ...DEFAULT_SMS_STATUS_TEMPLATES },
}

function withDefaultTemplate(
  saved: string | null | undefined,
  fallback: string,
  legacy: readonly string[] = []
): string {
  return stockOrSaved(saved, fallback, legacy)
}

/** Tags Lyncr fills in at send time — tap to drop into the active message. */
const TAGS: { tag: string; label: string }[] = [
  { tag: "{{customer_name}}", label: "Customer name" },
  { tag: "{{business_name}}", label: "Business name" },
  { tag: "{{tech_name}}", label: "Tech name" },
  { tag: "{{eta_minutes}}", label: "ETA minutes (late text)" },
  { tag: "{{review_url}}", label: "Review link" },
  { tag: "{{vehicle}}", label: "Vehicle / job" },
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
  const [tab, setTab] = useState<SmsTabId>("status")
  // Last message box the owner tapped — tags insert here.
  const [activeField, setActiveField] = useState<TemplateFieldKey>("sms_review_template")
  const [activeStatusKey, setActiveStatusKey] = useState<keyof OwnerSmsStatusTemplates | null>(
    "check_in"
  )
  const bookingRef = useRef<HTMLTextAreaElement | null>(null)
  const routeRef = useRef<HTMLTextAreaElement | null>(null)
  const reviewRef = useRef<HTMLTextAreaElement | null>(null)
  const statusRefs = useRef<Partial<Record<keyof OwnerSmsStatusTemplates, HTMLTextAreaElement | null>>>({})
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
          // Empty DB values → show default wording as editable text (not a vanishing placeholder).
          sms_booking_template: withDefaultTemplate(
            s.sms_booking_template,
            DEFAULT_TEMPLATES.booking,
            LEGACY_SMS_PHASE_TEMPLATES.booking
          ),
          sms_route_template: withDefaultTemplate(
            s.sms_route_template,
            DEFAULT_TEMPLATES.route,
            LEGACY_SMS_PHASE_TEMPLATES.route
          ),
          sms_review_template: withDefaultTemplate(
            s.sms_review_template,
            DEFAULT_TEMPLATES.review,
            LEGACY_SMS_PHASE_TEMPLATES.review
          ),
          google_review_url: s.google_review_url ?? "",
          sms_custom_snippets: Array.isArray(s.sms_custom_snippets) ? s.sms_custom_snippets : [],
          sms_status_templates: {
            check_in: withDefaultTemplate(
              s.sms_status_templates?.check_in,
              DEFAULT_SMS_STATUS_TEMPLATES.check_in,
              LEGACY_SMS_STATUS_TEMPLATES.check_in
            ),
            late: withDefaultTemplate(
              s.sms_status_templates?.late,
              DEFAULT_SMS_STATUS_TEMPLATES.late,
              LEGACY_SMS_STATUS_TEMPLATES.late
            ),
            arrived: withDefaultTemplate(
              s.sms_status_templates?.arrived,
              DEFAULT_SMS_STATUS_TEMPLATES.arrived,
              LEGACY_SMS_STATUS_TEMPLATES.arrived
            ),
            paused_wait: withDefaultTemplate(
              s.sms_status_templates?.paused_wait,
              DEFAULT_SMS_STATUS_TEMPLATES.paused_wait,
              LEGACY_SMS_STATUS_TEMPLATES.paused_wait
            ),
            paused_parts: withDefaultTemplate(
              s.sms_status_templates?.paused_parts,
              DEFAULT_SMS_STATUS_TEMPLATES.paused_parts,
              LEGACY_SMS_STATUS_TEMPLATES.paused_parts
            ),
          },
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
      const start = caretRef.current.start
      const end = caretRef.current.end

      if (activeStatusKey) {
        const el = statusRefs.current[activeStatusKey] ?? null
        const current = settings.sms_status_templates[activeStatusKey] ?? ""
        const s = el?.selectionStart ?? start
        const e = el?.selectionEnd ?? end
        const next = current.slice(0, s) + tag + current.slice(e)
        if (next.length > 480) {
          toast({
            title: "Message too long",
            description: "Remove some text before adding another tag.",
            variant: "destructive",
          })
          return
        }
        patch("sms_status_templates", {
          ...settings.sms_status_templates,
          [activeStatusKey]: next,
        })
        const cursor = s + tag.length
        caretRef.current = { start: cursor, end: cursor }
        requestAnimationFrame(() => {
          const box = statusRefs.current[activeStatusKey]
          if (!box) return
          box.focus()
          box.setSelectionRange(cursor, cursor)
        })
        return
      }

      const key = activeField
      const el = refFor(key).current
      const current = settings[key] ?? ""
      const s = el ? el.selectionStart ?? start : start
      const e = el ? el.selectionEnd ?? end : end
      const next = current.slice(0, s) + tag + current.slice(e)
      if (next.length > 480) {
        toast({
          title: "Message too long",
          description: "Remove some text before adding another tag.",
          variant: "destructive",
        })
        return
      }
      patch(key, next)
      const cursor = s + tag.length
      caretRef.current = { start: cursor, end: cursor }
      requestAnimationFrame(() => {
        const box = refFor(key).current
        if (!box) return
        box.focus()
        box.setSelectionRange(cursor, cursor)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    [activeField, activeStatusKey, settings, toast]
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
        const j = (await res.json().catch(() => ({}))) as { error?: string; migration?: string }
        throw new Error(
          j.migration ? `Run ${j.migration} in Neon, then try again.` : j.error || "Save failed"
        )
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

  function addSnippet() {
    if (settings.sms_custom_snippets.length >= MAX_CUSTOM_SNIPPETS) {
      toast({
        title: "Limit reached",
        description: `You can save up to ${MAX_CUSTOM_SNIPPETS} custom texts.`,
        variant: "destructive",
      })
      return
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `snip_${Date.now()}`
    patch("sms_custom_snippets", [
      ...settings.sms_custom_snippets,
      { id, label: "New text", body: "" },
    ])
  }

  function updateSnippet(id: string, patchRow: Partial<OwnerSmsSnippet>) {
    patch(
      "sms_custom_snippets",
      settings.sms_custom_snippets.map((s) => (s.id === id ? { ...s, ...patchRow } : s))
    )
  }

  function removeSnippet(id: string) {
    patch(
      "sms_custom_snippets",
      settings.sms_custom_snippets.filter((s) => s.id !== id)
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading templates…
      </div>
    )
  }

  const showTagChips = tab !== "quick"
  const activeLabel = activeStatusKey
    ? SMS_STATUS_TEMPLATE_META.find((m) => m.key === activeStatusKey)?.title || "Status update"
    : activeField === "sms_booking_template"
      ? "Extra confirmation"
      : activeField === "sms_route_template"
        ? "On the way"
        : "Thanks + review"

  function selectTab(next: SmsTabId) {
    setTab(next)
    if (next === "booking") {
      setActiveStatusKey(null)
      setActiveField("sms_booking_template")
    } else if (next === "route") {
      setActiveStatusKey(null)
      setActiveField("sms_route_template")
    } else if (next === "review") {
      setActiveStatusKey(null)
      setActiveField("sms_review_template")
    } else if (next === "status") {
      setActiveStatusKey("check_in")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        className="flex shrink-0 gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="SMS template sections"
      >
        {SMS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === t.id
                ? "bg-primary/20 text-primary ring-1 ring-primary/35"
                : "bg-muted/40 text-zinc-400 hover:bg-muted/70 hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showTagChips ? (
        <div className="shrink-0 space-y-2 rounded-xl border border-primary/25 bg-card/95 px-3 py-2.5">
          <p className="text-[11px] text-zinc-400">
            Tap a tag into <span className="font-semibold text-foreground">{activeLabel}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.filter(({ tag }) => {
              if (tab === "booking") {
                return tag === "{{customer_name}}" || tag === "{{business_name}}"
              }
              if (tab === "route") {
                return (
                  tag === "{{customer_name}}" ||
                  tag === "{{business_name}}" ||
                  tag === "{{tech_name}}"
                )
              }
              if (tab === "review") {
                return (
                  tag === "{{customer_name}}" ||
                  tag === "{{business_name}}" ||
                  tag === "{{review_url}}"
                )
              }
              if (tab === "status") {
                if (activeStatusKey === "late") {
                  return (
                    tag === "{{customer_name}}" ||
                    tag === "{{business_name}}" ||
                    tag === "{{eta_minutes}}"
                  )
                }
                if (activeStatusKey === "check_in") {
                  return (
                    tag === "{{customer_name}}" ||
                    tag === "{{business_name}}" ||
                    tag === "{{vehicle}}"
                  )
                }
                return tag === "{{customer_name}}" || tag === "{{business_name}}"
              }
              return false
            }).map(({ tag, label }) => (
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
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" role="tabpanel">
        {tab === "booking" ? (
          <PhaseBlock
            title="Extra confirmation"
            description="Usually leave auto off. Lyncr already texts when they submit the form."
            autoLabel="Send a second confirmation when a job is booked"
            enabled={settings.sms_booking_enabled}
            onToggle={(v) => patch("sms_booking_enabled", v)}
            value={settings.sms_booking_template}
            onChange={(v) => patch("sms_booking_template", v)}
            disabled={saving}
            active={activeStatusKey == null && activeField === "sms_booking_template"}
            textareaRef={bookingRef}
            onActivate={() => {
              setActiveStatusKey(null)
              setActiveField("sms_booking_template")
            }}
            onCaret={rememberCaret}
          />
        ) : null}

        {tab === "route" ? (
          <PhaseBlock
            title="On the way"
            description="Fills On my way in Messages. Auto-send only if you turn it on."
            autoLabel="Send automatically on Start route"
            enabled={settings.sms_route_enabled}
            onToggle={(v) => patch("sms_route_enabled", v)}
            value={settings.sms_route_template}
            onChange={(v) => patch("sms_route_template", v)}
            disabled={saving}
            active={activeStatusKey == null && activeField === "sms_route_template"}
            textareaRef={routeRef}
            onActivate={() => {
              setActiveStatusKey(null)
              setActiveField("sms_route_template")
            }}
            onCaret={rememberCaret}
          />
        ) : null}

        {tab === "review" ? (
          <div className="space-y-3">
            <PhaseBlock
              title="Thanks + review"
              description="Latest button, and (if auto is on) ~15 min after job complete."
              autoLabel="Also send automatically after job complete"
              enabled={settings.sms_review_enabled}
              onToggle={(v) => patch("sms_review_enabled", v)}
              value={settings.sms_review_template}
              onChange={(v) => patch("sms_review_template", v)}
              disabled={saving}
              active={activeStatusKey == null && activeField === "sms_review_template"}
              textareaRef={reviewRef}
              onActivate={() => {
                setActiveStatusKey(null)
                setActiveField("sms_review_template")
              }}
              onCaret={rememberCaret}
            />
            <label className="block rounded-xl border border-border/70 bg-muted/20 p-3">
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
                Fills {"{{review_url}}"}. Leave blank for a thank-you with no link.
              </p>
            </label>
          </div>
        ) : null}

        {tab === "status" ? (
          <section className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-xs text-zinc-500">
              These fill the chips in Messages. Tap a chip, then Send — nothing goes out by itself.
            </p>
            {SMS_STATUS_TEMPLATE_META.filter((meta) =>
              PRIMARY_SMS_STATUS_KEYS.includes(meta.key)
            ).map((meta) => (
              <div
                key={meta.key}
                className={cn(
                  "space-y-1.5 rounded-lg p-2",
                  activeStatusKey === meta.key && "ring-1 ring-amber-400/40"
                )}
              >
                <p className="text-xs font-semibold text-amber-100/90">{meta.title}</p>
                <p className="text-[11px] text-zinc-500">{meta.description}</p>
                <textarea
                  ref={(el) => {
                    statusRefs.current[meta.key] = el
                  }}
                  rows={2}
                  className={fieldClass + " resize-y"}
                  value={settings.sms_status_templates[meta.key]}
                  onChange={(e) => {
                    patch("sms_status_templates", {
                      ...settings.sms_status_templates,
                      [meta.key]: e.target.value,
                    })
                    rememberCaret(e.currentTarget)
                  }}
                  onFocus={(e) => {
                    setActiveStatusKey(meta.key)
                    rememberCaret(e.currentTarget)
                  }}
                  onClick={(e) => rememberCaret(e.currentTarget)}
                  onKeyUp={(e) => rememberCaret(e.currentTarget)}
                  onSelect={(e) => rememberCaret(e.currentTarget)}
                  maxLength={480}
                  disabled={saving}
                  aria-label={meta.title}
                />
              </div>
            ))}
            <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
              <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
                More (job pause texts)
              </summary>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Only used if you pause a job on the board. Most shops never tap these.
              </p>
              <div className="mt-2 space-y-3">
                {SMS_STATUS_TEMPLATE_META.filter((meta) =>
                  EXTRA_SMS_STATUS_KEYS.includes(meta.key)
                ).map((meta) => (
                  <div
                    key={meta.key}
                    className={cn(
                      "space-y-1.5 rounded-lg p-2",
                      activeStatusKey === meta.key && "ring-1 ring-amber-400/40"
                    )}
                  >
                    <p className="text-xs font-semibold text-amber-100/90">{meta.title}</p>
                    <p className="text-[11px] text-zinc-500">{meta.description}</p>
                    <textarea
                      ref={(el) => {
                        statusRefs.current[meta.key] = el
                      }}
                      rows={2}
                      className={fieldClass + " resize-y"}
                      value={settings.sms_status_templates[meta.key]}
                      onChange={(e) => {
                        patch("sms_status_templates", {
                          ...settings.sms_status_templates,
                          [meta.key]: e.target.value,
                        })
                        rememberCaret(e.currentTarget)
                      }}
                      onFocus={(e) => {
                        setActiveStatusKey(meta.key)
                        rememberCaret(e.currentTarget)
                      }}
                      onClick={(e) => rememberCaret(e.currentTarget)}
                      onKeyUp={(e) => rememberCaret(e.currentTarget)}
                      onSelect={(e) => rememberCaret(e.currentTarget)}
                      maxLength={480}
                      disabled={saving}
                      aria-label={meta.title}
                    />
                  </div>
                ))}
              </div>
            </details>
          </section>
        ) : null}

        {tab === "quick" ? (
          <section className="space-y-3 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Your saved texts</p>
                <p className="text-xs text-zinc-500">Reusable shortcuts when you text a customer.</p>
              </div>
              <button
                type="button"
                disabled={saving || settings.sms_custom_snippets.length >= MAX_CUSTOM_SNIPPETS}
                onClick={addSnippet}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
            {settings.sms_custom_snippets.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No custom texts yet. Tap Add — they show as extra chips in Messages.
              </p>
            ) : (
              <ul className="space-y-3">
                {settings.sms_custom_snippets.map((snip) => (
                  <li
                    key={snip.id}
                    className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={snip.label}
                        maxLength={40}
                        disabled={saving}
                        onChange={(e) => updateSnippet(snip.id, { label: e.target.value })}
                        placeholder="Short name"
                        className={cn(fieldClass, "flex-1")}
                        aria-label="Shortcut name"
                      />
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => removeSnippet(snip.id)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
                        aria-label={`Delete ${snip.label || "text"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={snip.body}
                      maxLength={480}
                      disabled={saving}
                      onChange={(e) => updateSnippet(snip.id, { body: e.target.value })}
                      placeholder="Message to send when you tap this shortcut…"
                      className={cn(fieldClass, "resize-y")}
                      aria-label={`${snip.label || "Custom"} message body`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="w-full shrink-0 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
  disabled: boolean
  active: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
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
