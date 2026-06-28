"use client"

// Answered-call intake sheet — vehicle cascade, CRM autosave, unassigned job pool on dismiss.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, Loader2, Phone } from "lucide-react"
import { VehiclePickerCascade } from "@/components/vehicle-picker-cascade"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  useActiveCallForm,
  type ActiveCallRow,
} from "@/lib/hooks/use-active-call-form"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
import type { OwnerCallCompletedPayload } from "@/lib/realtime/owner-call-event-types"
import { isMissedCallTelemetry, talkSecondsFromCompletedPayload } from "@/lib/realtime/owner-call-event-types"
import { cn } from "@/lib/utils"

const SEEN_KEY = "zing_answered_customer_popup_seen_v1"

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
  const seenRef = useRef(loadSeen())
  const [current, setCurrent] = useState<ActiveCallRow | null>(null)
  const { activeOrganizationId } = useDashboardWorkspace()
  const {
    form,
    patchForm,
    setVehicle,
    moreOpen,
    setMoreOpen,
    saveState,
    jobState,
    jobError,
    createJob,
  } = useActiveCallForm(current)

  useEffect(() => {
    if (!enabled || !ownerUserId) return

    if (isRealtimeClientConfigured()) {
      const pusher = getPusherClient()
      if (!pusher) return
      const channel = pusher.subscribe(`owner-${ownerUserId}`)

      const onCompleted = (payload: OwnerCallCompletedPayload) => {
        const row = rowFromCompletedPayload(payload)
        if (!row || seenRef.current.has(row.id)) return
        setCurrent((prev) => prev ?? row)
      }

      channel.bind("call-completed", onCompleted)
      return () => {
        channel.unbind("call-completed", onCompleted)
        pusher.unsubscribe(`owner-${ownerUserId}`)
      }
    }

    let cancelled = false
    fetch("/api/calls/answered-recent", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { calls: [] }))
      .then((data: { calls?: ActiveCallRow[] }) => {
        if (cancelled) return
        const calls = Array.isArray(data.calls) ? data.calls : []
        for (const row of calls) {
          if (!seenRef.current.has(row.id)) {
            setCurrent((prev) => prev ?? row)
            break
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled, ownerUserId])

  useEffect(() => {
    if (!enabled) setCurrent(null)
  }, [enabled])

  const closeAndAdvance = useCallback(async () => {
    if (!current) return
    if (form.displayName.trim()) {
      await createJob(activeOrganizationId)
    }
    seenRef.current.add(current.id)
    persistSeen(seenRef.current)
    const closedId = current.id
    setCurrent(null)
    if (!isRealtimeClientConfigured()) return
    void fetch("/api/calls/answered-recent", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { calls: [] }))
      .then((data: { calls?: ActiveCallRow[] }) => {
        const calls = Array.isArray(data.calls) ? data.calls : []
        for (const row of calls) {
          if (row.id === closedId) continue
          if (!seenRef.current.has(row.id)) {
            setCurrent(row)
            return
          }
        }
      })
  }, [activeOrganizationId, createJob, current, form.displayName])

  if (!enabled) return null

  return (
    <Sheet
      open={current != null}
      onOpenChange={(o) => {
        if (!o) void closeAndAdvance()
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
                Line {formatPhoneDisplay(current.to_number)} · details save automatically to your customer list.
              </p>
            </SheetHeader>

            <div className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto px-4 py-3">
              <div className="space-y-1.5">
                <Label htmlFor="ac-display" className="text-xs">
                  Name
                </Label>
                <Input
                  id="ac-display"
                  value={form.displayName}
                  onChange={(e) => patchForm({ displayName: e.target.value })}
                  placeholder="Caller name"
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ac-company" className="text-xs">
                  Company
                </Label>
                <Input
                  id="ac-company"
                  value={form.companyName}
                  onChange={(e) => patchForm({ companyName: e.target.value })}
                  placeholder="Optional"
                  className="h-10"
                />
              </div>

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
              </fieldset>

              <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs font-semibold text-foreground"
                  >
                    Address &amp; more
                    <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3 data-[state=closed]:animate-none">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Street</Label>
                    <Input
                      value={form.addressLine1}
                      onChange={(e) => patchForm({ addressLine1: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Apt / suite</Label>
                    <Input
                      value={form.addressLine2}
                      onChange={(e) => patchForm({ addressLine2: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">City</Label>
                      <Input value={form.city} onChange={(e) => patchForm({ city: e.target.value })} className="h-10" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">State / region</Label>
                      <Input value={form.region} onChange={(e) => patchForm({ region: e.target.value })} className="h-10" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Postal code</Label>
                      <Input
                        value={form.postalCode}
                        onChange={(e) => patchForm({ postalCode: e.target.value })}
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <Input value={form.country} onChange={(e) => patchForm({ country: e.target.value })} className="h-10" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => patchForm({ notes: e.target.value })}
                      placeholder="Tags, follow-up…"
                      className="h-10"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {jobState === "created" ? (
                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  Job added to the unassigned pool — pin will appear on your dispatch map.
                </p>
              ) : null}
              {jobError ? <p className="text-xs text-red-300">{jobError}</p> : null}
            </div>

            <SheetFooter className="flex flex-col gap-2 border-t border-border/70 bg-secondary/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                {saveState === "saving" ? "Saving…" : null}
                {saveState === "saved" ? "Saved to Customers." : null}
                {saveState === "error" ? "Save failed — check migration 022." : null}
                {saveState === "idle" ? "Edits save automatically." : null}{" "}
                <Link href="/dashboard/customers" className="font-semibold text-primary underline-offset-2 hover:underline">
                  Open customer list
                </Link>
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={jobState === "creating"}
                onClick={() => void closeAndAdvance()}
              >
                {jobState === "creating" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Dismiss
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
