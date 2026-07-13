"use client"

// Action sheet: today's missed callers with Call Back & Rescue + Re-send SMS Link.

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"
import { Check, Loader2, Phone, PhoneMissed } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { businessNumbersMatch, formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { isMissedCallRecord, isMissedCallTodayRecord } from "@/lib/missed-call-telemetry"
import { buildTelHref, toE164 } from "@/lib/phone-e164"
import { MOBILE_TAP_TARGET } from "@/lib/mobile-shell"
import { activityCallerPhoneKey } from "@/lib/activity-call-groups"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import {
  loadIntakeDraft,
  saveIntakeDraft,
  type IntakeDraftSnapshot,
} from "@/lib/intake-draft-storage"
import type { ActiveCallFormState } from "@/lib/hooks/use-active-call-form"

type MissedCallRow = {
  id: string
  call_type: string
  from_number: string
  to_number: string
  created_at: string
  status: string
  answered_at?: string | null
  ended_at?: string | null
  routed_to_name?: string | null
  /** Carrier CNAM / Telnyx caller id when available. */
  caller_name?: string | null
}

export type MissedHotlistItem = {
  key: string
  from_number: string
  /** Business DID this caller rang (for SMS booking line). */
  to_number: string
  count: number
  /** Most recent missed call ISO timestamp for this number today. */
  latestAt: string
  /** All missed times today, newest first (local clock strings). */
  times: string[]
  /** Latest capture / IVR status for this lead (e.g. Missed - Sent Night Link). */
  latestStatus: string | null
  /** CNAM or saved contact / company name for this phone. */
  displayName: string | null
}

function formatMissedTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** Prefer a real person/business label over empty / generic placeholders. */
function sanitizeCallerLabel(raw: string | null | undefined): string | null {
  const name = String(raw ?? "").trim()
  if (!name) return null
  const lower = name.toLowerCase()
  if (
    lower === "unknown" ||
    lower === "unknown caller" ||
    lower === "anonymous" ||
    lower === "private" ||
    lower === "restricted"
  ) {
    return null
  }
  return name
}

/**
 * Group ALL of today's missed rows by caller (not just consecutive).
 * Latest timestamp wins the header clock; times[] keeps every occurrence (newest first).
 */
export function collapseMissedHotlist(rows: MissedCallRow[]): MissedHotlistItem[] {
  const byKey = new Map<
    string,
    {
      key: string
      from_number: string
      to_number: string
      count: number
      stamps: string[]
      latestStatus: string | null
      latestAtMs: number
      displayName: string | null
    }
  >()

  for (const row of rows) {
    const key = activityCallerPhoneKey(row.from_number) || row.from_number.replace(/\D/g, "") || "unknown"
    const atMs = Date.parse(row.created_at) || 0
    const status = row.routed_to_name?.trim() || null
    const cnam = sanitizeCallerLabel(row.caller_name)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key,
        from_number: row.from_number,
        to_number: row.to_number || "",
        count: 1,
        stamps: [row.created_at],
        latestStatus: status,
        latestAtMs: atMs,
        displayName: cnam,
      })
      continue
    }
    existing.count += 1
    existing.stamps.push(row.created_at)
    if (atMs >= existing.latestAtMs) {
      existing.latestAtMs = atMs
      existing.latestStatus = status
      existing.from_number = row.from_number
      existing.to_number = row.to_number || existing.to_number
      // Prefer a non-empty CNAM from the newest miss when available.
      if (cnam) existing.displayName = cnam
    } else if (!existing.displayName && cnam) {
      existing.displayName = cnam
    }
  }

  const items: MissedHotlistItem[] = []
  for (const g of byKey.values()) {
    const stamps = [...g.stamps].sort((a, b) => Date.parse(b) - Date.parse(a))
    const latestAt = stamps[0] || ""
    const seen = new Set<string>()
    const times: string[] = []
    for (const iso of stamps) {
      const label = formatMissedTime(iso)
      if (!label || seen.has(label)) continue
      seen.add(label)
      times.push(label)
    }
    items.push({
      key: g.key,
      from_number: g.from_number,
      to_number: g.to_number,
      count: g.count,
      latestAt,
      times,
      latestStatus: g.latestStatus,
      displayName: g.displayName,
    })
  }

  items.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
  return items
}

