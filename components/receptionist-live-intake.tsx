"use client"

// Live intake form that takes over the receptionist HUD the instant a call connects.
// Driven by the real-time `call-connected` payload; fields swap by business type.

import { useEffect, useMemo, useState } from "react"
import { Loader2, PhoneCall, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"

export type LiveCallSession = {
  callLogId: string
  businessType: "locksmith" | "detailing" | "auto_repair" | "generic"
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  startedAt: string
}

type FieldDef = {
  name: string
  label: string
  type: "text" | "textarea" | "select" | "toggle"
  placeholder?: string
  options?: string[]
  required?: boolean
  full?: boolean
}

// Field layouts per vertical. Locksmith mirrors the automotive AKL intake we already store.
const FIELD_SETS: Record<LiveCallSession["businessType"], { title: string; fields: FieldDef[] }> = {
  locksmith: {
    title: "Locksmith call intake",
    fields: [
      { name: "year", label: "Vehicle year", type: "text", placeholder: "2019", required: true },
      { name: "make", label: "Make", type: "text", placeholder: "Toyota", required: true },
      { name: "model", label: "Model", type: "text", placeholder: "Camry", required: true },
      {
        name: "key_type",
        label: "Key type",
        type: "select",
        options: ["transponder", "proximity (smart key)", "standard / metal", "high-security"],
      },
      { name: "akl", label: "All keys lost?", type: "toggle" },
      { name: "vin", label: "VIN (optional)", type: "text", placeholder: "1HGCM82633A004352" },
      { name: "location", label: "Vehicle location / address", type: "text", placeholder: "123 Main St", full: true },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Anything else the tech should know…", full: true },
    ],
  },
  detailing: {
    title: "Detailing call intake",
    fields: [
      { name: "vehicle", label: "Vehicle (year / make / model)", type: "text", placeholder: "2021 Tesla Model 3", required: true, full: true },
      {
        name: "service_package",
        label: "Service package",
        type: "select",
        options: ["Interior only", "Exterior only", "Full detail", "Ceramic coating"],
      },
      {
        name: "condition",
        label: "Vehicle condition",
        type: "select",
        options: ["Light", "Moderate", "Heavy"],
      },
      { name: "service_address", label: "Service address", type: "text", placeholder: "123 Main St", full: true },
      { name: "preferred_time", label: "Preferred date / time", type: "text", placeholder: "Sat morning" },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Pet hair, stains, etc.", full: true },
    ],
  },
  auto_repair: {
    title: "Auto repair call intake",
    fields: [
      { name: "vehicle", label: "Vehicle (year / make / model)", type: "text", placeholder: "2018 Honda Accord", required: true, full: true },
      { name: "mileage", label: "Mileage (optional)", type: "text", placeholder: "84,000" },
      {
        name: "service_type",
        label: "Service needed",
        type: "select",
        options: ["Diagnostic / check engine", "Brakes", "Oil change", "Tires / alignment", "Engine / transmission", "Other"],
      },
      { name: "symptoms", label: "Symptoms / issue", type: "text", placeholder: "Grinding noise when braking", full: true },
      { name: "drivable", label: "Is the vehicle drivable?", type: "toggle" },
      { name: "preferred_time", label: "Preferred drop-off date / time", type: "text", placeholder: "Mon morning" },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Anything else the shop should know…", full: true },
    ],
  },
  generic: {
    title: "Call intake",
    fields: [
      { name: "reason", label: "Reason for call", type: "text", placeholder: "What does the caller need?", required: true, full: true },
      { name: "address", label: "Address (optional)", type: "text", placeholder: "123 Main St", full: true },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Anything else…", full: true },
    ],
  },
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const start = new Date(startedAt).getTime()
  const elapsed = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000))
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  return <span className="tabular-nums">{`${mm}:${ss.toString().padStart(2, "0")}`}</span>
}

const inputClass =
  "w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"

