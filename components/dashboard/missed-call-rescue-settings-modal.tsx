"use client"

// Settings sheet for Missed Call Rescue + IVR capacity (moved off Lines home).

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MissedCallRescueCard } from "@/components/dashboard/missed-call-rescue-card"
import { SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD } from "@/lib/smart-overflow-autopilot"
import { useToast } from "@/hooks/use-toast"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MissedCallRescueSettingsModal({ open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [capacityThreshold, setCapacityThreshold] = useState(
    SMART_OVERFLOW_DEFAULT_CAPACITY_THRESHOLD
  )
  const [capacitySaving, setCapacitySaving] = useState(false)
  const [confirmedJobsToday, setConfirmedJobsToday] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetch("/api/routing/ivr-capacity", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { ivrCapacityThreshold?: number } } | null) => {
        if (cancelled || !json?.data) return
        const n = Number(json.data.ivrCapacityThreshold)
        if (Number.isFinite(n) && n > 0) setCapacityThreshold(Math.floor(n))
      })
      .catch(() => {
        /* keep default */
      })
    void fetch("/api/routing/tracking-metrics", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { confirmed_jobs_today?: number } } | null) => {
        if (cancelled || !json?.data) return
        const n = Number(json.data.confirmed_jobs_today)
        if (Number.isFinite(n)) setConfirmedJobsToday(n)
      })
      .catch(() => {
        /* optional */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const onCapacityThresholdChange = useCallback(
    async (next: number) => {
      setCapacityThreshold(next)
      setCapacitySaving(true)
      try {
        const res = await fetch("/api/routing/ivr-capacity", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ivrCapacityThreshold: next }),
        })
        const json = (await res.json().catch(() => null)) as {
          error?: string
          migration?: string
        } | null
        if (!res.ok) {
          toast({
            title: "Could not save capacity",
            description: json?.migration
              ? `Run ${json.migration} in Neon, then try again.`
              : json?.error || res.statusText,
            variant: "destructive",
          })
          return
        }
        toast({ title: "Capacity updated", description: `Auto-bypass at ${next} jobs.` })
      } catch (e) {
        toast({
          title: "Could not save capacity",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setCapacitySaving(false)
      }
    },
    [toast]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Missed Call Rescue</DialogTitle>
          <DialogDescription>
            Auto-text a booking link when a call goes unanswered, and set when IVR auto-bypass kicks in.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto pr-1">
          <MissedCallRescueCard
            capacityThreshold={capacityThreshold}
            confirmedJobsToday={confirmedJobsToday}
            onCapacityThresholdChange={(n) => void onCapacityThresholdChange(n)}
            capacitySaving={capacitySaving}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