/** Seed a local intake draft so job logging is ready when the callback connects. */
function seedIntakeDraftForCallback(phone: string, displayName: string | null): void {
  const e164 = toE164(phone) || phone.trim()
  if (!e164) return
  const existing = loadIntakeDraft(e164)
  // Do not clobber a richer in-progress draft the operator already started.
  if (existing && !existing.submitted) return

  const form: ActiveCallFormState = {
    phoneNumber: e164,
    displayName: displayName || "",
    serviceAddress: null,
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "US",
    notes: "",
    jobType: "",
    keyReplacementMode: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleTrim: "",
    factoryOptions: [],
    plateNumber: "",
    plateState: "",
    vehicleVin: "",
    keyFccId: "",
    keyFrequency: "",
    keyChipset: "",
    keyStyle: "",
    keyVariantId: "",
    keyProfileId: "",
    programmingMethod: "",
    scheduledDate: "",
    scheduledTime: "",
    vehicleClarificationAnswers: [],
    serviceQuoteTypeId: "lockout",
    quotedPriceCents: 0,
    quotedPriceOverridden: false,
  }

  const snapshot: Omit<IntakeDraftSnapshot, "savedAt"> = {
    form,
    currentStep: "SERVICE_SELECT",
    customPrice: "",
    failureReason: "",
    recoveredViaRouteDiscount: false,
    negotiationStep: 0,
    submitted: false,
  }
  saveIntakeDraft(e164, snapshot)
}

function MissedLeadCard({
  item,
  onResendLink,
  resendState,
}: {
  item: MissedHotlistItem
  onResendLink: (item: MissedHotlistItem) => void
  resendState: "idle" | "sending" | "sent" | "error"
}) {
  const inbound = useInboundCallPanelOptional()
  const href = buildTelHref(item.from_number)
  const phoneLabel = formatPhoneDisplay(item.from_number) || "Unknown Caller"
  const label = item.count > 1 ? `${phoneLabel} (x${item.count})` : phoneLabel

  const handleCallBack = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const phone = toE164(item.from_number) || item.from_number.trim()
    // Background draft + open intake sheet so logging is ready when the call connects.
    seedIntakeDraftForCallback(phone, item.displayName)
    inbound?.openManualCallPanel({
      phoneNumber: phone,
      customerName: item.displayName || undefined,
      callStatus: "answered",
      toNumber: item.to_number || undefined,
    })
    if (href) window.location.href = href
  }

  return (
    <li className="rounded-xl border border-slate-850 bg-slate-900/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-semibold text-slate-100">{label}</p>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-amber-200/90">
          {formatMissedTime(item.latestAt)}
        </span>
      </div>
      {item.displayName ? (
        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{item.displayName}</p>
      ) : null}
      {item.latestStatus ? (
        <p className="mt-1 text-[10px] font-medium text-slate-500">{item.latestStatus}</p>
      ) : null}
      {href ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleCallBack}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-xl",
              "border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5",
              "text-sm font-semibold text-emerald-200 transition-all",
              "hover:bg-emerald-500/25 active:scale-95",
              MOBILE_TAP_TARGET
            )}
          >
            <Phone className="h-4 w-4 shrink-0" aria-hidden />
            Call Back &amp; Rescue
          </button>
          <button
            type="button"
            disabled={resendState === "sending" || resendState === "sent"}
            onClick={() => onResendLink(item)}
            className={cn(
              "inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all",
              resendState === "sent"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-slate-700 bg-transparent text-slate-300 hover:border-slate-500 hover:bg-slate-900/60",
              MOBILE_TAP_TARGET,
              (resendState === "sending" || resendState === "sent") && "opacity-90"
            )}
          >
            {resendState === "sending" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Sending…
              </>
            ) : resendState === "sent" ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Link sent!
              </>
            ) : (
              <>💬 Re-send SMS Link</>
            )}
          </button>
          {resendState === "error" ? (
            <p className="text-center text-[10px] text-rose-400">Could not send — try again.</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No dialable number on this log.</p>
      )}
      {item.count > 1 && item.times.length > 0 ? (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-amber-100/90">
          Called today at {item.times.join(" · ")}
        </p>
      ) : null}
    </li>
  )
}

