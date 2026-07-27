"use client"

// Customers & Leads CRM hub — list + profile (desktop side panel / mobile centered dialog).

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  CalendarCheck,
  Car,
  Check,
  Loader2,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react"
import { buildTelHref } from "@/lib/phone-e164"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { writeLeadsIntakeHandoff } from "@/lib/leads-intake-handoff"
import type {
  CrmCustomerListItem,
  CrmLeadBadge,
  CrmServiceHistoryItem,
  CustomerVehicle,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Prefer lead YMM, then garage, so Convert → intake opens with a vehicle already filled. */
function resolveConvertVehicle(
  lead: CrmServiceHistoryItem | null | undefined,
  garage: CustomerVehicle[]
): { year?: string; make?: string; model?: string } {
  const fromLead = {
    year: lead?.vehicle_year?.trim() || undefined,
    make: lead?.vehicle_make?.trim() || undefined,
    model: lead?.vehicle_model?.trim() || undefined,
  }
  if (fromLead.year || fromLead.make || fromLead.model) return fromLead
  const v = garage[0]
  if (!v) return {}
  return {
    year: v.year?.trim() || undefined,
    make: v.make?.trim() || undefined,
    model: v.model?.trim() || undefined,
  }
}

type CrmFilter = "all" | "leads" | "clients"

const BADGE_LABEL: Record<CrmLeadBadge, string> = {
  booked_client: "Booked client",
  price_quoted: "Price quoted",
  callback: "Call back",
  repeat_customer: "Repeat customer",
  new_contact: "New contact",
}

function formatMoney(cents: number): string {
  return (Math.max(0, cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  })
}

function followUpTemplate(name: string, vehicleLabel: string | null): string {
  const who = name.trim() || "there"
  const vehicle = vehicleLabel?.trim() || "your vehicle"
  return `Hi ${who}, just checking in regarding your quote for the ${vehicle}. We still have tech availability today—let us know if you'd like to get on the schedule!`
}

/** datetime-local value from ISO (browser local timezone). */
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(local: string): string | null {
  const t = local.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export const CrmWorkspaceView = memo(function CrmWorkspaceView({
  isActive = true,
}: {
  isActive?: boolean
}) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const initialFilter: CrmFilter =
    tabParam === "leads" ? "leads" : tabParam === "clients" ? "clients" : "all"

  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  const [filter, setFilter] = useState<CrmFilter>(initialFilter)
  const [rows, setRows] = useState<CrmCustomerListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([])
  const [history, setHistory] = useState<CrmServiceHistoryItem[]>([])
  const [selected, setSelected] = useState<CrmCustomerListItem | null>(null)
  const [addingVehicle, setAddingVehicle] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({
    year: "",
    make: "",
    model: "",
    vin: "",
    fcc_id: "",
  })
  const [vehicleBusy, setVehicleBusy] = useState(false)

  // Profile fields — name inline; appointment edited on history rows.
  const [editName, setEditName] = useState("")
  // Which history row is in micro-edit for scheduled appointment (lead/job id).
  const [editingApptId, setEditingApptId] = useState<string | null>(null)
  // datetime-local draft while editing that row’s appointment.
  const [editApptLocal, setEditApptLocal] = useState("")
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)

  useEffect(() => {
    if (tabParam === "leads") setFilter("leads")
    else if (tabParam === "clients") setFilter("clients")
  }, [tabParam])

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 280)
    return () => window.clearTimeout(t)
  }, [q])

  const loadList = useCallback(() => {
    if (!isActive) return
    setLoading(true)
    const params = new URLSearchParams()
    if (debounced) params.set("q", debounced)
    params.set("filter", filter)
    fetch(`/api/crm/customers?${params.toString()}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Could not load customers")
        }
        return res.json() as Promise<{ data?: { customers?: CrmCustomerListItem[] } }>
      })
      .then((json) => {
        const list = json.data?.customers ?? []
        setRows(list)
        setError(null)
        setSelectedId((prev) => {
          if (prev && list.some((r) => r.id === prev)) return prev
          return null
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [debounced, filter, isActive])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const applyProfilePayload = useCallback(
    (json: {
      data?: {
        customer?: CrmCustomerListItem | { id: string; display_name: string; notes: string; phone_e164: string; company_name: string }
        vehicles?: CustomerVehicle[]
        history?: CrmServiceHistoryItem[]
      }
    }) => {
      const c = json.data?.customer
      const hist = json.data?.history ?? []
      if (c) {
        setSelected((prev) => ({
          ...(prev && prev.id === c.id ? prev : ({} as CrmCustomerListItem)),
          ...c,
          jobs_completed: prev?.id === c.id ? prev.jobs_completed : 0,
          lifetime_revenue_cents: prev?.id === c.id ? prev.lifetime_revenue_cents : 0,
          lead_badge: prev?.id === c.id ? prev.lead_badge : "new_contact",
          open_lead_count: prev?.id === c.id ? prev.open_lead_count : 0,
        }))
        setEditName(c.display_name ?? "")
      }
      setVehicles(json.data?.vehicles ?? [])
      setHistory(hist)
    },
    []
  )

  const loadProfile = useCallback(
    (id: string) => {
      setProfileLoading(true)
      setSaveMsg(null)
      fetch(`/api/crm/customers/${encodeURIComponent(id)}`, { credentials: "include" })
        .then(async (res) => {
          if (!res.ok) throw new Error("profile")
          return res.json()
        })
        .then((json) => applyProfilePayload(json))
        .catch(() => {
          setVehicles([])
          setHistory([])
        })
        .finally(() => setProfileLoading(false))
    },
    [applyProfilePayload]
  )

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      setVehicles([])
      setHistory([])
      setEditName("")
      setEditingApptId(null)
      setEditApptLocal("")
      setEditingName(false)
      return
    }
    const fromList = rows.find((r) => r.id === selectedId) ?? null
    setSelected(fromList)
    if (fromList) {
      setEditName(fromList.display_name || "")
    }
    setEditingName(false)
    setEditingApptId(null)
    setEditApptLocal("")
    void loadProfile(selectedId)
  }, [selectedId, rows, loadProfile])

  const openLeadHistory = useMemo(
    () => history.filter((h) => h.is_open_lead),
    [history]
  )
  const vehicleForFollowUp =
    vehicles[0] != null
      ? [vehicles[0].year, vehicles[0].make, vehicles[0].model].filter(Boolean).join(" ")
      : openLeadHistory[0]?.vehicle_label ?? history[0]?.vehicle_label ?? null

  const messagesHref = selected
    ? `/dashboard/messages?phone=${encodeURIComponent(selected.phone_e164)}`
    : "/dashboard/messages"

  const followUpHref = selected
    ? `/dashboard/messages?phone=${encodeURIComponent(selected.phone_e164)}&draft=${encodeURIComponent(
        followUpTemplate(editName.trim() || selected.display_name || "there", vehicleForFollowUp)
      )}`
    : messagesHref

  const canConvertToBooking =
    Boolean(selected) &&
    (selected?.lead_badge === "price_quoted" ||
      selected?.lead_badge === "callback" ||
      openLeadHistory.length > 0)

  /**
   * Seed scheduler intake with this open quote/callback lead, then open Scheduler.
   * Booking upgrades the same ai_leads row (no duplicate).
   * Close the CRM profile Dialog/panel first — workspace panes stay mounted, so an open
   * Dialog (z-[7000]) would otherwise cover CallAnsweredModal intake (default sheet z-[6000]).
   */
  const convertToBooking = useCallback(
    (lead?: CrmServiceHistoryItem | null) => {
      if (!selected) return
      const target = lead ?? openLeadHistory[0] ?? null
      if (!target?.id) return
      const ymm = resolveConvertVehicle(target, vehicles)
      // Capture fields before closing — close clears selectedId / selected on next paint.
      const handoff = {
        leadId: target.id,
        phoneNumber: selected.phone_e164,
        customerName: editName.trim() || selected.display_name || "",
        vehicleYear: ymm.year,
        vehicleMake: ymm.make,
        vehicleModel: ymm.model,
        quotedPriceCents:
          target.amount_cents != null && target.amount_cents > 0
            ? Math.round(target.amount_cents)
            : undefined,
      }
      // Drop the profile layer immediately so Scheduler intake is not trapped under it.
      setSelectedId(null)
      setSelected(null)
      writeLeadsIntakeHandoff(handoff)
      router.push("/dashboard/scheduler")
    },
    [selected, openLeadHistory, vehicles, editName, router]
  )

  const addVehicle = async () => {
    if (!selectedId || vehicleBusy) return
    setVehicleBusy(true)
    try {
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(selectedId)}/vehicles`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vehicleForm),
      })
      const json = (await res.json().catch(() => null)) as {
        data?: { vehicle?: CustomerVehicle }
        error?: string
        migration?: string
      } | null
      if (!res.ok) {
        alert(json?.migration ? `Run ${json.migration} in Neon` : json?.error || "Could not add vehicle")
        return
      }
      if (json?.data?.vehicle) {
        setVehicles((prev) => [json.data!.vehicle!, ...prev])
        setAddingVehicle(false)
        setVehicleForm({ year: "", make: "", model: "", vin: "", fcc_id: "" })
      }
    } finally {
      setVehicleBusy(false)
    }
  }

  /** Partial PATCH — only send the fields the user just edited. */
  const patchProfile = async (body: Record<string, unknown>) => {
    if (!selectedId || saveBusy) return false
    setSaveBusy(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as {
        data?: {
          customer?: CrmCustomerListItem
          vehicles?: CustomerVehicle[]
          history?: CrmServiceHistoryItem[]
        }
        error?: string
      } | null
      if (!res.ok) {
        setSaveMsg(json?.error || "Could not save")
        return false
      }
      if (json) applyProfilePayload(json)
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== selectedId) return r
          return {
            ...r,
            ...(typeof body.display_name === "string"
              ? { display_name: String(body.display_name).trim() }
              : {}),
          }
        })
      )
      setSaveMsg("Saved")
      return true
    } finally {
      setSaveBusy(false)
    }
  }

  const saveName = async () => {
    const ok = await patchProfile({ display_name: editName })
    if (ok) setEditingName(false)
  }

  /** Open compact appointment editor for one service-history lead/job row. */
  const beginEditAppointment = (item: CrmServiceHistoryItem) => {
    setEditingApptId(item.id)
    // Prefill only a real scheduled_at — never the call/created time.
    setEditApptLocal(isoToDatetimeLocal(item.scheduled_at ?? null))
    setSaveMsg(null)
  }

  const cancelEditAppointment = () => {
    setEditingApptId(null)
    setEditApptLocal("")
  }

  const saveAppointment = async (leadId: string, localValue: string) => {
    const ok = await patchProfile({
      appointment_lead_id: leadId,
      scheduled_at: datetimeLocalToIso(localValue),
    })
    if (ok) cancelEditAppointment()
  }

  const clearAppointment = async (leadId: string) => {
    const ok = await patchProfile({
      appointment_lead_id: leadId,
      scheduled_at: null,
    })
    if (ok) cancelEditAppointment()
  }

  const closeProfile = () => setSelectedId(null)
  const profileOpen = selectedId != null

  /** Name + pencil in the profile header (desktop panel + mobile dialog). */
  const renderProfileName = (titleClassName: string) => {
    if (!selected) return null
    const fallback = formatPhoneDisplay(selected.phone_e164)
    if (editingName) {
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Customer name"
            className="h-9 min-w-0 flex-1 border-zinc-800 bg-zinc-950"
            autoComplete="name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName()
              if (e.key === "Escape") {
                setEditName(selected.display_name || "")
                setEditingName(false)
              }
            }}
          />
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void saveName()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
            aria-label="Save name"
          >
            {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => {
              setEditName(selected.display_name || "")
              setEditingName(false)
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            aria-label="Cancel name edit"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    }
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("min-w-0 truncate", titleClassName)}>
          {editName.trim() || fallback}
        </span>
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Edit name"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Factory so desktop panel + mobile dialog each get their own element tree.
  const renderProfileBody = () =>
    !selected ? (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    ) : (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <a
            href={buildTelHref(selected.phone_e164) || undefined}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-200"
          >
            <Phone className="h-3.5 w-3.5" />
            Call
          </a>
          <Link
            href={messagesHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 text-xs font-semibold text-sky-200"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Quick SMS
          </Link>
          {(selected.lead_badge === "price_quoted" ||
            selected.lead_badge === "callback" ||
            openLeadHistory.length > 0) && (
            <Link
              href={followUpHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-semibold text-amber-100"
            >
              Send follow-up
            </Link>
          )}
          {canConvertToBooking && openLeadHistory[0] ? (
            <button
              type="button"
              onClick={() => convertToBooking(openLeadHistory[0])}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/20 px-3 text-xs font-semibold text-emerald-100"
              title="Open intake with this quote — booking upgrades the same lead"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              Convert to booking
            </button>
          ) : null}
          <Link
            href="/dashboard/scheduler"
            onClick={() => {
              // Same keep-alive pane issue as Convert — close profile before leaving CRM.
              setSelectedId(null)
              setSelected(null)
            }}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-200"
          >
            Open Scheduler
          </Link>
        </div>

        {saveMsg && saveMsg !== "Saved" ? (
          <p className="text-xs text-rose-300">{saveMsg}</p>
        ) : null}

        {profileLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profile…
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Vehicle garage
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => setAddingVehicle((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add vehicle
            </Button>
          </div>
          {addingVehicle ? (
            <div className="mb-3 grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 sm:grid-cols-2">
              {(
                [
                  ["year", "Year"],
                  ["make", "Make"],
                  ["model", "Model"],
                  ["vin", "VIN"],
                  ["fcc_id", "FCC ID"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-[11px] text-zinc-500">
                  {label}
                  <Input
                    value={vehicleForm[key]}
                    onChange={(e) =>
                      setVehicleForm((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="mt-1 h-9 border-zinc-800 bg-zinc-950"
                  />
                </label>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={vehicleBusy}
                  onClick={() => void addVehicle()}
                >
                  {vehicleBusy ? "Saving…" : "Save vehicle"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingVehicle(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {vehicles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">
              No vehicles yet. Add one, or save YMM from intake (after migration 120).
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {vehicles.map((v) => (
                <li
                  key={v.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2">
                    <Car className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                      </p>
                      {v.vin ? (
                        <p className="truncate text-[11px] text-zinc-500">VIN {v.vin}</p>
                      ) : null}
                      {v.fcc_id ? (
                        <p className="truncate text-[11px] text-zinc-500">FCC {v.fcc_id}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Service history &amp; quotes
          </h3>
          {history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">
              No jobs or leads for this phone yet.
            </p>
          ) : (
            <ol className="space-y-2">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-100">
                      {item.summary?.trim() || item.vehicle_label || "Service"}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        item.status_tone === "emerald" && "bg-emerald-500/15 text-emerald-300",
                        item.status_tone === "amber" && "bg-amber-500/15 text-amber-200",
                        item.status_tone === "rose" && "bg-rose-500/15 text-rose-300",
                        item.status_tone === "sky" && "bg-sky-500/15 text-sky-200",
                        item.status_tone === "neutral" && "bg-zinc-800 text-zinc-400"
                      )}
                    >
                      {item.status_label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    {/* Call / lead timestamp — not the future appointment */}
                    <span className="min-w-0 truncate">
                      {item.at ? new Date(item.at).toLocaleString() : ""}
                      {item.assigned_tech_name ? ` · ${item.assigned_tech_name}` : ""}
                      {item.amount_cents != null && item.amount_cents > 0
                        ? ` · ${formatMoney(item.amount_cents)}`
                        : ""}
                    </span>
                    {/* Compact future-appointment control (distinct from call time) */}
                    {editingApptId === item.id ? (
                      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                          Appt
                        </span>
                        <Input
                          type="datetime-local"
                          value={editApptLocal}
                          onChange={(e) => setEditApptLocal(e.target.value)}
                          className="h-7 w-[11.5rem] border-zinc-800 bg-zinc-950 px-1.5 text-[11px]"
                          aria-label="Appointment date and time"
                        />
                        <button
                          type="button"
                          disabled={saveBusy || !editApptLocal.trim()}
                          onClick={() => void saveAppointment(item.id, editApptLocal)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-emerald-300 hover:bg-zinc-800 disabled:opacity-40"
                          aria-label="Save appointment"
                          title="Save appointment"
                        >
                          {saveBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={saveBusy}
                          onClick={cancelEditAppointment}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                          aria-label="Cancel"
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {item.scheduled_at ? (
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={() => void clearAppointment(item.id)}
                            className="h-6 rounded px-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                            title="Clear appointment"
                          >
                            Clear
                          </button>
                        ) : null}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => beginEditAppointment(item)}
                        className="inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded px-0.5 text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300"
                        title={
                          item.scheduled_at
                            ? "Edit scheduled appointment"
                            : "Set scheduled appointment"
                        }
                        aria-label={
                          item.scheduled_at
                            ? "Edit scheduled appointment"
                            : "Set scheduled appointment"
                        }
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                          Appt
                        </span>
                        {item.scheduled_at ? (
                          <span className="truncate text-[10px] text-sky-300/90">
                            {new Date(item.scheduled_at).toLocaleString(undefined, {
                              month: "numeric",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : null}
                        <Pencil className="h-3 w-3 shrink-0 opacity-70" />
                      </button>
                    )}
                    {/* Open quote/callback → same handoff the header Convert button uses */}
                    {item.is_open_lead ? (
                      <button
                        type="button"
                        onClick={() => convertToBooking(item)}
                        className="inline-flex h-5 items-center gap-1 rounded px-0.5 text-[10px] font-semibold text-emerald-300/90 hover:bg-zinc-800 hover:text-emerald-200"
                        title="Convert this quote to a booking"
                      >
                        <CalendarCheck className="h-3 w-3" />
                        Convert to booking
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    )

  const renderProfileMeta = () =>
    selected ? (
      <>
        <span className="tabular-nums">{formatPhoneDisplay(selected.phone_e164)}</span>
        {selected.company_name.trim() ? ` · ${selected.company_name}` : ""}
        {" · "}
        {BADGE_LABEL[selected.lead_badge]} · {selected.jobs_completed} completed ·{" "}
        {formatMoney(selected.lifetime_revenue_cents)} LTV
      </>
    ) : null

  return (
    // pb clears the fixed mobile dock so the last list cards stay reachable while main scrolls.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 sm:px-4 md:pb-8">
      <header className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CRM</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Customers &amp; Leads
        </h1>
        <p className="hidden text-sm text-zinc-500 md:block">
          One place for people, vehicles, history, and follow-ups. Scheduler stays for assigning work.
        </p>
      </header>

      <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] md:items-start md:gap-4">
        {/* List — always visible (dimmed behind the mobile dialog) */}
        <section className="flex flex-col rounded-2xl border border-zinc-800/90 bg-zinc-950/60 md:min-h-0 md:max-h-[calc(100dvh-10rem)]">
          <div className="shrink-0 space-y-2 border-b border-zinc-800/80 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or phone…"
                className="h-10 border-zinc-800 bg-zinc-900/80 pl-9"
                aria-label="Search customers"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="CRM filters">
              {(
                [
                  ["all", "All"],
                  ["leads", "Leads"],
                  ["clients", "Clients"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                    filter === id
                      ? "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/40"
                      : "bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-300"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
            {loading && rows.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : error ? (
              <p className="px-2 py-6 text-center text-sm text-rose-300">{error}</p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-zinc-500">
                No customers yet. Save a caller from intake — they’ll show up here.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((row) => {
                  const active = row.id === selectedId
                  const name = row.display_name.trim() || formatPhoneDisplay(row.phone_e164)
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className={cn(
                          "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                          active
                            ? "border-sky-500/40 bg-sky-500/10"
                            : "border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-100">{name}</p>
                          <span className="shrink-0 rounded-md bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                            {BADGE_LABEL[row.lead_badge]}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-400">
                          {formatPhoneDisplay(row.phone_e164)}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          {row.jobs_completed} job{row.jobs_completed === 1 ? "" : "s"} ·{" "}
                          {formatMoney(row.lifetime_revenue_cents)} LTV
                          {row.open_lead_count > 0
                            ? ` · ${row.open_lead_count} open lead${row.open_lead_count === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Desktop (md+): side panel — never a sheet/dialog */}
        <section className="hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/60 p-3 sm:p-4 md:sticky md:top-3 md:block md:min-h-[20rem] md:max-h-[calc(100dvh-10rem)] md:overflow-y-auto">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-zinc-500">
              <UserRound className="h-8 w-8 opacity-50" />
              <p className="text-sm">Select a customer to see their profile.</p>
            </div>
          ) : (
            <>
              {selected ? (
                <div className="mb-4 border-b border-zinc-800 pb-3">
                  {renderProfileName("text-lg font-semibold text-zinc-100")}
                  <p className="mt-0.5 text-sm text-zinc-400">{renderProfileMeta()}</p>
                </div>
              ) : null}
              {renderProfileBody()}
            </>
          )}
        </section>
      </div>

      {/* Mobile: compact centered floating dialog (list stays dimmed behind).
          Gate on isActive — CRM pane stays mounted when switching tabs; without this,
          Convert to booking can leave the Dialog open over Scheduler intake. */}
      <Dialog
        open={isActive && isMobile && profileOpen}
        onOpenChange={(open) => {
          if (!open) closeProfile()
        }}
      >
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 shadow-2xl",
            "max-h-[min(85dvh,36rem)] w-[calc(100%-2rem)] max-w-md",
            "[&>button]:top-3 [&>button]:right-3 [&>button]:text-zinc-400"
          )}
        >
          {selected ? (
            <>
              <DialogHeader className="border-b border-zinc-800 px-4 pb-3 pt-4 pr-12 text-left">
                <DialogTitle asChild>
                  <div className="text-lg font-semibold text-zinc-100">
                    {renderProfileName("text-lg font-semibold text-zinc-100")}
                  </div>
                </DialogTitle>
                <DialogDescription className="text-zinc-400">
                  {renderProfileMeta()}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(72dvh,30rem)] overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {renderProfileBody()}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
})
