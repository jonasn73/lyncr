"use client"

// Out of Stock / Unobtainable Alternative Solutions — booking modal fallback.

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CalendarDays,
  Copy,
  ExternalLink,
  Loader2,
  PackageX,
  Phone,
  Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  shouldShowOutOfStockFallback,
  type KeyInventoryApiRow,
} from "@/lib/key-inventory-shared"

export type StockFallbackIntakePayload = {
  caller_e164: string
  customer_name: string
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country?: string | null
  notes?: string | null
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  key_fcc_id?: string | null
  key_style?: string | null
  call_log_id?: string | null
  organization_id?: string | null
  quoted_price_cents?: number | null
  sku?: string | null
}

type AffiliateRow = {
  id: string
  name: string
  phoneE164: string
  commissionCents: number
  commissionLabel: string
  notes: string | null
}

type Props = {
  inventory: KeyInventoryApiRow[] | null | undefined
  /** Year/make/model resolved from lookup. */
  vehicleResolved: boolean
  intake: StockFallbackIntakePayload
  onSpecialOrderDone?: (result: {
    leadId: string
    checkoutUrl: string
    earliestServiceDate: string
  }) => void
  onPartnerLeadDone?: (result: {
    leadId: string
    referralStatus: string
    affiliateName: string
  }) => void
  className?: string
}

function minServiceDate(): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

function formatPhoneDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return e164
}

