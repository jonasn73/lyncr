"use client"

// Live intake Schedule step — ASAP or one day + From–To (same model as public /book).

import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import {
  buildBookDayOptions,
  buildBookTimeOptions,
  defaultBookTimeRange,
  formatBookAvailabilityLabel,
  isValidBookTimeRange,
} from "@/lib/book-customer-request"
import { cn } from "@/lib/utils"

const TIME_OPTIONS = buildBookTimeOptions(7, 19, 30)

type IntakeSchedulePreferenceValue = {
  scheduleUrgency: "" | "asap" | "window"
  scheduledDate: string
  scheduledTime: string
  availabilityFrom: string
  availabilityTo: string
}

type Props = {
  value: IntakeSchedulePreferenceValue
  onChange: (patch: Partial<IntakeSchedulePreferenceValue>) => void
  /** Compact copy under the title (address line, etc.). */
  subtitle?: string | null
  className?: string
}

export function IntakeSchedulePreferenceFields({
  value,
  onChange,
  subtitle,
  className,
}: Props) {
  const dayOptions = useMemo(() => buildBookDayOptions(), [])
  const windowReady =
    value.scheduleUrgency === "window" &&
    Boolean(value.scheduledDate.trim()) &&
    isValidBookTimeRange(value.availabilityFrom, value.availabilityTo)
  const availabilityLabel = windowReady
    ? formatBookAvailabilityLabel({
        dateKey: value.scheduledDate,
        fromHhmm: value.availabilityFrom,
        toHhmm: value.availabilityTo,
        dayShortLabel: dayOptions.find((d) => d.dateKey === value.scheduledDate)?.shortLabel,
      })
    : null

  const pickAsap = () => {
    onChange({ scheduleUrgency: "asap", scheduledTime: "" })
  }

  const pickWindow = () => {
    const range = defaultBookTimeRange()
    const date =
      value.scheduledDate.trim() || dayOptions[0]?.dateKey || ""
    const from = value.availabilityFrom.trim() || range.from
    const to = value.availabilityTo.trim() || range.to
    onChange({
      scheduleUrgency: "window",
      scheduledDate: date,
      availabilityFrom: from,
      availabilityTo: to,
      scheduledTime: from,
    })
  }

  return (
    <div className={cn("grid gap-3", className)}>
      <p className="text-micro font-semibold uppercase tracking-wide text-primary">
        Schedule
      </p>
      {subtitle ? (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Same as the customer book link — ASAP, or one day with a From–To window. Exact pin is
        set later in Scheduler.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-xs text-muted-foreground">Urgency</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={pickAsap}
            className={cn(
              "rounded-xl border px-3 py-3 text-left transition-colors",
              value.scheduleUrgency === "asap"
                ? "border-destructive/50 bg-destructive/15 text-destructive"
                : "border-border bg-card/40 text-foreground hover:border-primary/40"
            )}
          >
            <span className="block text-sm font-semibold">ASAP</span>
            <span className="mt-0.5 block text-2xs text-muted-foreground">
              Need help now
            </span>
          </button>
          <button
            type="button"
            onClick={pickWindow}
            className={cn(
              "rounded-xl border px-3 py-3 text-left transition-colors",
              value.scheduleUrgency === "window"
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border bg-card/40 text-foreground hover:border-primary/40"
            )}
          >
            <span className="block text-sm font-semibold">Schedule</span>
            <span className="mt-0.5 block text-2xs text-muted-foreground">
              Pick a window
            </span>
          </button>
        </div>
      </fieldset>

      {value.scheduleUrgency === "window" ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">Which day?</legend>
            <div className="grid grid-cols-2 gap-2">
              {dayOptions.map((day) => (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() =>
                    onChange({
                      scheduledDate: day.dateKey,
                      scheduledTime: value.availabilityFrom || value.scheduledTime,
                    })
                  }
                  className={cn(
                    "rounded-xl border px-3 py-3 text-left transition-colors",
                    value.scheduledDate === day.dateKey
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border bg-card/40 text-foreground hover:border-primary/40"
                  )}
                >
                  <span className="block text-sm font-semibold">{day.shortLabel}</span>
                  <span className="mt-0.5 block text-2xs text-muted-foreground">
                    {day.label.replace(/^Today · |^Next day · /, "")}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="intake-availability-from" className="text-xs">
                From
              </Label>
              <select
                id="intake-availability-from"
                value={value.availabilityFrom}
                onChange={(e) => {
                  const from = e.target.value
                  onChange({
                    availabilityFrom: from,
                    scheduledTime: from,
                  })
                }}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="intake-availability-to" className="text-xs">
                To
              </Label>
              <select
                id="intake-availability-to"
                value={value.availabilityTo}
                onChange={(e) => onChange({ availabilityTo: e.target.value })}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {windowReady && availabilityLabel ? (
            <p className="rounded-lg border border-border/70 bg-card/40 px-3 py-2 text-center text-sm text-foreground">
              Free: <span className="font-semibold text-primary">{availabilityLabel}</span>
            </p>
          ) : (
            <p className="text-center text-2xs text-destructive/90">
              Choose an end time after the start time.
            </p>
          )}
        </>
      ) : null}

      {value.scheduleUrgency === "asap" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
          Marked ASAP — soft request until you pin a time in Scheduler.
        </p>
      ) : null}
    </div>
  )
}
