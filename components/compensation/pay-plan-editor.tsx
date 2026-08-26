"use client"

// Owner-facing pay plan editor.
//
// Before this there was no UI for setting pay at all — only a PATCH endpoint — so
// rates were whatever the invite happened to carry. The editor builds the same
// component array the calculation engine reads, and shows the plan back as the one
// sentence that will appear in the worker's agreement.

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  DEFAULT_ANSWERED_CALL_MIN_SECONDS,
  MICROS_PER_DOLLAR,
  describePayPlan,
  dollarsToMicros,
  microsToDollars,
  secondsPerTimeUnit,
  validatePayComponents,
  type CommissionCondition,
  type EmploymentType,
  type PayComponent,
  type PayComponentKind,
  type TimeUnit,
} from "@/lib/compensation/plan-schema"

/** Who the plan is for, and what it currently says. */
export interface PayPlanTarget {
  kind: "receptionist" | "field_tech"
  id: string
  name: string
  employmentType: EmploymentType
  components: PayComponent[]
}

interface PayPlanEditorProps {
  target: PayPlanTarget | null
  onClose: () => void
  onSaved: (summary: string) => void
}

const EMPLOYMENT_CHOICES: { value: EmploymentType; label: string; hint: string }[] = [
  { value: "W2_EMPLOYEE", label: "Employee (W-2)", hint: "You withhold tax and owe minimum wage" },
  { value: "CONTRACTOR_1099", label: "Contractor (1099)", hint: "They invoice you and handle their own tax" },
  { value: "UNSPECIFIED", label: "Not set yet", hint: "Pick one before sending an agreement" },
]

const TIME_UNITS: { value: TimeUnit; label: string }[] = [
  { value: "SECOND", label: "second" },
  { value: "MINUTE", label: "minute" },
  { value: "HOUR", label: "hour" },
]

const CONDITIONS: CommissionCondition[] = ["BOOKED", "COMPLETED", "PAID"]

/** Sensible starting point for each kind, so an added rule is never invalid. */
function blankComponent(kind: PayComponentKind): PayComponent {
  switch (kind) {
    case "TIME":
      return { kind: "TIME", unit: "MINUTE", basis: "TALK", rate_micros: dollarsToMicros(0.25), min_billable_seconds: 0 }
    case "PER_EVENT":
      return {
        kind: "PER_EVENT",
        event: "ANSWERED_CALL",
        amount_micros: dollarsToMicros(2.5),
        min_billable_seconds: DEFAULT_ANSWERED_CALL_MIN_SECONDS,
      }
    case "COMMISSION":
      return { kind: "COMMISSION", rate_bps: 500, basis: "SUBTOTAL_EXCL_TAX", require: ["COMPLETED", "PAID"] }
    case "MINIMUM_WAGE_TOPUP":
      return { kind: "MINIMUM_WAGE_TOPUP", hourly_floor_micros: dollarsToMicros(7.25) }
  }
}

const ADD_CHOICES: { kind: PayComponentKind; label: string; blurb: string }[] = [
  { kind: "TIME", label: "Pay for time", blurb: "Per second, minute, or hour" },
  { kind: "PER_EVENT", label: "Flat amount", blurb: "Per answered call or completed job" },
  { kind: "COMMISSION", label: "Commission", blurb: "A share of what a job is worth" },
  { kind: "MINIMUM_WAGE_TOPUP", label: "Minimum wage floor", blurb: "Top up a slow shift (W-2 only)" },
]

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
const selectClass = cn(inputClass, "appearance-none")

/** Rate entry in dollars, kept as micros. Allows the sub-cent values a per-second rate needs. */
function MoneyInput({
  micros,
  onChange,
  label,
}: {
  micros: number
  onChange: (micros: number) => void
  label: string
}) {
  // Held as text so a half-typed "0." or a trailing zero survives keystrokes.
  const [text, setText] = useState(() => String(microsToDollars(micros)))
  const [lastMicros, setLastMicros] = useState(micros)

  // Resync during render when the stored value moves underneath us — switching a
  // rule's unit rewrites the rate, and the box has to follow. Adjusting here rather
  // than in an effect avoids a second render pass on every keystroke.
  if (micros !== lastMicros) {
    setLastMicros(micros)
    const current = Number(text)
    if (!Number.isFinite(current) || dollarsToMicros(current) !== micros) {
      setText(String(microsToDollars(micros)))
    }
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, "")
          setText(next)
          const parsed = Number(next)
          if (Number.isFinite(parsed) && parsed > 0) onChange(dollarsToMicros(parsed))
        }}
        className={cn(inputClass, "pl-6 tabular-nums")}
      />
    </div>
  )
}

