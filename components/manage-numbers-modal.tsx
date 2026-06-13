"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRightLeft, Hourglass, Loader2, Pencil, Phone, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PortingOrder } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { fetchOnboardingProfile } from "@/lib/onboarding-profile-client"
import { formatBillingCycleDate } from "@/lib/format-billing-cycle"
import { dispatchBusinessNumbersChanged, dispatchPortingOrdersChanged } from "@/components/dashboard-numbers-modal-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { organizationQueryString } from "@/lib/workspace-organizations"
import { useToast } from "@/hooks/use-toast"

type OwnedLine = {
  id: string
  number: string
  status: string
  /** phone_numbers.label — whisper name for this line */
  line_business_name: string
}

const DEFAULT_LINE_LABEL = "Main Line"
const MAX_LINE_LABEL_LEN = 120

/** Human pipeline stage for a pending transfer (mirrors the carrier journey steps). */
function pendingPortStageLabel(order: PortingOrder): string {
  const ts = (order.telnyx_status ?? "").toLowerCase().replace(/_/g, "-")
  if (["foc-date-confirmed", "foc-date-confirmed-pending", "port-activating", "activation-in-progress"].includes(ts)) {
    return "Port Date Assigned"
  }
  if (order.status === "processing" || ["in-process", "submitted"].includes(ts)) {
    return "Carrier Review"
  }
  if (ts.includes("exception") || ts === "draft") {
    return "Document Verification"
  }
  return "Submitted"
}

/** Active transfers — includes action_required and rejected orders needing owner input. */
function isActiveTransferOrder(order: PortingOrder): boolean {
  return (
    order.status === "pending" ||
    order.status === "processing" ||
    order.status === "submitted" ||
    order.status === "pending_carrier_review" ||
    order.status === "action_required" ||
    order.status === "pending_info" ||
    order.status === "rejected"
  )
}

/** Inline PIN correction after a carrier rejection. */
function PortPinCorrectionForm({
  order,
  onResubmitted,
}: {
  order: PortingOrder
  onResubmitted: () => void
}) {
  const { toast } = useToast()
  const [pin, setPin] = useState(order.pin_or_sid ?? "")
  const [submitting, setSubmitting] = useState(false)

  async function resubmit() {
    const trimmed = pin.trim()
    if (!trimmed) {
      toast({
        variant: "destructive",
        title: "PIN required",
        description: "Enter the correct account PIN or passcode from your current carrier.",
      })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/porting/orders/${encodeURIComponent(order.id)}/resubmit-pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || "Could not resubmit port")
      toast({
        title: "Port resubmitted",
        description: data.message || "Carrier is reviewing your corrected PIN.",
      })
      onResubmitted()
      dispatchPortingOrdersChanged()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Resubmit failed",
        description: e instanceof Error ? e.message : "Try again or contact support.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-3">
      <p className="text-xs leading-snug text-red-200/90">
        {order.carrier_rejection_reason?.trim() || "Carrier rejected this transfer and needs a correction."}
      </p>
      <label className="block text-[11px] font-medium text-red-100/80">
        Enter Correct Account PIN/Passcode:
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mt-1 w-full rounded-md border border-red-500/40 bg-zinc-950/80 px-2 py-1.5 text-xs text-foreground placeholder:text-zinc-600 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400/40"
        />
      </label>
      <button
        type="button"
        disabled={submitting}
        onClick={() => void resubmit()}
        className="inline-flex w-full items-center justify-center rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Resubmit Port"}
      </button>
    </div>
  )
}

