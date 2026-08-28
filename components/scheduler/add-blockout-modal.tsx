"use client"

// Modal: add a full-day or time-range calendar blockout.

import { useMemo, useState } from "react"
import { Loader2, X } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import {
  defaultIntakeScheduleDate,
  scheduleTimeSlotOptions,
} from "@/lib/intake-schedule-helpers"
import type { ScheduleBlockout } from "@/lib/types"

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-zinc-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/40"

type AddBlockoutModalProps = {
  open: boolean
  onClose: () => void
  organizationId: string | null
  defaultDate: string
  onCreated: (row: ScheduleBlockout) => void
}

/**
 * Gate only. The form below mounts fresh on each open, so it picks up the
 * current `defaultDate` and clears any previous error without an effect.
 */
export function AddBlockoutModal({ open, ...rest }: AddBlockoutModalProps) {
  if (!open) return null
  return <AddBlockoutModalForm {...rest} />
}

function AddBlockoutModalForm({
  onClose,
  organizationId,
  defaultDate,
  onCreated,
}: Omit<AddBlockoutModalProps, "open">) {
  const timeOptions = useMemo(() => scheduleTimeSlotOptions(7, 19, 30), [])
  const [date, setDate] = useState(defaultDate || defaultIntakeScheduleDate())
  const [isFullDay, setIsFullDay] = useState(true)
  const [startTime, setStartTime] = useState("10:30")
  const [endTime, setEndTime] = useState("12:00")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/owner/scheduler/blockouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          isFullDay,
          is_full_day: isFullDay,
          startTime: isFullDay ? null : startTime,
          endTime: isFullDay ? null : endTime,
          reason: reason.trim() || null,
          organization_id: organizationId,
        }),
      })
      const json = (await res.json()) as {
        data?: ScheduleBlockout
        error?: string
        migration?: string
      }
      if (!res.ok) {
        setError(
          json.migration
            ? `Run ${json.migration} in Neon, then try again.`
            : json.error || "Could not save blockout"
        )
        return
      }
      if (json.data) onCreated(json.data)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save blockout")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close blockout modal"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="add-blockout-title"
        className="relative z-[1] flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="add-blockout-title" className="text-base font-semibold text-foreground">
            Add Blockout Time
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-zinc-900 hover:text-foreground",
              MOBILE_TAP_TARGET
            )}
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <label htmlFor="blockout-date" className="text-xs font-semibold text-zinc-300">
              Date
            </label>
            <input
              id="blockout-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cn(fieldClass, "h-11")}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Block Out Entire Day</p>
              <p className="text-2xs text-muted-foreground">
                When on, no booking or IVR slots are offered for this date.
              </p>
            </div>
            <Switch
              checked={isFullDay}
              onCheckedChange={setIsFullDay}
              aria-label="Block out entire day"
              className="shrink-0 data-[state=checked]:bg-amber-500"
            />
          </div>

          {!isFullDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label htmlFor="blockout-start" className="text-xs font-semibold text-zinc-300">
                  Start time
                </label>
                <select
                  id="blockout-start"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={cn(fieldClass, "h-11")}
                >
                  {timeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="blockout-end" className="text-xs font-semibold text-zinc-300">
                  End time
                </label>
                <select
                  id="blockout-end"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={cn(fieldClass, "h-11")}
                >
                  {timeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="blockout-reason" className="text-xs font-semibold text-zinc-300">
              Reason / label
            </label>
            <input
              id="blockout-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Doctor Appointment"
              className={cn(fieldClass, "h-11")}
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "flex-1 rounded-lg border border-zinc-700 text-sm font-semibold text-zinc-300 hover:bg-zinc-900",
              MOBILE_TAP_TARGET
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50",
              MOBILE_TAP_TARGET
            )}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save blockout
          </button>
        </div>
      </div>
    </div>
  )
}