export function ReceptionistLiveIntake({
  session,
  callerNameFallback,
  onDismiss,
}: {
  session: LiveCallSession
  callerNameFallback?: string | null
  onDismiss: (reason: "saved" | "dismissed") => void
}) {
  const config = FIELD_SETS[session.businessType] ?? FIELD_SETS.generic
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const callerName = session.callerName || callerNameFallback || null
  const callerNumber = session.callerNumber || null

  const setField = (name: string, value: string | boolean) =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const missingRequired = useMemo(
    () => config.fields.filter((f) => f.required).some((f) => !String(values[f.name] ?? "").trim()),
    [config.fields, values]
  )

  function buildSummary(): string {
    return (
      config.fields
        .map((f) => {
          const v = values[f.name]
          if (v === undefined || v === "" || v === false) return null
          return `${f.label}: ${v === true ? "Yes" : v}`
        })
        .filter(Boolean)
        .join(" · ") || ""
    )
  }

  // Job disposition → owner pipeline (BOOKED routes for review, PRICE_REJECTED goes to salvage).
  async function logJob(status: "BOOKED" | "PRICE_REJECTED") {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/receptionist/log-job", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId: session.callLogId,
          status,
          businessType: session.businessType,
          callerNumber,
          callerName,
          summary: buildSummary() || null,
          fields: values,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log job")
      setSavedMsg(
        status === "BOOKED"
          ? "Booked — the owner has been notified."
          : "Logged as price-rejected — sent to the owner's salvage queue."
      )
      window.setTimeout(() => onDismiss("saved"), 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error logging job")
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const summaryBits = config.fields
        .map((f) => {
          const v = values[f.name]
          if (v === undefined || v === "" || v === false) return null
          return `${f.label}: ${v === true ? "Yes" : v}`
        })
        .filter(Boolean)
      const res = await fetch("/api/receptionist/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId: session.callLogId,
          businessType: session.businessType,
          callerNumber,
          callerName,
          summary: summaryBits.join(" · ") || null,
          fields: values,
        }),
      })
      const json = (await res.json()) as { error?: string; data?: { sms_sent: boolean; sms_error: string | null } }
      if (!res.ok) throw new Error(json.error ?? "Could not save intake")
      setSavedMsg(
        json.data?.sms_sent
          ? json.data.sms_error
            ? "Saved — lead text accepted (delivery may be pending 10DLC)."
            : "Saved & lead text sent to the owner."
          : "Intake saved."
      )
      window.setTimeout(() => onDismiss("saved"), 1100)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error saving intake")
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePanel className="overflow-hidden border-emerald-500/40 bg-emerald-950/10 p-0">
      {/* Live call header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/30" />
            <PhoneCall className="relative h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">Live call connected</p>
            <p className="text-lg font-semibold text-foreground">
              {callerName || (callerNumber ? formatPhoneDisplay(callerNumber) : "Incoming caller")}
            </p>
            <p className="text-xs text-emerald-200/70">
              {callerNumber ? formatPhoneDisplay(callerNumber) : "Unknown number"}
              {session.businessName ? ` · ${session.businessName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <ElapsedTimer startedAt={session.startedAt} />
        </div>
      </div>

      {/* Intake form */}
      <div className="px-5 py-5">
        <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
        <p className="mt-1 text-xs text-zinc-500">Fill this in while you talk — it texts the owner the moment you save.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className={cn(field.full ? "sm:col-span-2" : "")}>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                {field.label}
                {field.required ? <span className="text-emerald-400"> *</span> : null}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  className={cn(inputClass, "min-h-[70px] resize-y")}
                  placeholder={field.placeholder}
                  value={String(values[field.name] ?? "")}
                  onChange={(e) => setField(field.name, e.target.value)}
                />
              ) : field.type === "select" ? (
                <select
                  className={inputClass}
                  value={String(values[field.name] ?? "")}
                  onChange={(e) => setField(field.name, e.target.value)}
                >
                  <option value="">Select…</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : field.type === "toggle" ? (
                <button
                  type="button"
                  onClick={() => setField(field.name, !(values[field.name] === true))}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    values[field.name] === true
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                      : "border-border/70 bg-background text-zinc-400"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border",
                      values[field.name] === true ? "border-emerald-400 bg-emerald-400 text-emerald-950" : "border-zinc-600"
                    )}
                  >
                    {values[field.name] === true ? <Check className="h-3 w-3" aria-hidden /> : null}
                  </span>
                  {values[field.name] === true ? "Yes" : "No"}
                </button>
              ) : (
                <input
                  type="text"
                  className={inputClass}
                  placeholder={field.placeholder}
                  value={String(values[field.name] ?? "")}
                  onChange={(e) => setField(field.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {savedMsg ? (
          <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {savedMsg}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Disposition:</span>
            <button
              type="button"
              onClick={() => void logJob("BOOKED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden />
              Booked
            </button>
            <button
              type="button"
              onClick={() => void logJob("PRICE_REJECTED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
              Price rejected
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDismiss("dismissed")}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-4 py-2 text-sm font-medium text-zinc-400 transition hover:text-zinc-200 disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
              Dismiss
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || missingRequired || Boolean(savedMsg)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              Save & text owner
            </button>
          </div>
        </div>
      </div>
    </WorkspacePanel>
  )
}
