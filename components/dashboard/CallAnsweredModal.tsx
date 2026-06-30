"use client"

// Answered-call intake sheet — listens on owner-{userId} Pusher `call-answered`
// (broadcast from carrier answer webhooks via lib/inbound-call-answered-broadcast.ts).

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import Link from "next/link"
import { Loader2, MapPin, Phone } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { JobAddressAutocomplete } from "@/components/job-address-autocomplete"
import { VehicleKeyInfoPanel } from "@/components/vehicle-key-info-panel"
import { INTAKE_LOCKSMITH_JOB_TYPES } from "@/lib/intake-job-types"
import { cn } from "@/lib/utils"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useActiveCallForm,
  type ActiveCallRow,
} from "@/lib/hooks/use-active-call-form"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import { isMissedCallTelemetry, talkSecondsFromCompletedPayload } from "@/lib/realtime/owner-call-event-types"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"

const SEEN_KEY = "zing_answered_customer_popup_seen_v1"
/** After ring, check answered-recent — triggered by call-initiated (backup to Pusher). */
const ANSWERED_LOOKUP_DELAYS_MS = [50, 150, 350, 700]
/** While a call is ringing, poll quickly until answered_at lands in Neon. */
const RINGING_FAST_POLL_MS = 250
const RINGING_FAST_POLL_MAX_MS = 90_000
/** Safety net when Pusher is slow — only while the dashboard tab is visible. */
const ANSWERED_VISIBILITY_POLL_MS = 800

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function persistSeen(s: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-100)))
  } catch {
    /* ignore quota */
  }
}

function rowFromAnsweredPayload(payload: OwnerCallAnsweredPayload): ActiveCallRow | null {
  const callLogId = String(payload.call_log_id ?? "").trim()
  const fromNumber = String(payload.from_number ?? "").trim()
  if (!callLogId || !fromNumber) return null
  return {
    id: callLogId,
    from_number: fromNumber,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: payload.answered_at ?? new Date().toISOString(),
  }
}

function fetchFirstUnseenAnsweredCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/answered-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) {
          return {
            id: row.id,
            from_number: row.from_number,
            to_number: row.to_number ?? "",
            caller_name: row.caller_name ?? null,
            answered_at: row.answered_at ?? null,
          }
        }
      }
      return null
    })
    .catch(() => null)
}

function rowFromCompletedPayload(payload: OwnerCallCompletedPayload): ActiveCallRow | null {
  if (!payload.call_log_id || !payload.from_number) return null
  if (isMissedCallTelemetry(payload)) return null
  if (talkSecondsFromCompletedPayload(payload) <= 0) return null
  return {
    id: payload.call_log_id,
    from_number: payload.from_number,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: new Date().toISOString(),
  }
}

function showCallRow(
  setCurrent: Dispatch<SetStateAction<ActiveCallRow | null>>,
  row: ActiveCallRow,
  seen: Set<string>
) {
  if (seen.has(row.id)) return
  setCurrent((prev) => {
    // Keep the same row object while this call is open so typing isn't wiped by polls.
    if (prev?.id === row.id) return prev
    return row
  })
}

export type CallAnsweredModalProps = {
  enabled: boolean
  ownerUserId?: string | null
}

