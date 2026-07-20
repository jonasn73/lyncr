"use client"

// On-the-go Collect Payment — pick a job, enter amount, charge card (Stripe Payment Element).

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { CreditCard, Loader2, MapPin } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { DispatchJob } from "@/lib/types"
import { coerceMapCoord } from "@/lib/dispatch-map-jobs"
import { useToast } from "@/hooks/use-toast"

const TechPaymentModal = dynamic(
  () =>
    import("@/components/tech/tech-payment-modal").then((m) => ({
      default: m.TechPaymentModal,
    })),
  { ssr: false }
)

function formatDollarsFromJob(job: DispatchJob): string | null {
  const cents = (job as DispatchJob & { quoted_price_cents?: number | null }).quoted_price_cents
  if (typeof cents === "number" && Number.isFinite(cents) && cents > 0) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }
  return null
}

function jobTitle(job: DispatchJob): string {
  return (
    (job.customer_name ?? "").trim() ||
    (job.customer_phone ?? "").trim() ||
    (job.summary ?? "").trim() ||
    "Job"
  )
}

export function OwnerCollectPaymentSheet({
  open,
  onOpenChange,
  onCollected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Refresh header “amount collected” after a successful charge. */
  onCollected?: () => void
}) {
  const { toast } = useToast()
  const [jobs, setJobs] = useState<DispatchJob[]>([])
  const [loading, setLoading] = useState(false)
  const [payJob, setPayJob] = useState<DispatchJob | null>(null)

  const loadJobs = useCallback(() => {
    setLoading(true)
    fetch("/api/owner/jobs?scope=map", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { jobs?: DispatchJob[] } }) => {
        const list = Array.isArray(j.data?.jobs) ? j.data!.jobs! : []
        // Open work first — completed jobs still pay-able but sorted last.
        const open = list.filter((job) => {
          const s = (job.job_status ?? "").toLowerCase()
          return s !== "completed" && s !== "cancelled" && s !== "canceled"
        })
        setJobs(open.length ? open : list.slice(0, 12))
      })
      .catch(() => {
        setJobs([])
        toast({
          title: "Could not load jobs",
          description: "Try again in a moment.",
          variant: "destructive",
        })
      })
      .finally(() => setLoading(false))
  }, [toast])

  useEffect(() => {
    if (open) loadJobs()
  }, [open, loadJobs])

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const aPin = coerceMapCoord(a.latitude) != null
      const bPin = coerceMapCoord(b.latitude) != null
      if (aPin !== bPin) return aPin ? -1 : 1
      return (b.created_at || "").localeCompare(a.created_at || "")
    })
  }, [jobs])

  return (
    <>
      <Sheet open={open && !payJob} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div>
                <SheetTitle className="text-base text-slate-100">Collect payment</SheetTitle>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pick a job, then charge the card — built for on-site collecting.
                </p>
              </div>
              <CreditCard className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading jobs…
              </div>
            ) : sorted.length === 0 ? (
              <p className="px-2 py-12 text-center text-sm text-slate-500">
                No open jobs yet. Book a job from intake, then collect here.
              </p>
            ) : (
              <ul className="space-y-2">
                {sorted.map((job) => {
                  const quote = formatDollarsFromJob(job)
                  return (
                    <li key={job.id}>
                      <button
                        type="button"
                        onClick={() => setPayJob(job)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-left transition-colors",
                          "hover:border-emerald-500/40 hover:bg-zinc-900"
                        )}
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                          <CreditCard className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-100">
                            {jobTitle(job)}
                          </span>
                          {job.location ? (
                            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                              {job.location}
                            </span>
                          ) : null}
                          <span className="mt-1 block text-[11px] font-medium text-emerald-400/90">
                            {quote ? `Quoted ${quote}` : "Enter amount on next screen"}
                            {!job.assigned_tech_id ? " · You can collect unassigned" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {payJob ? (
        <TechPaymentModal
          job={payJob}
          onClose={() => setPayJob(null)}
          onCompleted={() => {
            setPayJob(null)
            onOpenChange(false)
            onCollected?.()
            toast({ title: "Payment collected", description: "Header total updated." })
          }}
        />
      ) : null}
    </>
  )
}