function EditableLineLabel({
  lineId,
  label,
  disabled,
  onSaved,
  onRevert,
}: {
  lineId: string
  label: string
  disabled?: boolean
  onSaved: (lineId: string, nextLabel: string) => void
  onRevert: (lineId: string, previousLabel: string) => void
}) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [saving, setSaving] = useState(false)

  const storedLabel = label.trim() || DEFAULT_LINE_LABEL
  const displayLabel = label.trim() ? label.trim() : DEFAULT_LINE_LABEL

  useEffect(() => {
    if (editing) {
      setDraft(storedLabel)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, storedLabel])

  async function commitSave() {
    const trimmed = draft.trim().slice(0, MAX_LINE_LABEL_LEN)
    if (!trimmed) {
      toast({
        variant: "destructive",
        title: "Label required",
        description: "Enter a short name your team will recognize on incoming calls.",
      })
      setDraft(storedLabel)
      setEditing(false)
      return
    }
    if (trimmed === storedLabel) {
      setEditing(false)
      return
    }

    const previous = label
    setSaving(true)
    onSaved(lineId, trimmed)
    try {
      const res = await fetch(`/api/numbers/${encodeURIComponent(lineId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Could not save label")
      toast({
        title: "Line label saved",
        description: `Your team will hear “${trimmed}” on the whisper for this line.`,
      })
      dispatchBusinessNumbersChanged()
      setEditing(false)
    } catch (e) {
      onRevert(lineId, previous)
      toast({
        variant: "destructive",
        title: "Could not save label",
        description: e instanceof Error ? e.message : "Try again in a moment.",
      })
      setDraft(storedLabel)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-1 space-y-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          maxLength={MAX_LINE_LABEL_LEN}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void commitSave()
            }
            if (e.key === "Escape") {
              skipBlurRef.current = true
              setDraft(storedLabel)
              setEditing(false)
            }
          }}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false
              return
            }
            if (!saving) void commitSave()
          }}
          placeholder={DEFAULT_LINE_LABEL}
          className="w-full rounded-md border border-primary/40 bg-zinc-900/80 px-2 py-1 text-xs text-foreground placeholder:text-zinc-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          aria-label="Line label whisper name"
        />
        <p className="text-[10px] leading-snug text-zinc-500">
          Line label (whisper name) — what your team hears when a call comes in.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setEditing(true)}
        className="group flex min-w-0 flex-1 items-center gap-1 text-left"
        title="Rename line label"
      >
        <span className="truncate text-xs text-zinc-500 group-hover:text-zinc-300">{displayLabel}</span>
        {saving ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-zinc-500" aria-hidden />
        ) : (
          <Pencil className="h-3 w-3 shrink-0 text-zinc-600 opacity-70 group-hover:text-primary group-hover:opacity-100" aria-hidden />
        )}
      </button>
    </div>
  )
}

export function ManageNumbersModal({
  open,
  onOpenChange,
  onBuyAnother,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBuyAnother?: () => void
}) {
  const { toast } = useToast()
  const { activeOrganizationId } = useDashboardWorkspace()
  const [lines, setLines] = useState<OwnedLine[]>([])
  const [loading, setLoading] = useState(false)
  const [billingCycleEnd, setBillingCycleEnd] = useState<string | null>(null)
  const [releaseTarget, setReleaseTarget] = useState<OwnedLine | null>(null)
  const [releasingId, setReleasingId] = useState<string | null>(null)
  const [pendingPorts, setPendingPorts] = useState<PortingOrder[]>([])

  const applyLineLabel = useCallback((lineId: string, nextLabel: string) => {
    setLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, line_business_name: nextLabel } : line))
    )
  }, [])

  const loadLines = useCallback(() => {
    setLoading(true)
    const orgQs = organizationQueryString(activeOrganizationId)
    void fetchOnboardingProfile()
      .then(({ profile }) => setBillingCycleEnd(profile?.billing_cycle_end?.trim() || null))
      .catch(() => setBillingCycleEnd(null))
    fetch(`/api/numbers/mine${orgQs}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data: { numbers?: { id?: string; number: string; status: string; label?: string }[] }) => {
        const rows = Array.isArray(data.numbers) ? data.numbers : []
        setLines(
          rows
            .filter((n) => n.status === "active")
            .map((n) => ({
              id: String(n.id),
              number: String(n.number),
              status: String(n.status),
              line_business_name: n.label?.trim() || DEFAULT_LINE_LABEL,
            }))
        )
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false))
    fetch(`/api/porting/orders${orgQs}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { data: { orders: [] } }))
      .then((data: { data?: { orders?: PortingOrder[] } }) => {
        const orders = Array.isArray(data.data?.orders) ? data.data.orders : []
        setPendingPorts(orders.filter(isActiveTransferOrder))
      })
      .catch(() => setPendingPorts([]))
  }, [activeOrganizationId])

  useEffect(() => {
    if (open) loadLines()
  }, [open, loadLines])

  async function confirmRelease() {
    if (!releaseTarget) return
    setReleasingId(releaseTarget.id)
    try {
      const res = await fetch(`/api/numbers/${encodeURIComponent(releaseTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
      if (!res.ok) {
        throw new Error(data.error || "Could not release this line")
      }
      toast({
        title: "Line released",
        description: `${formatPhoneDisplay(releaseTarget.number)} was returned to carrier inventory. Monthly billing for that line stops.`,
      })
      setReleaseTarget(null)
      loadLines()
      dispatchBusinessNumbersChanged()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not release line",
        description: e instanceof Error ? e.message : "Try again or contact support.",
      })
    } finally {
      setReleasingId(null)
    }
  }

  const canReleaseAny = lines.length > 1

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton
          className={cn(
            "sigo-marketplace-dialog gap-0 overflow-hidden border-border/60 p-0 sm:max-w-md",
            "transform-gpu will-change-transform backface-hidden"
          )}
        >
          <DialogHeader className="border-b border-border/60 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold tracking-tight">Lines & numbers</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Published business numbers on your account. Release a line you no longer want — carrier credit is not
              refunded.
            </DialogDescription>
          </DialogHeader>

          {billingCycleEnd ? (
            <p className="border-b border-border/60 px-6 py-3 text-xs text-muted-foreground">
              Next billing date:{" "}
              <span className="font-medium text-foreground">{formatBillingCycleDate(billingCycleEnd)}</span>
            </p>
          ) : null}

          <div className="max-h-[min(55vh,24rem)] overflow-y-auto overscroll-contain px-6 py-5">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading lines" />
              </div>
            ) : lines.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center text-sm text-zinc-500">
                No active lines yet. Buy a number to publish your first business line.
              </p>
            ) : (
              <ul className="space-y-3">
                {lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                      <Phone className="h-4 w-4 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold tabular-nums text-foreground">{formatPhoneDisplay(line.number)}</p>
                      <EditableLineLabel
                        lineId={line.id}
                        label={line.line_business_name}
                        disabled={releasingId != null}
                        onSaved={applyLineLabel}
                        onRevert={applyLineLabel}
                      />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        Active
                      </span>
                      <button
                        type="button"
                        disabled={!canReleaseAny || releasingId != null}
                        onClick={() => setReleaseTarget(line)}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          canReleaseAny
                            ? "Return this number to the carrier"
                            : "Buy another line first — you need at least one business number"
                        }
                      >
                        {releasingId === line.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3 w-3" aria-hidden />
                        )}
                        Release
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {pendingPorts.length > 0 ? (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Hourglass className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <h3 className="text-xs font-bold uppercase tracking-wide text-amber-300/90">
                    Pending Number Transfers
                  </h3>
                </div>
                <ul className="space-y-3">
                  {pendingPorts.map((order) => {
                    const rejected = order.status === "rejected"
                    return (
                      <li key={order.id}>
                        <div
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-4 py-3",
                            rejected
                              ? "border-red-700/40 bg-red-950/20"
                              : "border-amber-700/40 bg-amber-950/20"
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                              rejected
                                ? "border-red-500/30 bg-red-500/10"
                                : "border-amber-500/30 bg-amber-500/10"
                            )}
                          >
                            <ArrowRightLeft
                              className={cn("h-4 w-4", rejected ? "text-red-400" : "text-amber-400")}
                              aria-hidden
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold tabular-nums text-foreground">
                              {formatPhoneDisplay(order.phone_number)}
                            </p>
                            <p
                              className={cn(
                                "mt-0.5 text-xs",
                                rejected ? "text-red-200/60" : "text-amber-200/60"
                              )}
                            >
                              Transferring from {order.current_carrier?.trim() || "your current carrier"}
                              {!rejected ? " · Est. completion: 1-3 business days" : ""}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              rejected
                                ? "border-red-500/50 bg-red-500/15 text-red-300"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            )}
                          >
                            {rejected ? "Rejection: Need Correction" : pendingPortStageLabel(order)}
                          </span>
                        </div>
                        {rejected ? (
                          <PortPinCorrectionForm order={order} onResubmitted={loadLines} />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          {!canReleaseAny && lines.length === 1 ? (
            <p className="border-t border-border/60 px-6 py-3 text-xs text-muted-foreground">
              Your only line cannot be released. Add another number first if you want to swap to a different one.
            </p>
          ) : null}

          {onBuyAnother ? (
            <div className="border-t border-border/60 px-6 py-4">
              <button
                type="button"
                onClick={onBuyAnother}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] transition-[opacity,transform] hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Buy another line
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={releaseTarget != null} onOpenChange={(next) => !next && setReleaseTarget(null)}>
        <AlertDialogContent className="border-border/60 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Release this line?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">
                    {releaseTarget ? formatPhoneDisplay(releaseTarget.number) : ""}
                  </span>{" "}
                  will be removed from your account and returned to Telnyx inventory.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Callers will no longer reach you on this number.</li>
                  <li>Future monthly charges for this line stop.</li>
                  <li>The $2 carrier credit used to buy it is not refunded.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={releasingId != null}>Keep line</AlertDialogCancel>
            <AlertDialogAction
              disabled={releasingId != null}
              onClick={(e) => {
                e.preventDefault()
                void confirmRelease()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {releasingId ? "Releasing…" : "Release line"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