export function CallAnsweredModal({ enabled, ownerUserId }: CallAnsweredModalProps) {
  const seenRef = useRef(loadSeen())
  const [current, setCurrent] = useState<ActiveCallRow | null>(null)
  const { activeOrganizationId } = useDashboardWorkspace()
  const {
    form,
    patchForm,
    setVehicle,
    setVehicleKeySelection,
    setServiceAddress,
    saveState,
    jobState,
    jobError,
    createJob,
    canDispatch,
    addressReady,
  } = useActiveCallForm(current)

  useEffect(() => {
    if (!enabled || !ownerUserId) return

    let cancelled = false
    const lookupTimers: ReturnType<typeof window.setTimeout>[] = []
    let ringingFastPollId: ReturnType<typeof window.setInterval> | null = null
    let ringingFastPollStopId: ReturnType<typeof window.setTimeout> | null = null

    const stopRingingFastPoll = () => {
      if (ringingFastPollId != null) {
        window.clearInterval(ringingFastPollId)
        ringingFastPollId = null
      }
      if (ringingFastPollStopId != null) {
        window.clearTimeout(ringingFastPollStopId)
        ringingFastPollStopId = null
      }
    }

    const tryShowAnsweredCall = () => {
      void fetchFirstUnseenAnsweredCall(seenRef.current).then((row) => {
        if (cancelled || !row) return
        showCallRow(setCurrent, row, seenRef.current)
        stopRingingFastPoll()
      })
    }

    const startRingingFastPoll = () => {
      stopRingingFastPoll()
      tryShowAnsweredCall()
      ringingFastPollId = window.setInterval(() => {
        if (document.visibilityState !== "visible") return
        tryShowAnsweredCall()
      }, RINGING_FAST_POLL_MS)
      ringingFastPollStopId = window.setTimeout(() => {
        stopRingingFastPoll()
      }, RINGING_FAST_POLL_MAX_MS)
    }

    const scheduleAnsweredLookups = () => {
      startRingingFastPoll()
      for (const timer of lookupTimers) window.clearTimeout(timer)
      lookupTimers.length = 0
      for (const delayMs of ANSWERED_LOOKUP_DELAYS_MS) {
        lookupTimers.push(
          window.setTimeout(() => {
            if (cancelled) return
            tryShowAnsweredCall()
          }, delayMs)
        )
      }
    }

    tryShowAnsweredCall()

    const pollId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      tryShowAnsweredCall()
    }, ANSWERED_VISIBILITY_POLL_MS)

    if (!isRealtimeClientConfigured()) {
      return () => {
        cancelled = true
        stopRingingFastPoll()
        window.clearInterval(pollId)
        for (const timer of lookupTimers) window.clearTimeout(timer)
      }
    }

    const pusher = getPusherClient()
    if (!pusher) {
      return () => {
        cancelled = true
        stopRingingFastPoll()
        window.clearInterval(pollId)
        for (const timer of lookupTimers) window.clearTimeout(timer)
      }
    }

    const channelName = `owner-${ownerUserId}`
    const channel = pusher.subscribe(channelName)

    const onInitiated = (_payload: OwnerCallInitiatedPayload) => {
      scheduleAnsweredLookups()
    }

    const onAnswered = (payload: OwnerCallAnsweredPayload) => {
      const row = rowFromAnsweredPayload(payload)
      if (!row) return
      stopRingingFastPoll()
      showCallRow(setCurrent, row, seenRef.current)
    }

    const onCompleted = (payload: OwnerCallCompletedPayload) => {
      const row = rowFromCompletedPayload(payload)
      if (!row) return
      showCallRow(setCurrent, row, seenRef.current)
    }

    channel.bind("call-initiated", onInitiated)
    channel.bind("call-answered", onAnswered)
    channel.bind("call-completed", onCompleted)
    return () => {
      cancelled = true
      stopRingingFastPoll()
      window.clearInterval(pollId)
      for (const timer of lookupTimers) window.clearTimeout(timer)
      channel.unbind("call-initiated", onInitiated)
      channel.unbind("call-answered", onAnswered)
      channel.unbind("call-completed", onCompleted)
    }
  }, [enabled, ownerUserId])

  useEffect(() => {
    if (!enabled) setCurrent(null)
  }, [enabled])

  const dismissOnly = useCallback(() => {
    if (!current) return
    seenRef.current.add(current.id)
    persistSeen(seenRef.current)
    const closedId = current.id
    setCurrent(null)
    void fetchFirstUnseenAnsweredCall(seenRef.current).then((row) => {
      if (!row || row.id === closedId) return
      showCallRow(setCurrent, row, seenRef.current)
    })
  }, [current])

  const sendToDispatch = useCallback(async () => {
    if (!current) return
    const ok = await createJob(activeOrganizationId)
    if (!ok) return
    dismissOnly()
  }, [activeOrganizationId, createJob, current, dismissOnly])

  if (!enabled) return null

  return (
    <Sheet
      open={current != null}
      onOpenChange={(o) => {
        if (!o) dismissOnly()
      }}
    >
      <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
        {current ? (
          <>
            <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Call answered</p>
              <SheetTitle className="flex items-center gap-2 text-left text-lg">
                <Phone className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                {formatPhoneDisplay(current.from_number)}
              </SheetTitle>
              <p className="text-left text-xs text-muted-foreground">
                Line {formatPhoneDisplay(current.to_number)} · customer details save automatically.
              </p>
            </SheetHeader>

            <div className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto overflow-x-hidden px-4 py-3">
              <fieldset className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary/90">
                  Vehicle details
                </legend>
                <VehiclePickerCascade
                  value={{
                    vehicle_year: form.vehicleYear,
                    vehicle_make: form.vehicleMake,
                    vehicle_model: form.vehicleModel,
                  }}
                  onChange={setVehicle}
                />
                <VehicleKeyInfoPanel
                  year={form.vehicleYear}
                  make={form.vehicleMake}
                  model={form.vehicleModel}
                  value={
                    form.keyFccId
                      ? {
                          profileId: form.keyProfileId,
                          fccId: form.keyFccId,
                          frequency: form.keyFrequency || null,
                          chipset: form.keyChipset || null,
                          keyStyle: form.keyStyle || "Not sure yet",
                          variantId: form.keyVariantId || null,
                        }
                      : null
                  }
                  onChange={(sel) => setVehicleKeySelection(sel)}
                />
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-foreground">What do they need?</span>
                  <select
                    className={cn(
                      "h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground",
                      "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    )}
                    value={form.jobType}
                    onChange={(e) => patchForm({ jobType: e.target.value })}
                  >
                    <option value="">Select service type…</option>
                    {INTAKE_LOCKSMITH_JOB_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="ac-notes" className="text-xs">
                  Job notes
                </Label>
                <Input
                  id="ac-notes"
                  value={form.notes}
                  onChange={(e) => patchForm({ notes: e.target.value })}
                  placeholder="Gate code, spare location, details…"
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5 overflow-visible">
                <Label className="text-xs">Service address</Label>
                <JobAddressAutocomplete
                  value={form.serviceAddress}
                  onChange={setServiceAddress}
                  placeholder="Start typing street address…"
                />
                <p className="text-[10px] text-muted-foreground">
                  {addressReady
                    ? "Address verified — ready for dispatch map pin."
                    : "Pick a suggested address (street, city, ZIP) to place the job on your map."}
                </p>
              </div>

              <fieldset className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                  Contact (saved to customer list)
                </legend>
                <div className="space-y-1.5">
                  <Label htmlFor="ac-phone" className="text-xs">
                    Phone number
                  </Label>
                  <Input
                    id="ac-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phoneNumber}
                    onChange={(e) => patchForm({ phoneNumber: e.target.value })}
                    placeholder="(502) 555-1234"
                    className="h-10 font-mono text-base"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Change this to look up a repeat caller by number.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ac-display" className="text-xs">
                    Caller name
                  </Label>
                  <Input
                    id="ac-display"
                    value={form.displayName}
                    onChange={(e) => patchForm({ displayName: e.target.value })}
                    placeholder="Ask before they hang up"
                    className="h-10"
                  />
                </div>
              </fieldset>

              {jobState === "created" ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  Job added to the unassigned pool — pin will appear on your dispatch map.
                </p>
              ) : null}
              {jobError ? <p className="text-xs text-red-300">{jobError}</p> : null}
            </div>

            <SheetFooter className="flex flex-col gap-2 border-t border-border/70 bg-secondary/15 px-4 py-3">
              <Button
                type="button"
                size="lg"
                className="w-full gap-2"
                disabled={jobState === "creating" || !canDispatch}
                onClick={() => void sendToDispatch()}
              >
                {jobState === "creating" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Send to dispatch map
              </Button>
              <div className="flex w-full items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {saveState === "saving" ? "Saving customer…" : null}
                  {saveState === "saved" ? "Customer saved." : null}
                  {saveState === "error" ? "Customer save failed." : null}
                  {saveState === "idle" ? "Customer saves automatically." : null}{" "}
                  <Link href="/dashboard/customers" className="font-semibold text-primary underline-offset-2 hover:underline">
                    Customers
                  </Link>
                </p>
                <Button type="button" variant="ghost" size="sm" disabled={jobState === "creating"} onClick={dismissOnly}>
                  Dismiss
                </Button>
              </div>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