export function OutOfStockFallbackCard({
  inventory,
  vehicleResolved,
  intake,
  onSpecialOrderDone,
  onPartnerLeadDone,
  className,
}: Props) {
  const decision = useMemo(
    () => shouldShowOutOfStockFallback(inventory),
    [inventory]
  )
  const [serviceDate, setServiceDate] = useState(minServiceDate)
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([])
  const [affiliatesLoading, setAffiliatesLoading] = useState(false)
  const [specialBusy, setSpecialBusy] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!decision.show || !vehicleResolved) return
    let cancelled = false
    setAffiliatesLoading(true)
    const q = new URLSearchParams()
    if (intake.organization_id) q.set("organization_id", intake.organization_id)
    void fetch(`/api/affiliates?${q}`, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as { data?: { affiliates?: AffiliateRow[] } }
        if (!cancelled) setAffiliates(json.data?.affiliates ?? [])
      })
      .catch(() => {
        if (!cancelled) setAffiliates([])
      })
      .finally(() => {
        if (!cancelled) setAffiliatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [decision.show, vehicleResolved, intake.organization_id])

  if (!vehicleResolved || !decision.show) return null

  const reasonLabel =
    decision.reason === "specialty"
      ? "Specialty / Dealer-Only key"
      : "Out of stock on all vans"

  const skuHint = inventory?.map((r) => r.sku).filter(Boolean).slice(0, 2).join(", ")

  const generateSpecialOrder = async () => {
    setSpecialBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/inventory/special-order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...intake,
          earliest_service_date: serviceDate,
          sku: intake.sku || skuHint || null,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          lead_id: string
          checkout_url: string
          earliest_service_date: string
        }
      }
      if (!res.ok) throw new Error(json.error ?? "Special order failed")
      const url = json.data?.checkout_url ?? ""
      setCheckoutUrl(url)
      onSpecialOrderDone?.({
        leadId: json.data!.lead_id,
        checkoutUrl: url,
        earliestServiceDate: json.data!.earliest_service_date,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Special order failed")
    } finally {
      setSpecialBusy(false)
    }
  }

  const sendPartnerLead = async (affiliateId: string) => {
    setSendingId(affiliateId)
    setError(null)
    try {
      const res = await fetch(`/api/affiliates/${affiliateId}/send-lead`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intake),
      })
      const json = (await res.json()) as {
        error?: string
        data?: {
          lead_id: string
          referral_status: string
          affiliate?: { name: string }
          partner_sms_error?: string | null
        }
      }
      if (!res.ok) throw new Error(json.error ?? "Send lead failed")
      if (json.data?.partner_sms_error) {
        setError(`Lead saved, but partner SMS failed: ${json.data.partner_sms_error}`)
      }
      onPartnerLeadDone?.({
        leadId: json.data!.lead_id,
        referralStatus: json.data!.referral_status,
        affiliateName: json.data!.affiliate?.name ?? "Partner",
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send lead failed")
    } finally {
      setSendingId(null)
    }
  }

  const copyCheckout = async () => {
    if (!checkoutUrl) return
    try {
      await navigator.clipboard.writeText(checkoutUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError("Could not copy link — select it manually.")
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 shadow-sm shadow-amber-950/20",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-200">
          <PackageX className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-100">
            Alternative solutions
          </p>
          <p className="text-xs leading-relaxed text-amber-100/80">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-300" aria-hidden />
            {reasonLabel}
            {skuHint ? (
              <span className="font-mono text-amber-50/90"> · {skuHint}</span>
            ) : null}
            . Van stock: {decision.vanQuantity}. Choose special order or partner dispatch.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {/* Option 1 — Special Order */}
        <div className="rounded-lg border border-border/50 bg-card/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Option 1 · Special order
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            $50 non-refundable retainer · booking status becomes Pending Deposit.
          </p>
          <div className="mt-2.5 space-y-1.5">
            <Label htmlFor="oos-service-date" className="text-[11px] text-muted-foreground">
              <CalendarDays className="mr-1 inline h-3 w-3" aria-hidden />
              Earliest service date (shipping +2 days)
            </Label>
            <Input
              id="oos-service-date"
              type="date"
              min={minServiceDate()}
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="h-10"
            />
          </div>
          <Button
            type="button"
            className="mt-2.5 h-10 w-full bg-amber-600 text-white hover:bg-amber-500"
            disabled={specialBusy || !intake.customer_name.trim() || !intake.caller_e164.trim()}
            onClick={() => void generateSpecialOrder()}
          >
            {specialBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ExternalLink className="h-4 w-4" aria-hidden />
            )}
            Generate Special Order Link
          </Button>
          {checkoutUrl ? (
            <div className="mt-2 space-y-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
              <p className="text-[11px] font-medium text-emerald-200">Checkout ready · Pending Deposit</p>
              <p className="break-all font-mono text-[10px] text-emerald-100/90">{checkoutUrl}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 flex-1"
                  onClick={() => void copyCheckout()}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 flex-1"
                  onClick={() => window.open(checkoutUrl, "_blank", "noopener,noreferrer")}
                >
                  Open
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Option 2 — Partner Dispatch */}
        <div className="rounded-lg border border-border/50 bg-card/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Option 2 · Partner dispatch
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Send the lead to an affiliate locksmith. Job is marked referred with commission pending.
          </p>

          {affiliatesLoading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading partners…
            </p>
          ) : affiliates.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No affiliate locksmiths yet. Add rows to{" "}
              <span className="font-mono text-[10px]">affiliate_locksmiths</span> in Neon (see
              migration 106).
            </p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {affiliates.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" aria-hidden />
                      <a href={`tel:${a.phoneE164}`} className="hover:text-foreground">
                        {formatPhoneDisplay(a.phoneE164)}
                      </a>
                      <span className="text-zinc-600">·</span>
                      <span>{a.commissionLabel} commission</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={
                      sendingId === a.id ||
                      !intake.customer_name.trim() ||
                      !intake.caller_e164.trim()
                    }
                    onClick={() => void sendPartnerLead(a.id)}
                  >
                    {sendingId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Send Lead
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error ? <p className="mt-2 text-center text-xs text-rose-300">{error}</p> : null}
      {!intake.customer_name.trim() || !intake.caller_e164.trim() ? (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Enter customer name and phone before generating a link or sending a lead.
        </p>
      ) : null}
    </div>
  )
}
