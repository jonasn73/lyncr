"use client"

// Answered-call intake sheet — opens on `call-initiated` (ringing) via Pusher, then upgrades on `call-answered`.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MapPin, Phone, PhoneOff } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { JobAddressAutocomplete } from "@/components/job-address-autocomplete"
import { VehicleIntakeClarificationsPanel } from "@/components/vehicle-intake-clarifications-panel"
import { VehicleKeyInfoPanel } from "@/components/vehicle-key-info-panel"
import { ServiceQuoteCalculatorPanel } from "@/components/dashboard/service-quote-calculator-panel"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  useInboundCallPanel,
} from "@/lib/inbound-call-panel-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useActiveCallForm,
  type ActiveCallRow,
  type ManualCallStatus,
} from "@/lib/hooks/use-active-call-form"
import type { ServiceQuoteTypeId } from "@/lib/service-quote-calculator"
import { formatQuoteDollars } from "@/lib/service-quote-calculator"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
import type {
  OwnerCallAnsweredPayload,
  OwnerCallCompletedPayload,
  OwnerCallInitiatedPayload,
} from "@/lib/realtime/owner-call-event-types"
import { isMissedCallTelemetry, talkSecondsFromCompletedPayload } from "@/lib/realtime/owner-call-event-types"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import {
  loadAnsweredIntakeDismissed,
  markAnsweredIntakeDismissed,
  subscribeAnsweredIntakeDismissed,
} from "@/lib/answered-call-intake-dismiss"
import { cn } from "@/lib/utils"

/** After ring, poll ringing + answered APIs — backup when Pusher is slow. */
const RINGING_LOOKUP_DELAYS_MS = [0, 50, 150, 350]
/** While a call is ringing, poll quickly until answered_at lands in Neon. */
const RINGING_FAST_POLL_MS = 250
const RINGING_FAST_POLL_MAX_MS = 90_000
/** Safety net when Pusher is slow — only while the dashboard tab is visible. */
const ANSWERED_VISIBILITY_POLL_MS = 800

function showCallRow(
  setCurrent: Dispatch<SetStateAction<ActiveCallRow | null>>,
  row: ActiveCallRow,
  dismissed: Set<string>
) {
  if (dismissed.has(row.id)) return
  setCurrent((prev) => {
    if (prev && dismissed.has(prev.id)) return null
    if (prev?.id === row.id) {
      return {
        ...prev,
        ...row,
        answered_at: row.answered_at ?? prev.answered_at,
        caller_name: row.caller_name ?? prev.caller_name,
      }
    }
    return row
  })
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

function rowFromInitiatedPayload(payload: OwnerCallInitiatedPayload): ActiveCallRow | null {
  const fromNumber = String(payload.from_number ?? "").trim()
  if (!fromNumber) return null
  const callLogId = String(payload.call_log_id ?? "").trim()
  const callSid = String(payload.call_sid ?? "").trim()
  const id = callLogId || (callSid ? `ring-${callSid}` : "")
  if (!id) return null
  return {
    id: callLogId || id,
    from_number: fromNumber,
    to_number: payload.to_number ?? "",
    caller_name: null,
    answered_at: null,
  }
}

function callLogRowFromApi(row: {
  id: string
  from_number: string
  to_number?: string | null
  caller_name?: string | null
  answered_at?: string | null
}): ActiveCallRow {
  return {
    id: row.id,
    from_number: row.from_number,
    to_number: row.to_number ?? "",
    caller_name: row.caller_name ?? null,
    answered_at: row.answered_at ?? null,
  }
}

function fetchFirstUnseenRingingCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/ringing-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) return callLogRowFromApi(row)
      }
      return null
    })
    .catch(() => null)
}

