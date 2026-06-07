"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Check, Loader2, PhoneForwarded, Upload } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  PORTING_TIMELINE_STEPS,
  portingTimelineLabel,
  portingTimelineStepIndex,
} from "@/lib/porting-timeline"
import { dispatchBusinessNumbersChanged } from "@/components/dashboard-numbers-modal-context"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import {
  CARRIER_REGISTRATION_UPDATED_EVENT,
  openPortServiceAddressModal,
} from "@/lib/settings-modals-events"
import type { PortingOrder } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

const MISSING_ADDRESS_CODE = "missing_service_address"

type Props = {
  /** When set, render inside buy-number modal with a back link. */
  embedded?: boolean
  onBack?: () => void
  onSubmitted?: () => void
  /** Standalone dialog mode — pass open + onOpenChange from parent. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(",") ? result.split(",")[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

function PortingProgressTimeline({ order }: { order: PortingOrder | null }) {
  const step = order ? portingTimelineStepIndex(order) : -2
  const rejected = order?.status === "rejected"

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Transfer progress</p>
      {order ? (
        <p className="mt-1 text-xs text-zinc-400">{portingTimelineLabel(order.status)}</p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">Submit the form to start tracking your port.</p>
      )}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {PORTING_TIMELINE_STEPS.map((label, i) => {
          const done = step >= 0 && i < step
          const current = step === i
          const isRejected = rejected && i === 1
          return (
            <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold",
                  isRejected
                    ? "border-red-500/50 bg-red-950/60 text-red-300"
                    : done || (current && order?.status === "completed")
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                      : current
                        ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-600"
                )}
              >
                {done || order?.status === "completed" && i <= step ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium leading-tight",
                  current ? "text-violet-200" : done ? "text-zinc-300" : "text-zinc-600"
                )}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
      {order?.phone_number ? (
        <p className="mt-3 text-center text-[11px] text-zinc-500">
          {formatPhoneDisplay(order.phone_number)} · {order.current_carrier}
        </p>
      ) : null}
    </div>
  )
}

export function PortNumberModal({ embedded, onBack, onSubmitted, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [phone, setPhone] = useState("")
  const [carrier, setCarrier] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [pinOrSid, setPinOrSid] = useState("")
  const [lineLabel, setLineLabel] = useState("")
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addressBlock, setAddressBlock] = useState<{ message: string; code: string } | null>(null)
  const [latestOrder, setLatestOrder] = useState<PortingOrder | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const checkServiceAddress = useCallback(async (): Promise<boolean> => {
    const orgId = readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    try {
      const res = await fetch(`/api/numbers/port/validate${qs}`, { credentials: "include" })
      const j = await res.json().catch(() => ({}))
      if (j?.data?.ready === true) {
        setAddressBlock(null)
        return true
      }
      setAddressBlock({
        message:
          String(j?.data?.error ?? "").trim() ||
          "Complete your business address for this workspace before porting.",
        code: String(j?.data?.error_code ?? MISSING_ADDRESS_CODE),
      })
      return false
    } catch {
      return true
    }
  }, [])

  const loadOrders = useCallback(() => {
    const orgId = readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    fetch(`/api/porting/orders${qs}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { orders?: PortingOrder[] } }) => {
        const rows = j?.data?.orders
        if (Array.isArray(rows) && rows.length > 0) setLatestOrder(rows[0])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!embedded && !open) return
    loadOrders()
    void checkServiceAddress()

    const orderInProgress =
      latestOrder?.status === "pending" || latestOrder?.status === "processing"
    if (!orderInProgress) return

    const interval = window.setInterval(loadOrders, 45_000)
    const onOrgChanged = () => {
      void checkServiceAddress()
      loadOrders()
    }
    window.addEventListener("lyncr-organization-changed", onOrgChanged)
    window.addEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onOrgChanged)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("lyncr-organization-changed", onOrgChanged)
      window.removeEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onOrgChanged)
    }
  }, [embedded, open, latestOrder?.status, loadOrders, checkServiceAddress])

  function onFilePick(file: File | null) {
    if (!file) return
    const ok =
      file.type.startsWith("image/") ||
      file.type === "application/pdf" ||
      /\.(pdf|png|jpe?g|webp)$/i.test(file.name)
    if (!ok) {
      setError("Upload a PDF or image (PNG, JPG, WebP).")
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("File must be under 12 MB.")
      return
    }
    setError(null)
    setInvoiceFile(file)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!invoiceFile) {
      setError("Upload your latest customer invoice or bill.")
      return
    }
    const addressReady = await checkServiceAddress()
    if (!addressReady) {
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const invoice_base64 = await fileToBase64(invoiceFile)
      const res = await fetch("/api/numbers/port", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: readActiveOrganizationId(),
          phone_number: phone.trim(),
          current_carrier: carrier.trim(),
          account_number: accountNumber.trim(),
          pin_or_sid: pinOrSid.trim(),
          line_label: lineLabel.trim(),
          invoice_base64,
          invoice_filename: invoiceFile.name,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.success === false) {
        if (j.error_code === MISSING_ADDRESS_CODE) {
          setAddressBlock({
            message: String(j.error ?? "Complete your business address for this workspace before porting."),
            code: MISSING_ADDRESS_CODE,
          })
          return
        }
        throw new Error(j.error || "Could not submit transfer request")
      }
      if (j.data?.order) setLatestOrder(j.data.order as PortingOrder)
      dispatchBusinessNumbersChanged()
      toast({
        title: "Transfer request submitted",
        description: j.message || "Your carrier port is in progress.",
      })
      onSubmitted?.()
      if (!embedded) onOpenChange?.(false)
      loadOrders()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit transfer request")
    } finally {
      setBusy(false)
    }
  }

  const inner = (
    <>
      {embedded && onBack ? (
        <div className="shrink-0 border-b border-border/60 px-6 py-4">
          <button
            type="button"
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to buy a number
          </button>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <PhoneForwarded className="h-4 w-4 text-violet-400" aria-hidden />
            Port Your Existing Number to Lyncr
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            We submit an official carrier port through Telnyx — your number moves natively onto Lyncr with full call
            quality (no Twilio webhook forwarding).
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-b border-border/60 px-6 py-5">
          <h3 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <PhoneForwarded className="h-5 w-5 text-violet-400" aria-hidden />
            Port Your Existing Number to Lyncr
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Native number porting — better audio and lower latency than call forwarding.
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Phone number to transfer
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              required
              placeholder="+1 (502) 555-0194"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Current carrier name
            </label>
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              required
              placeholder="Twilio, Verizon, AT&T, T-Mobile…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Account number / SID
            </label>
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              required
              placeholder="Carrier account number or Twilio SID"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Authorization PIN / password
            </label>
            <input
              value={pinOrSid}
              onChange={(e) => setPinOrSid(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Port-out PIN from your carrier"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Line label (whisper name)
            </label>
            <input
              value={lineLabel}
              onChange={(e) => setLineLabel(e.target.value)}
              required
              maxLength={120}
              placeholder="Key Squad 502 Line"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Upload last customer invoice / bill (PDF / image)
            </label>
            <div
              role="button"
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) onFilePick(f)
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click()
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragOver ? "border-violet-500/60 bg-violet-500/10" : "border-zinc-700 bg-zinc-950/40 hover:border-zinc-600"
              )}
            >
              <Upload className="h-8 w-8 text-zinc-500" aria-hidden />
              <p className="text-sm font-medium text-zinc-300">
                {invoiceFile ? invoiceFile.name : "Drag & drop or click to upload"}
              </p>
              <p className="text-xs text-zinc-500">Required by carrier compliance · PDF, PNG, or JPG · max 12 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.webp"
              className="sr-only"
              onChange={(e) => onFilePick(e.target.files?.[0] ?? null)}
            />
          </div>

          {addressBlock ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
            >
              <p>{addressBlock.message}</p>
              <button
                type="button"
                onClick={() => openPortServiceAddressModal()}
                className="mt-2 inline-flex items-center gap-1 font-semibold text-destructive underline underline-offset-2 hover:text-destructive/90"
              >
                Fix now — add business address
              </button>
            </div>
          ) : null}

          {error && !addressBlock ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || Boolean(addressBlock)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Submit Official Transfer Request
          </button>
        </form>

        <PortingProgressTimeline order={latestOrder} />
      </div>
    </>
  )

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{inner}</div>
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[min(92dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl">
        {inner}
        <button
          type="button"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground sr-only"
          onClick={() => onOpenChange?.(false)}
        >
          Close
        </button>
      </div>
    </div>
  )
}
