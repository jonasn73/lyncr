"use client"

// Customers & Leads CRM hub — list + profile (garage, history, Call/SMS). Scheduler stays separate.

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Car,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  Search,
  UserRound,
} from "lucide-react"
import { buildTelHref } from "@/lib/phone-e164"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type {
  CrmCustomerListItem,
  CrmLeadBadge,
  CrmServiceHistoryItem,
  CustomerVehicle,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

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

function isLgViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
}

export const CrmWorkspaceView = memo(function CrmWorkspaceView({
  isActive = true,
}: {
  isActive?: boolean
}) {
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

  // Editable profile fields (name + appointment on the primary open lead/job).
  const [editName, setEditName] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [editApptLeadId, setEditApptLeadId] = useState<string | null>(null)
  const [editApptLocal, setEditApptLocal] = useState("")
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

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
          // Desktop: auto-select first row. Mobile: stay on list until the user taps.
          if (isLgViewport()) return list[0]?.id ?? null
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
        setEditNotes("notes" in c ? String(c.notes ?? "") : "")
      }
      setVehicles(json.data?.vehicles ?? [])
      setHistory(hist)
      const open = hist.find((h) => h.is_open_lead) ?? hist[0] ?? null
      setEditApptLeadId(open?.id ?? null)
      // Only prefill when a real appointment exists — don't use created_at as a fake time.
      setEditApptLocal(isoToDatetimeLocal(open?.scheduled_at ?? null))
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
      setEditNotes("")
      setEditApptLeadId(null)
      setEditApptLocal("")
      return
    }
    const fromList = rows.find((r) => r.id === selectedId) ?? null
    setSelected(fromList)
    if (fromList) {
      setEditName(fromList.display_name || "")
      setEditNotes(fromList.notes || "")
    }
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

  const saveProfileEdits = async () => {
    if (!selectedId || saveBusy) return
    setSaveBusy(true)
    setSaveMsg(null)
    try {
      const body: Record<string, unknown> = {
        display_name: editName,
        notes: editNotes,
      }
      if (editApptLeadId) {
        body.appointment_lead_id = editApptLeadId
        body.scheduled_at = datetimeLocalToIso(editApptLocal)
      }
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
        return
      }
      if (json) applyProfilePayload(json)
      const name = editName.trim()
      setRows((prev) =>
        prev.map((r) =>
          r.id === selectedId ? { ...r, display_name: name, notes: editNotes } : r
        )
      )
      setSaveMsg("Saved")
    } finally {
      setSaveBusy(false)
    }
  }

  const profileBody = !selected ? (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-zinc-500">
      <UserRound className="h-8 w-8 opacity-50" />
      <p className="text-sm">Select a customer to see their profile.</p>
    </div>
  ) : (
    <div className="space-y-5">
      {/* Mobile-only back — returns to the scrollable list */}
      <div className="flex items-center gap-2 lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2 text-zinc-300"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {editName.trim() || formatPhoneDisplay(selected.phone_e164)}
          </h2>
          <p className="mt-0.5 text-sm tabular-nums text-zinc-400">
            {formatPhoneDisplay(selected.phone_e164)}
          </p>
          {selected.company_name.trim() ? (
            <p className="text-xs text-zinc-500">{selected.company_name}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-zinc-500">
            {BADGE_LABEL[selected.lead_badge]} · {selected.jobs_completed} completed ·{" "}
            {formatMoney(selected.lifetime_revenue_cents)} LTV
          </p>
        </div>
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
          <Link
            href="/dashboard/scheduler"
            className="inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-semibold text-zinc-200"
          >
            Open Scheduler
          </Link>
        </div>
      </div>

      {/* Name + appointment — the fields users were missing while editing */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Edit contact
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] text-zinc-500">
            Customer name
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. David"
              className="mt-1 h-10 border-zinc-800 bg-zinc-950"
              autoComplete="name"
            />
          </label>
          <label className="block text-[11px] text-zinc-500">
            Appointment date &amp; time
            <Input
              type="datetime-local"
              value={editApptLocal}
              onChange={(e) => setEditApptLocal(e.target.value)}
              disabled={!editApptLeadId}
              className="mt-1 h-10 border-zinc-800 bg-zinc-950"
            />
            {!editApptLeadId ? (
              <span className="mt-1 block text-[10px] text-zinc-600">
                No open lead/job to schedule yet.
              </span>
            ) : null}
          </label>
          <label className="block text-[11px] text-zinc-500 sm:col-span-2">
            Notes
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={saveBusy} onClick={() => void saveProfileEdits()}>
            {saveBusy ? "Saving…" : "Save changes"}
          </Button>
          {saveMsg ? (
            <span
              className={cn(
                "text-xs",
                saveMsg === "Saved" ? "text-emerald-400" : "text-rose-300"
              )}
            >
              {saveMsg}
            </span>
          ) : null}
        </div>
      </div>

      {profileLoading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading profile…
        </div>
      ) : null}

      {/* Vehicle garage */}
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

      {/* Service history */}
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
                <p className="mt-1 text-[11px] text-zinc-500">
                  {item.scheduled_at
                    ? `Appt ${new Date(item.scheduled_at).toLocaleString()}`
                    : item.at
                      ? new Date(item.at).toLocaleString()
                      : ""}
                  {item.assigned_tech_name ? ` · ${item.assigned_tech_name}` : ""}
                  {item.amount_cents != null && item.amount_cents > 0
                    ? ` · ${formatMoney(item.amount_cents)}`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )

  return (
    // pb clears the fixed mobile dock so the last list cards stay reachable while main scrolls.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 sm:px-4 md:pb-8">
      <header className={cn("flex flex-col gap-1", selectedId && "hidden lg:flex")}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CRM</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Customers &amp; Leads
        </h1>
        <p className="hidden text-sm text-zinc-500 md:block">
          One place for people, vehicles, history, and follow-ups. Scheduler stays for assigning work.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:items-start lg:gap-4">
        {/* —— List column —— */}
        {/* Mobile: page scroll (no nested overflow trap). Desktop: capped inner scroll. */}
        <section
          className={cn(
            "flex flex-col rounded-2xl border border-zinc-800/90 bg-zinc-950/60 lg:min-h-0 lg:max-h-[calc(100dvh-10rem)]",
            selectedId && "hidden lg:flex"
          )}
        >
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

          <div className="p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
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
                        onClick={() => {
                          setSelectedId(row.id)
                          // Jump to top so the mobile detail view isn't mid-scroll from the list.
                          if (!isLgViewport()) {
                            document.querySelector("main")?.scrollTo({ top: 0 })
                          }
                        }}
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

        {/* —— Profile column (desktop always; mobile only when a row is selected) —— */}
        <section
          className={cn(
            "rounded-2xl border border-zinc-800/90 bg-zinc-950/60 p-3 sm:p-4 lg:sticky lg:top-3 lg:min-h-[20rem] lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto",
            !selectedId && "hidden lg:block"
          )}
        >
          {profileBody}
        </section>
      </div>
    </div>
  )
})
