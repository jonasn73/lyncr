"use client"

// Live intake form that takes over the receptionist HUD the instant a call connects.
// Driven by the real-time `call-connected` payload; fields swap by business type.

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, PhoneCall, Check, X, Clock, AlertTriangle, Minus, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { FieldServiceFieldDef } from "@/lib/field-service-intake"
import type { ReceptionistCallerLookup } from "@/lib/types"
import {
  IndustryIntakeFormFields,
  intakeValuesComplete,
  serializeIntakeValues,
  type IntakeFormValues,
} from "@/components/industry-intake-form-fields"
import { buildFieldServiceSummary, intakeFieldsForProfile, intakeTitleForProfile } from "@/lib/field-service-intake"
import { resolveWorkspaceIntakeProfile } from "@/lib/workspace-intake-profile"

export type LiveCallSession = {
  callLogId: string
  /**
   * When the call was actually picked up. Null while it is still ringing.
   *
   * Separate from startedAt because the intake now opens on the first ring: counting
   * from startedAt would show ring time as talk time, and talk time is what a
   * receptionist is paid on.
   */
  answeredAt?: string | null
  businessType: "locksmith" | "detailing" | "auto_repair" | "generic"
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  startedAt: string
}

function intakeConfigFor(session: LiveCallSession) {
  const profile = resolveWorkspaceIntakeProfile({
    organizationName: session.businessName,
    callBusinessType: session.businessType,
  })
  return {
    profile,
    title: intakeTitleForProfile(profile),
    fields: intakeFieldsForProfile(profile),
  }
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const start = new Date(startedAt).getTime()
  const elapsed = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000))
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  return <span className="tabular-nums">{`${mm}:${ss.toString().padStart(2, "0")}`}</span>
}

function intakeDraftKey(callLogId: string): string {
  return `lyncr-intake-draft-${callLogId}`
}

type JobDisposition = "BOOKED" | "PENDING_TIME" | "PRICE_REJECTED" | "FAILED"

const DISPOSITION_MESSAGES: Record<JobDisposition, string> = {
  BOOKED: "Booked — the owner has been notified.",
  PENDING_TIME: "Pending time — added to the owner scheduler.",
  PRICE_REJECTED: "Logged as price-rejected — sent to the owner's salvage queue.",
  FAILED: "Logged as failed — the owner has been notified.",
}

/**
 * Intake broken into one screen per topic, in the order the owner console proved out:
 * what they need, then the vehicle, then the specifics, then where, then anything else.
 *
 * Membership comes from the `group` each field already declares, so adding a field to
 * lib/field-service-intake.ts puts it on the right screen without touching this file.
 * Address is pulled out of the `job` group into its own screen because it is the single
 * field most worth getting right and it deserves the room.
 */
const STEP_DEFS: { id: string; label: string; match: (f: FieldServiceFieldDef) => boolean }[] = [
  { id: "job", label: "Job", match: (f) => f.group === "job" && f.type !== "address" && f.name !== "job_notes" },
  { id: "vehicle", label: "Vehicle", match: (f) => f.group === "vehicle" },
  { id: "details", label: "Details", match: (f) => f.group === "locksmith" || f.group === "detailing" },
  { id: "address", label: "Address", match: (f) => f.type === "address" },
  { id: "notes", label: "Notes", match: (f) => f.name === "job_notes" || f.group === "scheduling" },
]

type IntakeStep = { id: string; label: string; fields: FieldServiceFieldDef[] }

/** Split a profile's fields into steps, dropping empty ones and losing nothing. */
function buildSteps(fields: FieldServiceFieldDef[]): IntakeStep[] {
  const claimed = new Set<string>()
  const steps: IntakeStep[] = []
  for (const def of STEP_DEFS) {
    const owned = fields.filter((f) => !claimed.has(f.name) && def.match(f))
    owned.forEach((f) => claimed.add(f.name))
    if (owned.length > 0) steps.push({ id: def.id, label: def.label, fields: owned })
  }
  // A field no rule claimed still has to be reachable, or it silently stops being
  // askable the moment someone adds one with a new group.
  const orphans = fields.filter((f) => !claimed.has(f.name))
  if (orphans.length > 0) {
    const notes = steps.find((s) => s.id === "notes")
    if (notes) notes.fields.push(...orphans)
    else steps.push({ id: "more", label: "More", fields: orphans })
  }
  return steps
}