function fetchFirstUnseenAnsweredCall(seen: Set<string>): Promise<ActiveCallRow | null> {
  return fetch("/api/calls/answered-recent", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { calls: [] }))
    .then((data: { calls?: ActiveCallRow[] }) => {
      const calls = Array.isArray(data.calls) ? data.calls : []
      for (const row of calls) {
        if (!seen.has(row.id)) {
          return callLogRowFromApi(row)
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

export type CallAnsweredModalProps = {
  enabled: boolean
  ownerUserId?: string | null
}

export function CallAnsweredModal({ enabled, ownerUserId }: CallAnsweredModalProps) {
  const router = useRouter()
  const dismissedRef = useRef<Set<string>>(new Set())
  const ringAliasRef = useRef<string | null>(null)
  const [current, setCurrent] = useState<ActiveCallRow | null>(null)
  const [lostLeadState, setLostLeadState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [lostLeadError, setLostLeadError] = useState<string | null>(null)
  const [failureReason, setFailureReason] = useState("Price too high")
  const { activeOrganizationId } = useDashboardWorkspace()
  const { manualCallRow, patchManualCallRow, clearManualCallRow } = useInboundCallPanel()
  const effectiveCurrent = manualCallRow ?? current
  const {
    form,
    patchForm,
    setServiceQuoteTypeId,
    liveQuote,
    setVehicle,
    applyVehicleClarification,
    setVehicleKeySelection,
    setServiceAddress,
    commitAddressQuery,
    saveState,
    jobState,
    jobError,
    createJob,
    canDispatch,
    addressReady,
    dispatchBlockers,
    addressSeedQuery,
    answeredClarificationIds,
  } = useActiveCallForm(effectiveCurrent)

  useEffect(() => {
    if (!ownerUserId) return
    dismissedRef.current = loadAnsweredIntakeDismissed(ownerUserId)
    return subscribeAnsweredIntakeDismissed(ownerUserId, (ids) => {
      for (const id of ids) dismissedRef.current.add(id)
      setCurrent((prev) => (prev && dismissedRef.current.has(prev.id) ? null : prev))
    })
  }, [ownerUserId])

  useEffect(() => {
    if (!enabled || !ownerUserId) return

    dismissedRef.current = loadAnsweredIntakeDismissed(ownerUserId)

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

    const tryShowActiveCall = () => {
      void fetchFirstUnseenRingingCall(dismissedRef.current).then((ringing) => {
        if (cancelled) return
        if (ringing) {
          showCallRow(setCurrent, ringing, dismissedRef.current)
          return
        }
        void fetchFirstUnseenAnsweredCall(dismissedRef.current).then((answered) => {
          if (cancelled || !answered) return
          showCallRow(setCurrent, answered, dismissedRef.current)
          stopRingingFastPoll()
        })
      })
    }

    const startRingingFastPoll = () => {
      stopRingingFastPoll()
      tryShowActiveCall()
      ringingFastPollId = window.setInterval(() => {
        if (document.visibilityState !== "visible") return
        tryShowActiveCall()
      }, RINGING_FAST_POLL_MS)
      ringingFastPollStopId = window.setTimeout(() => {
        stopRingingFastPoll()
      }, RINGING_FAST_POLL_MAX_MS)
    }

    const scheduleRingingLookups = () => {
      startRingingFastPoll()
      for (const timer of lookupTimers) window.clearTimeout(timer)
      lookupTimers.length = 0
      for (const delayMs of RINGING_LOOKUP_DELAYS_MS) {
        lookupTimers.push(
          window.setTimeout(() => {
            if (cancelled) return
            tryShowActiveCall()
          }, delayMs)
        )
      }
    }

    tryShowActiveCall()

    const pollId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      tryShowActiveCall()
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

    const onInitiated = (payload: OwnerCallInitiatedPayload) => {
      const row = rowFromInitiatedPayload(payload)
      if (row) showCallRow(setCurrent, row, dismissedRef.current)
      scheduleRingingLookups()
    }

    const onAnswered = (payload: OwnerCallAnsweredPayload) => {
      const row = rowFromAnsweredPayload(payload)
      if (!row) return
      stopRingingFastPoll()
      setCurrent((prev) => {
        if (dismissedRef.current.has(row.id)) return null
        if (prev?.id.startsWith("ring-") && prev.from_number === row.from_number) {
          ringAliasRef.current = prev.id
        }
        return {
          ...row,
          caller_name: row.caller_name ?? prev?.caller_name ?? null,
        }
      })
    }

    const onCompleted = (payload: OwnerCallCompletedPayload) => {
      const row = rowFromCompletedPayload(payload)
      if (!row) return
      showCallRow(setCurrent, row, dismissedRef.current)
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

  const dismissCallIntake = useCallback(
    (row: ActiveCallRow | null) => {
      if (!row || !ownerUserId) return
      const ids = [row.id, ringAliasRef.current].filter((id): id is string => Boolean(id))
      markAnsweredIntakeDismissed(ownerUserId, ids)
      for (const id of ids) dismissedRef.current.add(id)
      ringAliasRef.current = null
    },
    [ownerUserId]
  )

  const dismissOnly = useCallback(() => {
    if (manualCallRow) {
      clearManualCallRow()
      setLostLeadState("idle")
      setLostLeadError(null)
      return
    }
    if (!current) return
    dismissCallIntake(current)
    const closedId = current.id
    setCurrent(null)
    void fetchFirstUnseenRingingCall(dismissedRef.current).then((ringing) => {
      if (ringing) {
        showCallRow(setCurrent, ringing, dismissedRef.current)
        return
      }
      void fetchFirstUnseenAnsweredCall(dismissedRef.current).then((row) => {
        if (!row || row.id === closedId) return
        showCallRow(setCurrent, row, dismissedRef.current)
      })
    })
  }, [current, dismissCallIntake, manualCallRow, clearManualCallRow])

  const confirmAndBook = useCallback(async () => {
    if (!effectiveCurrent || !ownerUserId) return
    const result = await createJob(activeOrganizationId)
    if (!result.ok) return
    if (manualCallRow) {
      clearManualCallRow()
    } else if (current) {
      dismissCallIntake(current)
      setCurrent(null)
    }
  }, [
    activeOrganizationId,
    clearManualCallRow,
    createJob,
    current,
    dismissCallIntake,
    effectiveCurrent,
    manualCallRow,
    ownerUserId,
  ])

  const sendToDispatch = useCallback(async () => {
    if (!effectiveCurrent || !ownerUserId) return
    const result = await createJob(activeOrganizationId)
    if (!result.ok) return
    if (manualCallRow) clearManualCallRow()
    else if (current) {
      dismissCallIntake(current)
      setCurrent(null)
    }
    router.push(buildSchedulerFocusUrl(result.leadId, { schedule: true }))
  }, [
    activeOrganizationId,
    clearManualCallRow,
    createJob,
    current,
    dismissCallIntake,
    effectiveCurrent,
    manualCallRow,
    ownerUserId,
    router,
  ])

  const logLostLead = useCallback(async () => {
    if (!effectiveCurrent || !ownerUserId) return
    setLostLeadState("saving")
    setLostLeadError(null)
    try {
      const res = await fetch("/api/leads/lost", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_log_id: effectiveCurrent.isManual ? null : effectiveCurrent.id,
          phone_number: form.phoneNumber.trim() || effectiveCurrent.from_number,
          last_quoted_price_cents: form.quotedPriceCents > 0 ? form.quotedPriceCents : null,
          failure_reason: failureReason,
          vehicle_year: form.vehicleYear,
          vehicle_make: form.vehicleMake,
          vehicle_model: form.vehicleModel,
          service_type: liveQuote.dispatchJobTypeLabel,
          organization_id: activeOrganizationId,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log lost lead")
      setLostLeadState("saved")
      window.setTimeout(() => dismissOnly(), 1200)
    } catch (e) {
      setLostLeadState("error")
      setLostLeadError(e instanceof Error ? e.message : "Could not log lost lead")
    }
  }, [
    activeOrganizationId,
    dismissOnly,
    effectiveCurrent,
    failureReason,
    form.phoneNumber,
    form.quotedPriceCents,
    form.vehicleMake,
    form.vehicleModel,
    form.vehicleYear,
    liveQuote.dispatchJobTypeLabel,
    ownerUserId,
  ])

  const setManualCallStatus = useCallback(
    (status: ManualCallStatus) => {
      patchManualCallRow({
        manualCallStatus: status,
        answered_at: status === "ringing" ? null : effectiveCurrent?.answered_at ?? new Date().toISOString(),
      })
    },
    [effectiveCurrent?.answered_at, patchManualCallRow]
  )

  if (!enabled && !manualCallRow) return null

  const isRinging =
    effectiveCurrent != null &&
    (effectiveCurrent.manualCallStatus === "ringing" ||
      (!effectiveCurrent.manualCallStatus && !effectiveCurrent.answered_at))
  const isManual = Boolean(effectiveCurrent?.isManual)

  return (
    <Sheet
      open={effectiveCurrent != null}
      onOpenChange={(o) => {
        if (!o) dismissOnly()
      }}
    >
      <SheetContent
        side="bottom"
        className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3"
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest("[data-address-suggestions]")) e.preventDefault()
        }}
      >
        {effectiveCurrent ? (
          <>
            <SheetHeader className="border-b border-border/60 px-4 pb-3 pt-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                {isManual ? "Manual call intake" : isRinging ? "Incoming call" : "Call answered"}
              </p>
              <SheetTitle className="flex items-center gap-2 text-left text-lg">
                <Phone
                  className={cn("h-5 w-5 shrink-0 text-primary", isRinging && "animate-pulse")}
                  aria-hidden
                />
                {formatPhoneDisplay(form.phoneNumber || effectiveCurrent.from_number)}
              </SheetTitle>
              <p className="text-left text-xs text-muted-foreground">
                {isManual
                  ? "Programmatic intake — edit phone, vehicle, and status like a live Telnyx event."
                  : isRinging
                    ? `Line ${formatPhoneDisplay(effectiveCurrent.to_number)} · ringing — start intake while the line connects.`
                    : `Line ${formatPhoneDisplay(effectiveCurrent.to_number)} · customer details save automatically.`}
              </p>
              {isManual ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="manual-call-status" className="text-xs">
                      Call status
                    </Label>
                    <Select
                      value={effectiveCurrent.manualCallStatus ?? "answered"}
                      onValueChange={(v) => setManualCallStatus(v as ManualCallStatus)}
                    >
                      <SelectTrigger id="manual-call-status" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ringing">Ringing</SelectItem>
                        <SelectItem value="answered">Answered</SelectItem>
                        <SelectItem value="on_hold">On hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </SheetHeader>

            <div className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto overflow-x-hidden px-4 py-3">
              <ServiceQuoteCalculatorPanel
                serviceTypeId={(form.serviceQuoteTypeId || "lockout") as ServiceQuoteTypeId}
                vehicleYear={form.vehicleYear}
                vehicleMake={form.vehicleMake}
                vehicleModel={form.vehicleModel}
                onServiceTypeChange={setServiceQuoteTypeId}
              />

              <fieldset className="grid gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                  Vehicle metadata
                </legend>
                <p className="text-[11px] text-primary/90">
                  Get the vehicle before the service address. Tap the customer&apos;s answers below.
                </p>
                <VehiclePickerCascade
                  value={{
                    vehicle_year: form.vehicleYear,
                    vehicle_make: form.vehicleMake,
                    vehicle_model: form.vehicleModel,
                  }}
                  onChange={setVehicle}
                />
                <VehicleIntakeClarificationsPanel
                  year={form.vehicleYear}
                  make={form.vehicleMake}
                  model={form.vehicleModel}
                  answeredIds={new Set(answeredClarificationIds)}
                  onAnswer={applyVehicleClarification}
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
              </fieldset>

              <fieldset className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary/90">
                  Job details
                </legend>
                <div className="space-y-1.5 overflow-visible">
                  <Label className="text-xs">
                    Service address <span className="text-primary">*</span>
                  </Label>
                  <JobAddressAutocomplete
                    value={form.serviceAddress}
                    onChange={setServiceAddress}
                    onQueryCommit={commitAddressQuery}
                    seedQuery={addressSeedQuery}
                    placeholder="Start typing street address…"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {addressReady
                      ? "Address ready — tap Send to dispatch map."
                      : "Type street + city, tap a suggestion, or tap out of the field when done."}
                  </p>
                </div>
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
              </fieldset>

              <fieldset className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                  Contact (saved to customer list)
                </legend>
                <div className="space-y-1.5">
                  <Label htmlFor="ac-display" className="text-xs">
                    Caller name <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="ac-display"
                    value={form.displayName}
                    onChange={(e) => patchForm({ displayName: e.target.value })}
                    placeholder="Ask before they hang up"
                    className="h-10"
                  />
                </div>
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
                </div>
              </fieldset>

              {jobState === "created" ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  Job added to the unassigned pool — pin will appear on your dispatch map.
                </p>
              ) : null}
              {lostLeadState === "saved" ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  Lost lead logged — recovery SMS will queue after 20 minutes.
                </p>
              ) : null}
              {jobError ? <p className="text-xs text-red-300">{jobError}</p> : null}
              {lostLeadError ? <p className="text-xs text-red-300">{lostLeadError}</p> : null}
            </div>

            <SheetFooter className="flex flex-col gap-2 border-t border-border/70 bg-secondary/15 px-4 py-3">
              <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quote before dispatch
                </p>
                <p className="text-base font-bold tabular-nums text-emerald-300">
                  {formatQuoteDollars(liveQuote.totalCents)}
                </p>
              </div>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2"
                disabled={jobState === "creating" || !canDispatch}
                onClick={() => void confirmAndBook()}
              >
                {jobState === "creating" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Confirm &amp; book
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full gap-2"
                disabled={jobState === "creating" || !canDispatch}
                onClick={() => void sendToDispatch()}
              >
                Send to dispatch map &amp; schedule
              </Button>
              {!canDispatch && jobState !== "creating" && dispatchBlockers.length > 0 ? (
                <p className="text-center text-[11px] text-amber-200/90">
                  Still needed: {dispatchBlockers.join(" · ")}
                </p>
              ) : null}
              <fieldset className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  Price-shopper recovery
                </legend>
                <div className="space-y-1.5">
                  <Label htmlFor="failure-reason" className="text-xs">
                    Failure reason
                  </Label>
                  <Select value={failureReason} onValueChange={setFailureReason}>
                    <SelectTrigger id="failure-reason" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Price too high">Price too high</SelectItem>
                      <SelectItem value="Abrupt hang-up">Abrupt hang-up</SelectItem>
                      <SelectItem value="Shopping competitors">Shopping competitors</SelectItem>
                      <SelectItem value="Will call back later">Will call back later</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full gap-2 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
                  disabled={lostLeadState === "saving"}
                  onClick={() => void logLostLead()}
                >
                  {lostLeadState === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <PhoneOff className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  Customer declined price / hang up
                </Button>
              </fieldset>
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