export function MissedCallRescueSheet({
  open,
  onOpenChange,
  businessNumbers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessNumbers: DashboardBusinessNumber[]
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<MissedCallRow[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  /** phone key → contact/company name from customers table. */
  const [contactNames, setContactNames] = useState<Record<string, string>>({})
  /** phone key → resend button state. */
  const [resendByKey, setResendByKey] = useState<
    Record<string, "idle" | "sending" | "sent" | "error">
  >({})

  const loadMissed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bust caches so the sheet always shows the latest missed activity.
      const [callsRes, customersRes] = await Promise.all([
        fetch(`/api/calls?limit=100&_=${Date.now()}`, {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        }),
        fetch(`/api/customers?limit=200`, {
          credentials: "include",
          cache: "no-store",
        }),
      ])
      if (!callsRes.ok) throw new Error("Could not load missed calls")
      const json = (await callsRes.json()) as { calls?: MissedCallRow[]; data?: MissedCallRow[] }
      const all = Array.isArray(json.calls)
        ? json.calls
        : Array.isArray(json.data)
          ? json.data
          : []
      const missed = all
        .filter((row) => {
          if (businessNumbers.length > 0) {
            const onLine = businessNumbers.some((line) =>
              businessNumbersMatch(row.to_number, line.number)
            )
            if (!onLine) return false
          }
          return isMissedCallTodayRecord({
            call_type: row.call_type,
            status: row.status,
            answered_at: row.answered_at,
            ended_at: row.ended_at,
            routed_to_name: row.routed_to_name ?? null,
            created_at: row.created_at,
          })
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRows(missed)
      setFetchedAt(Date.now())

      // Map saved contacts → display names for phones without CNAM.
      if (customersRes.ok) {
        const custJson = (await customersRes.json()) as {
          customers?: Array<{
            phone_e164?: string
            display_name?: string
            company_name?: string
          }>
        }
        const map: Record<string, string> = {}
        for (const c of custJson.customers ?? []) {
          const key = activityCallerPhoneKey(c.phone_e164 || "") || ""
          if (!key) continue
          const label =
            sanitizeCallerLabel(c.display_name) || sanitizeCallerLabel(c.company_name)
          if (label) map[key] = label
        }
        setContactNames(map)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load missed calls")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [businessNumbers])

  useEffect(() => {
    if (!open) return
    // Clear stale rows immediately so old timestamps do not flash while refetching.
    setRows([])
    setResendByKey({})
    void loadMissed()
  }, [open, loadMissed])

  const hotlist = useMemo(() => {
    const base = collapseMissedHotlist(rows)
    // Fill gaps with saved customer / company names when CNAM was empty.
    return base.map((item) => {
      if (item.displayName) return item
      const contact = contactNames[item.key]
      return contact ? { ...item, displayName: contact } : item
    })
  }, [rows, contactNames])

  // Match Lines HUD math: total miss events vs unique caller phones today.
  const totalMissedCalls = rows.length
  const uniqueLeadsCount = hotlist.length
  const headerTitle =
    totalMissedCalls > 0
      ? `Missed Call Rescue (${totalMissedCalls} Call${totalMissedCalls === 1 ? "" : "s"} · ${uniqueLeadsCount} Lead${uniqueLeadsCount === 1 ? "" : "s"})`
      : "Missed Call Rescue"

  const handleResendLink = useCallback(async (item: MissedHotlistItem) => {
    setResendByKey((prev) => ({ ...prev, [item.key]: "sending" }))
    try {
      const res = await fetch("/api/routing/missed-call-rescue/resend-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: item.from_number,
          business_line: item.to_number || null,
        }),
      })
      if (!res.ok) throw new Error("send_failed")
      setResendByKey((prev) => ({ ...prev, [item.key]: "sent" }))
      // Clear the success badge after a short flash.
      window.setTimeout(() => {
        setResendByKey((prev) => {
          if (prev[item.key] !== "sent") return prev
          const next = { ...prev }
          delete next[item.key]
          return next
        })
      }, 3500)
    } catch {
      setResendByKey((prev) => ({ ...prev, [item.key]: "error" }))
    }
  }, [])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        variant="drawer"
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-slate-850 bg-slate-950 p-0"
      >
        <SheetHeader className="shrink-0 border-b border-slate-850 px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base text-slate-100">
            <PhoneMissed className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <span className="min-w-0 leading-snug">{headerTitle}</span>
          </SheetTitle>
          {/* Non-actionable copy — hide on the smallest phones per global UI standards. */}
          <SheetDescription className="hidden text-xs text-slate-500 md:block">
            Today&apos;s missed numbers — tap Call Back &amp; Rescue to reclaim the lead.
          </SheetDescription>
        </SheetHeader>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 py-3",
            "pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
          )}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading hotlist…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : hotlist.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No missed calls today — nice work.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-fetched-at={fetchedAt || undefined}>
              {hotlist.map((item) => (
                <MissedLeadCard
                  key={item.key}
                  item={item}
                  onResendLink={handleResendLink}
                  resendState={resendByKey[item.key] || "idle"}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Re-export helper for tests / telemetry filtering. */
export function isMissedHotlistRow(row: MissedCallRow): boolean {
  return isMissedCallRecord({
    call_type: row.call_type,
    status: row.status,
    answered_at: row.answered_at,
    ended_at: row.ended_at,
    routed_to_name: row.routed_to_name ?? null,
  })
}