const TONE_CLASS: Record<string, string> = {
  emerald: "border-success/40 bg-success/10 text-success",
  amber: "border-warning/40 bg-warning/10 text-warning",
  rose: "border-destructive/40 bg-destructive/10 text-destructive",
  sky: "border-info/40 bg-info/10 text-info",
  neutral: "border-border/50 bg-muted-foreground/10 text-foreground",
}

function usdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, cents) / 100)
}

/**
 * Who is calling, before she has to ask.
 *
 * The owner console has shown caller history for a while; the receptionist — the one
 * actually talking to them — had none of it, and opened every call as though it were
 * a stranger. Purely additive: a lookup that fails or finds nobody renders nothing
 * rather than a row of empty labels.
 */
function CallerContext({ callerNumber }: { callerNumber: string | null }) {
  const [lookup, setLookup] = useState<ReceptionistCallerLookup | null>(null)

  useEffect(() => {
    if (!callerNumber) return
    let cancelled = false
    fetch(`/api/receptionist/caller?number=${encodeURIComponent(callerNumber)}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("lookup"))))
      .then((json: { data?: ReceptionistCallerLookup }) => {
        if (!cancelled && json.data?.found) setLookup(json.data)
      })
      .catch(() => {
        // Context is a bonus. Never let it interrupt taking the call.
      })
    return () => {
      cancelled = true
    }
  }, [callerNumber])

  if (!lookup) return null

  const chips: string[] = []
  if (lookup.jobs_completed > 0) {
    chips.push(`${lookup.jobs_completed} job${lookup.jobs_completed === 1 ? "" : "s"} done`)
  }
  if (lookup.lifetime_revenue_cents > 0) chips.push(`${usdFromCents(lookup.lifetime_revenue_cents)} lifetime`)
  if (lookup.city) chips.push([lookup.city, lookup.region].filter(Boolean).join(", "))
  if (lookup.open_lead_count > 0) {
    chips.push(`${lookup.open_lead_count} open lead${lookup.open_lead_count === 1 ? "" : "s"}`)
  }
  if (lookup.has_open_book_form) chips.push("Booking form waiting")

  return (
    <div className="border-b border-success/20 bg-success/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-success">
          Returning customer
        </span>
        {lookup.display_name ? (
          <span className="text-sm font-semibold text-foreground">{lookup.display_name}</span>
        ) : null}
        {lookup.job_status_label ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-micro font-medium ${
              TONE_CLASS[lookup.job_status_tone ?? "neutral"] ?? TONE_CLASS.neutral
            }`}
          >
            {lookup.job_status_label}
          </span>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <p className="mt-1 text-2xs text-muted-foreground">{chips.join(" · ")}</p>
      ) : null}
    </div>
  )
}