/** What a time rate works out to per hour — the number that makes a wage floor real. */
function hourlyEquivalent(rateMicros: number, unit: TimeUnit): string {
  const perHour = (rateMicros / secondsPerTimeUnit(unit)) * 3600
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    perHour / MICROS_PER_DOLLAR
  )
}

function ComponentRow({
  component,
  onChange,
  onRemove,
}: {
  component: PayComponent
  onChange: (next: PayComponent) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {component.kind === "TIME" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28">
                  <MoneyInput
                    micros={component.rate_micros}
                    onChange={(rate_micros) => onChange({ ...component, rate_micros })}
                    label="Rate"
                  />
                </div>
                <span className="text-sm text-zinc-500">per</span>
                <select
                  value={component.unit}
                  aria-label="Time unit"
                  onChange={(e) => onChange({ ...component, unit: e.target.value as TimeUnit })}
                  className={cn(selectClass, "w-28")}
                >
                  {TIME_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-zinc-500">of</span>
                <select
                  value={component.basis}
                  aria-label="Time basis"
                  onChange={(e) =>
                    onChange({ ...component, basis: e.target.value as "TALK" | "ON_SHIFT" })
                  }
                  className={cn(selectClass, "w-32")}
                >
                  <option value="TALK">talk time</option>
                  <option value="ON_SHIFT">shift time</option>
                </select>
              </div>
              <p className="text-[11px] text-zinc-500">
                Works out to {hourlyEquivalent(component.rate_micros, component.unit)} per hour
                {component.basis === "TALK" ? " of actual talking" : " on shift"}.
                {component.basis === "ON_SHIFT" ? " Needs the shift clock, which is not live yet." : null}
              </p>
            </>
          ) : null}

          {component.kind === "PER_EVENT" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28">
                  <MoneyInput
                    micros={component.amount_micros}
                    onChange={(amount_micros) => onChange({ ...component, amount_micros })}
                    label="Amount"
                  />
                </div>
                <span className="text-sm text-zinc-500">per</span>
                <select
                  value={component.event}
                  aria-label="Paid event"
                  onChange={(e) =>
                    onChange({
                      ...component,
                      event: e.target.value as typeof component.event,
                    })
                  }
                  className={cn(selectClass, "w-40")}
                >
                  <option value="ANSWERED_CALL">answered call</option>
                  <option value="BOOKED_JOB">booked job</option>
                  <option value="COMPLETED_JOB">completed job</option>
                </select>
              </div>
              {component.event === "ANSWERED_CALL" ? (
                <label className="flex items-center gap-2 text-[11px] text-zinc-500">
                  Only calls lasting at least
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={component.min_billable_seconds ?? 0}
                    onChange={(e) =>
                      onChange({
                        ...component,
                        min_billable_seconds: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className={cn(inputClass, "w-16 py-1 tabular-nums")}
                  />
                  seconds
                </label>
              ) : null}
              {component.event === "BOOKED_JOB" || component.event === "COMPLETED_JOB" ? (
                <p className="text-[11px] text-amber-200/80">
                  For receptionists this needs booking attribution, which is not built yet.
                </p>
              ) : null}
            </>
          ) : null}

          {component.kind === "COMMISSION" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-24">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.25"
                    aria-label="Commission percent"
                    value={component.rate_bps / 100}
                    onChange={(e) =>
                      onChange({
                        ...component,
                        rate_bps: Math.round(Math.max(0, Number(e.target.value) || 0) * 100),
                      })
                    }
                    className={cn(inputClass, "pr-6 tabular-nums")}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
                    %
                  </span>
                </div>
                <span className="text-sm text-zinc-500">of</span>
                <select
                  value={component.basis}
                  aria-label="Commission basis"
                  onChange={(e) =>
                    onChange({ ...component, basis: e.target.value as typeof component.basis })
                  }
                  className={cn(selectClass, "w-48")}
                >
                  <option value="SUBTOTAL_EXCL_TAX">subtotal before tax</option>
                  <option value="LABOR_ONLY">labor only (parts excluded)</option>
                  <option value="COLLECTED_TOTAL">everything collected</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>Only when the job is</span>
                {CONDITIONS.map((condition) => {  
                  const on = component.require.includes(condition)
                  return (
                    <button
                      key={condition}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...component,
                          require: on
                            ? component.require.filter((c) => c !== condition)
                            : CONDITIONS.filter((c) => c === condition || component.require.includes(c)),
                        })
                      }
                      aria-pressed={on}
                      className={cn(
                        "rounded-md border px-2 py-0.5 font-medium transition-colors",
                        on
                          ? "border-primary/50 bg-primary/15 text-foreground"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {condition.toLowerCase()}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}

          {component.kind === "MINIMUM_WAGE_TOPUP" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28">
                  <MoneyInput
                    micros={component.hourly_floor_micros}
                    onChange={(hourly_floor_micros) => onChange({ ...component, hourly_floor_micros })}
                    label="Hourly floor"
                  />
                </div>
                <span className="text-sm text-zinc-500">per hour worked, at minimum</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Tops a slow shift up to this rate — it pays nothing extra on a busy one. Use whichever
                floor is highest where they work: federal, state, or city.
              </p>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this pay rule"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** A worker's live plan, as the roster rows need it. */
export interface RosterPlan {
  employment_type: EmploymentType
  components: PayComponent[]
  summary: string
}

/**
 * Live pay plans for the signed-in owner's roster, keyed by roster row id.
 *
 * Both Team panels read from one fetch — receptionists and techs come back together
 * because a plan is keyed by whichever roster row it belongs to.
 */
export function usePayPlans(organizationId?: string | null) {
  const [plans, setPlans] = useState<Record<string, RosterPlan>>({})

  const reload = useCallback(() => {
    const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : ""
    fetch(`/api/compensation/plans${query}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
      .then(
        (json: {
          data?: {
            receptionist_id: string | null
            field_technician_id: string | null
            employment_type: EmploymentType
            components: PayComponent[]
            summary: string
          }[]
        }) => {
          const next: Record<string, RosterPlan> = {}
          for (const plan of json.data ?? []) {
            const key = plan.receptionist_id ?? plan.field_technician_id
            if (!key) continue
            next[key] = {
              employment_type: plan.employment_type,
              components: plan.components,
              summary: plan.summary,
            }
          }
          setPlans(next)
        }
      )
      .catch(() => {
        // Pay is supplementary on the roster — a failed load must not blank the list.
      })
  }, [organizationId])

  useEffect(() => {
    reload()
  }, [reload])

  return { plans, reload }
}

/** Roster-row control: what this person is paid, and a way to change it. */
export function PayPlanButton({
  plan,
  onEdit,
  label,
}: {
  plan: RosterPlan | undefined
  onEdit: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Set pay for ${label}`}
      className="group min-w-0 max-w-full text-left"
    >
      <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        Pay
      </span>
      <span
        className={cn(
          "block truncate text-[11px] underline-offset-2 group-hover:underline",
          plan ? "text-zinc-300" : "text-amber-300/90"
        )}
      >
        {plan?.summary ?? "Not set — tap to set"}
      </span>
    </button>
  )
}

interface PlanCostPreview {
  windowDays: number
  calls: { count: number; talkSeconds: number; cents: number }
  jobs: { count: number; cents: number; capped: boolean }
  productionCents: number
  floor: {
    available: boolean
    reason?: string
    weeklyHours: number
    hoursSource: "tracked" | "assumed"
    weeks: number
    topUpCents: number
  }
  totalCents: number
  effectiveHourlyCents: number | null
}

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

/** Talk time, in the unit that does not round it away. Under a minute reads as seconds. */
function talkTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s talking`
  return `${Math.round(seconds / 60)} min talking`
}

/**
 * What this plan would have cost over the worker's real recent history.
 *
 * The point is to answer "can I afford this" before anyone signs to it, so the number
 * comes from the calls they actually answered rather than a model. Hours are the one
 * thing history may not have — until the shift clock has data, the owner supplies an
 * assumption and the panel says plainly that it is one.
 */
function PlanCostPanel({
  target,
  components,
  employmentType,
}: {
  target: PayPlanTarget
  components: PayComponent[]
  employmentType: EmploymentType
}) {
  const [preview, setPreview] = useState<PlanCostPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [weeklyHours, setWeeklyHours] = useState(10)

  const payload = useMemo(
    () =>
      JSON.stringify({
        [target.kind === "receptionist" ? "receptionist_id" : "field_technician_id"]: target.id,
        employment_type: employmentType,
        components,
        window_days: 30,
        assumed_weekly_hours: weeklyHours,
      }),
    [target, employmentType, components, weeklyHours]
  )

  useEffect(() => {
    let cancelled = false
    // Debounced: the plan changes on every keystroke in a rate box. The spinner is
    // turned on inside the timer rather than in the effect body, so a burst of typing
    // does not flicker it on and off between renders.
    const timer = setTimeout(() => {
      setLoading(true)
      fetch("/api/compensation/plans/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("preview"))))
        .then((json: { data?: PlanCostPreview }) => {
          if (cancelled) return
          setPreview(json.data ?? null)
          setFailed(false)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [payload])

  const showHoursInput =
    employmentType === "W2_EMPLOYEE" && components.some((c) => c.kind === "MINIMUM_WAGE_TOPUP")

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Last 30 days, this plan would have cost
        </p>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-zinc-600" aria-hidden /> : null}
      </div>

      {failed ? (
        <p className="text-xs text-zinc-500">Couldn&apos;t price this plan right now.</p>
      ) : preview ? (
        <>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {usd(preview.totalCents)}
          </p>

          <div className="space-y-0.5 text-[11px] text-zinc-400">
            {preview.calls.count > 0 ? (
              <p>
                {preview.calls.count} answered call{preview.calls.count === 1 ? "" : "s"} ·{" "}
                {talkTime(preview.calls.talkSeconds)} ·{" "}
                <span className="tabular-nums text-zinc-300">{usd(preview.calls.cents)}</span>
              </p>
            ) : null}
            {preview.jobs.count > 0 ? (
              <p>
                {preview.jobs.count} completed job{preview.jobs.count === 1 ? "" : "s"}
                {preview.jobs.capped ? "+" : ""} ·{" "}
                <span className="tabular-nums text-zinc-300">{usd(preview.jobs.cents)}</span>
              </p>
            ) : null}
            {preview.calls.count === 0 && preview.jobs.count === 0 ? (
              <p>No calls or jobs in the last 30 days to price this against.</p>
            ) : null}
            {preview.floor.available && preview.floor.topUpCents > 0 ? (
              <p className="text-amber-200/90">
                + {usd(preview.floor.topUpCents)} to reach the wage floor across{" "}
                {preview.floor.weeks} week{preview.floor.weeks === 1 ? "" : "s"}
              </p>
            ) : null}
            {preview.floor.available && preview.floor.topUpCents === 0 ? (
              <p className="text-zinc-500">
                Production clears the wage floor — no top-up at {preview.floor.weeklyHours} h/week.
              </p>
            ) : null}
            {preview.effectiveHourlyCents !== null ? (
              <p className="text-zinc-500">
                Works out to {usd(preview.effectiveHourlyCents)} per hour on duty.
              </p>
            ) : null}
          </div>

          {showHoursInput ? (
            <label className="flex items-center gap-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
              {preview.floor.hoursSource === "tracked" ? (
                <span>
                  Using {preview.floor.weeklyHours} tracked hours a week.
                </span>
              ) : (
                <>
                  <span>Assume they&apos;re on duty</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    value={weeklyHours}
                    aria-label="Assumed hours on duty per week"
                    onChange={(e) =>
                      setWeeklyHours(Math.max(0, Math.min(60, Number(e.target.value) || 0)))
                    }
                    className={cn(inputClass, "w-14 py-0.5 tabular-nums")}
                  />
                  <span>hours a week</span>
                </>
              )}
            </label>
          ) : null}

          {showHoursInput && preview.floor.hoursSource === "assumed" ? (
            <p className="text-[10px] leading-relaxed text-zinc-600">
              An estimate, not a measurement — nobody&apos;s hours are tracked yet. The real floor
              is worked out per week from what they actually earned that week.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-zinc-500">Pricing…</p>
      )}
    </div>
  )
}

/**
 * The form itself, mounted fresh per worker.
 *
 * Keying on the target rather than syncing state from it in an effect means opening
 * a second person's pay can never show the first person's rules mid-render.
 */
function PayPlanForm({
  target,
  onClose,
  onSaved,
}: {
  target: PayPlanTarget
  onClose: () => void
  onSaved: (summary: string) => void
}) {
  const [employmentType, setEmploymentType] = useState<EmploymentType>(target.employmentType)
  const [components, setComponents] = useState<PayComponent[]>(target.components)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const validation = useMemo(
    () => validatePayComponents(components, { employmentType }),
    [components, employmentType]
  )

  const summary = useMemo(() => describePayPlan(components), [components])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/compensation/plans", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [target.kind === "receptionist" ? "receptionist_id" : "field_technician_id"]: target.id,
          employment_type: employmentType,
          components,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { summary?: string }
      }
      if (!res.ok) throw new Error(json.error ?? "Could not save this pay plan")
      onSaved(json.data?.summary ?? summary)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this pay plan")
    } finally {
      setSaving(false)
    }
  }, [target, employmentType, components, summary, onSaved, onClose])

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay for {target.name}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Changing pay starts a new version. What they have already earned keeps the rate it was
            earned at.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              How they work for you
            </p>
            <div className="grid gap-1.5">
              {EMPLOYMENT_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setEmploymentType(choice.value)}
                  aria-pressed={employmentType === choice.value}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    employmentType === choice.value
                      ? "border-primary/50 bg-primary/10"
                      : "border-zinc-800 hover:border-zinc-700"
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">{choice.label}</span>
                  <span className="block text-[11px] text-zinc-500">{choice.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pay rules</p>
            {components.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                No pay rules yet. Add one below.
              </p>
            ) : (
              components.map((component, index) => (
                <ComponentRow
                  key={`${component.kind}-${index}`}
                  component={component}
                  onChange={(next) =>
                    setComponents((prev) => prev.map((c, i) => (i === index ? next : c)))
                  }
                  onRemove={() => setComponents((prev) => prev.filter((_, i) => i !== index))}
                />
              ))
            )}

            {adding ? (
              <div className="grid gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
                {ADD_CHOICES.map((choice) => (
                  <button
                    key={choice.kind}
                    type="button"
                    onClick={() => {
                      setComponents((prev) => [...prev, blankComponent(choice.kind)])
                      setAdding(false)
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-900"
                  >
                    <span className="block text-sm text-foreground">{choice.label}</span>
                    <span className="block text-[11px] text-zinc-500">{choice.blurb}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add a pay rule
              </button>
            )}
          </div>

          {components.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                They will be paid
              </p>
              <p className="mt-1 text-sm text-foreground">{summary}</p>
            </div>
          ) : null}

          {components.length > 0 && validation.errors.length === 0 ? (
            <PlanCostPanel
              target={target}
              components={components}
              employmentType={employmentType}
            />
          ) : null}

          {validation.errors.map((message) => (
            <p
              key={message}
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {message}
            </p>
          ))}
          {validation.warnings.map((message) => (
            <p
              key={message}
              className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {message}
            </p>
          ))}
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || validation.errors.length > 0 || components.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {saving ? "Saving…" : "Save pay"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Opens the pay editor for whichever roster row the owner picked. */
export function PayPlanEditor({ target, onClose, onSaved }: PayPlanEditorProps) {
  if (!target) return null
  return (
    <PayPlanForm
      key={`${target.kind}:${target.id}`}
      target={target}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}