export function ReceptionistLiveIntake({
  session,
  callerNameFallback,
  onDismiss,
}: {
  session: LiveCallSession
  callerNameFallback?: string | null
  onDismiss: (reason: "saved" | "dismissed") => void
}) {
  const config = intakeConfigFor(session)
  const [values, setValues] = useState<IntakeFormValues>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  // Collapsed to a bar rather than closed — she needs to look something up mid-call
  // without losing what she has typed, which is why the owner console has a PiP.
  const [minimized, setMinimized] = useState(false)

  const steps = useMemo(() => buildSteps(config.fields), [config.fields])
  const step = steps[Math.min(stepIndex, steps.length - 1)]
  const isLastStep = stepIndex >= steps.length - 1
  // Address is "the single field most worth getting right" (see buildSteps above) — shrink
  // the header chrome on that screen so the autocomplete gets more room, same idea as the
  // owner console's compact-on-deep-step header.
  const denseStep = step?.id === "address"
  // Gate Next on this screen's own required fields, so a missing answer four screens
  // later cannot block the one in front of her.
  const stepIncomplete = useMemo(
    () => (step ? !intakeValuesComplete(step.fields, values) : false),
    [step, values]
  )

  /**
   * A screen advances itself only when every answer on it is a tap.
   *
   * Free text has no moment of completion — a name is "done" after the first letter as
   * far as a required check knows, and jumping mid-word would be worse than a Next
   * button. Tap-only screens have an unambiguous last action to react to.
   */
  const stepAutoAdvances = useMemo(
    () => Boolean(step) && step.fields.every((f) => f.type !== "text" && f.type !== "textarea"),
    [step]
  )

  // Screens that have already advanced themselves. Going Back to one must not bounce
  // her straight forward again, which is what makes naive auto-advance unusable.
  const autoAdvancedRef = useRef<Set<number>>(new Set())
  // Whether this screen still had something to answer when she arrived. A screen that
  // was already complete — restored from a draft, or revisited — must sit still.
  const arrivedIncompleteRef = useRef(false)
  useEffect(() => {
    arrivedIncompleteRef.current = stepIncomplete
    // Deliberately only on step change: this records the state on ARRIVAL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])

  useEffect(() => {
    if (!stepAutoAdvances || isLastStep) return
    if (stepIncomplete) return
    if (!arrivedIncompleteRef.current) return
    if (autoAdvancedRef.current.has(stepIndex)) return

    // Long enough to see the option register, short enough to feel like it kept up.
    const timer = window.setTimeout(() => {
      autoAdvancedRef.current.add(stepIndex)
      setStepIndex((i) => Math.min(steps.length - 1, i + 1))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [stepAutoAdvances, stepIncomplete, isLastStep, stepIndex, steps.length])

  const callerName = session.callerName || callerNameFallback || null
  const callerNumber = session.callerNumber || null
  const draftKey = intakeDraftKey(session.callLogId)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as IntakeFormValues
      if (parsed && typeof parsed === "object") setValues(parsed)
    } catch {
      /* ignore corrupt draft */
    }
  }, [draftKey])

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(values))
    } catch {
      /* quota / private mode */
    }
  }, [draftKey, values])

  const setField = (name: string, value: string | boolean | import("@/lib/structured-address").StructuredAddress | null) =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const missingRequired = useMemo(
    () => !intakeValuesComplete(config.fields, values),
    [config.fields, values]
  )

  function buildSummary(): string {
    return buildFieldServiceSummary(serializeIntakeValues(values), { customerName: callerName })
  }

  // Job disposition → owner pipeline (BOOKED, PENDING_TIME, PRICE_REJECTED, FAILED).
  async function logJob(status: JobDisposition) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/receptionist/log-job", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId: session.callLogId,
          status,
          businessType: session.businessType,
          callerNumber,
          callerName,
          summary: buildSummary() || null,
          fields: serializeIntakeValues(values),
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log job")
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
      setSavedMsg(DISPOSITION_MESSAGES[status])
      window.setTimeout(() => onDismiss("saved"), 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error logging job")
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const summaryBits = buildSummary()
      const res = await fetch("/api/receptionist/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId: session.callLogId,
          businessType: session.businessType,
          callerNumber,
          callerName,
          summary: summaryBits || null,
          fields: serializeIntakeValues(values),
        }),
      })
      const json = (await res.json()) as { error?: string; data?: { sms_sent: boolean; sms_error: string | null } }
      if (!res.ok) throw new Error(json.error ?? "Could not save intake")
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
      setSavedMsg(
        json.data?.sms_sent
          ? json.data.sms_error
            ? "Saved — lead text accepted (delivery may be pending 10DLC)."
            : "Saved & lead text sent to the owner."
          : "Intake saved."
      )
      window.setTimeout(() => onDismiss("saved"), 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error saving intake")
    } finally {
      setSaving(false)
    }
  }

  const callerLabel = callerName || (callerNumber ? formatPhoneDisplay(callerNumber) : "Incoming caller")

  // Collapsed: a thin fixed bar that keeps the call visible and the draft alive.
  if (minimized) {
    return (
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[7020] border-t border-success/40 bg-success px-4 py-3 shadow-overlay",
          // The mobile bottom tab nav (ReceptionistPortalChrome) is also fixed to the
          // viewport edge below `sm`, so a flush bar here sat on top of it and blocked
          // Home / Calls / Earnings while a call was minimized. Float above the nav
          // there instead — sm+ has no bottom nav (header nav runs it), so it stays
          // pinned flush like before.
          "max-sm:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] max-sm:rounded-t-xl max-sm:border"
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
              <PhoneCall className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{callerLabel}</p>
              <p className="text-2xs text-success/70">
                {session.answeredAt ? "Intake in progress · " : "Ringing · "}
                <ElapsedTimer startedAt={session.answeredAt || session.startedAt} />
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="shrink-0 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success transition hover:bg-success"
          >
            Resume intake
          </button>
        </div>
      </div>
    )
  }

  return (
    <WorkspacePanel className="overflow-hidden border-success/40 bg-success/10 p-0">
      {/* Live call header — sticky so Minimize and Close stay reachable mid-scroll. */}
      <div
        className={cn(
          "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-success/30 bg-success/95 backdrop-blur",
          denseStep ? "px-4 py-3" : "px-4 py-4"
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "relative flex shrink-0 items-center justify-center rounded-full bg-success/20 text-success",
              denseStep ? "h-9 w-9" : "h-11 w-11"
            )}
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/30" />
            <PhoneCall className={cn("relative", denseStep ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
          </span>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-success/80">Call notepad / lead dispatcher</p>
            <p className="text-lg font-semibold text-foreground">
              {callerName || (callerNumber ? formatPhoneDisplay(callerNumber) : "Incoming caller")}
            </p>
            <p className="text-xs text-success/70">
              {callerNumber ? formatPhoneDisplay(callerNumber) : "Unknown number"}
              {session.businessName ? ` · ${session.businessName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Ringing and talking are different clocks. Showing one number from first
              ring would report ring time as talk time, which is what she is paid on. */}
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
              session.answeredAt
                ? "bg-success/15 text-success"
                : "bg-warning/15 text-warning"
            }`}
          >
            <span
              className={`h-2 w-2 animate-pulse rounded-full ${
                session.answeredAt ? "bg-success" : "bg-warning"
              }`}
            />
            {session.answeredAt ? null : <span className="text-2xs uppercase tracking-wide">Ringing</span>}
            <ElapsedTimer startedAt={session.answeredAt || session.startedAt} />
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label="Minimize intake"
            title="Minimize — keeps everything you have typed"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg border border-success/30 text-success transition hover:bg-success/15",
              denseStep ? "h-7 w-7" : "h-9 w-9"
            )}
          >
            <Minus className={cn(denseStep ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDismiss("dismissed")}
            disabled={saving}
            aria-label="Close intake"
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-lg border border-success/30 text-success transition hover:bg-destructive/20 hover:text-destructive disabled:opacity-50",
              denseStep ? "h-7 w-7" : "h-9 w-9"
            )}
          >
            <X className={cn(denseStep ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
          </button>
        </div>
      </div>

      <CallerContext callerNumber={callerNumber} />

      {/* Where she is, and how much is left. */}
      {steps.length > 1 ? (
        <div className="flex items-center gap-2 border-b border-success/20 px-4 py-2">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                autoAdvancedRef.current.add(i)
                setStepIndex(i)
              }}
              aria-current={i === stepIndex}
              className={`flex-1 rounded-full py-1 text-micro font-semibold uppercase tracking-wide transition ${
                i === stepIndex
                  ? "bg-success/25 text-success"
                  : i < stepIndex
                    ? "text-success/70 hover:bg-success/10"
                    : "text-muted-foreground hover:bg-success/5"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Intake form */}
      <div className="px-4 py-6">
        <h2 className="text-sm font-semibold text-foreground">
          {step ? step.label : config.title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {steps.length > 1
            ? `Step ${stepIndex + 1} of ${steps.length} — ask as you go, it saves as you type.`
            : "Fill this in while you talk — it texts the owner the moment you save."}
        </p>

        <div className="mt-4">
          <IndustryIntakeFormFields
            fields={step ? step.fields : config.fields}
            values={values}
            onChange={setField}
          />
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {savedMsg ? (
          <p className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {savedMsg}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          {/* How the call ended is the last question, not the first — asking it beside
              the vehicle year invites logging an outcome before there is one. */}
          <div className={`flex flex-wrap items-center gap-2 ${isLastStep ? "" : "hidden"}`}>
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Disposition:</span>
            <button
              type="button"
              onClick={() => void logJob("BOOKED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-semibold text-success transition hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden />
              Booked
            </button>
            <button
              type="button"
              onClick={() => void logJob("PENDING_TIME")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-sm font-semibold text-info transition hover:bg-info/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clock className="h-4 w-4" aria-hidden />
              Pending time
            </button>
            <button
              type="button"
              onClick={() => void logJob("PRICE_REJECTED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-semibold text-warning transition hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
              Price rejected
            </button>
            <button
              type="button"
              onClick={() => void logJob("FAILED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-muted-foreground/10 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Failed
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setStepIndex((i) => {
                    const previous = Math.max(0, i - 1)
                    // Disarm the screen she is going back to, so it does not throw her
                    // forward again the moment it renders complete.
                    autoAdvancedRef.current.add(previous)
                    return previous
                  })
                }
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-border/70 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Back
              </button>
            ) : null}
            {isLastStep ? (
              <button
                type="button"
                onClick={submit}
                disabled={saving || missingRequired || Boolean(savedMsg)}
                className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success transition hover:bg-success disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Save &amp; text owner
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                disabled={saving || stepIncomplete}
                className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success transition hover:bg-success disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    </WorkspacePanel>
  )
}
