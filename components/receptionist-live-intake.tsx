"use client"

// Live intake form that takes over the receptionist HUD the instant a call connects.
// Driven by the real-time `call-connected` payload; fields swap by business type.

import { useEffect, useMemo, useState } from "react"
import { Loader2, PhoneCall, Check, X, Clock, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import {
  IndustryIntakeFormFields,
  intakeValuesComplete,
  serializeIntakeValues,
  type IntakeFormValues,
} from "@/components/industry-intake-form-fields"
import { buildFieldServiceSummary, intakeFieldsForProfile, intakeTitleForProfile } from "@/lib/field-service-intake"
import { resolveWorkspaceIntakeProfile } from "@/lib/workspace-intake-profile"

export type LiveCallSession = {
  callLogId: string
  businessType: "locksmith" | "detailing" | "auto_repair" | "generic"
  callerNumber?: string | null
  callerName?: string | null
  businessName?: string | null
  startedAt: string
}

function intakeConfigFor(session: LiveCallSession) {
  const profile = resolveWorkspaceIntakeProfile({
    organizationName: session.businessName,
    callBusinessType: session.businessType,
  })
  return {
    profile,
    title: intakeTitleForProfile(profile),
    fields: intakeFieldsForProfile(profile),
  }
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

function intakeDraftKey(callLogId: string): string {
  return `lyncr-intake-draft-${callLogId}`
}

type JobDisposition = "BOOKED" | "PENDING_TIME" | "PRICE_REJECTED" | "FAILED"

const DISPOSITION_MESSAGES: Record<JobDisposition, string> = {
  BOOKED: "Booked — the owner has been notified.",
  PENDING_TIME: "Pending time — added to the owner scheduler.",
  PRICE_REJECTED: "Logged as price-rejected — sent to the owner's salvage queue.",
  FAILED: "Logged as failed — the owner has been notified.",
}

export function ReceptionistLiveIntake({
  session,
  callerNameFallback,
  onDismiss,
}: {
  session: LiveCallSession
  callerNameFallback?: string | null
  onDismiss: (reason: "saved" | "dismissed") => void
}) {
  const config = intakeConfigFor(session)
  const [values, setValues] = useState<IntakeFormValues>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const callerName = session.callerName || callerNameFallback || null
  const callerNumber = session.callerNumber || null
  const draftKey = intakeDraftKey(session.callLogId)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as IntakeFormValues
      if (parsed && typeof parsed === "object") setValues(parsed)
    } catch {
      /* ignore corrupt draft */
    }
  }, [draftKey])

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(values))
    } catch {
      /* quota / private mode */
    }
  }, [draftKey, values])

  const setField = (name: string, value: string | boolean | import("@/lib/structured-address").StructuredAddress | null) =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const missingRequired = useMemo(
    () => !intakeValuesComplete(config.fields, values),
    [config.fields, values]
  )

  function buildSummary(): string {
    return buildFieldServiceSummary(serializeIntakeValues(values), { customerName: callerName })
  }

  // Job disposition → owner pipeline (BOOKED, PENDING_TIME, PRICE_REJECTED, FAILED).
  async function logJob(status: JobDisposition) {
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
          fields: serializeIntakeValues(values),
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not log job")
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
      setSavedMsg(DISPOSITION_MESSAGES[status])
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
      const summaryBits = buildSummary()
      const res = await fetch("/api/receptionist/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callLogId: session.callLogId,
          businessType: session.businessType,
          callerNumber,
          callerName,
          summary: summaryBits || null,
          fields: serializeIntakeValues(values),
        }),
      })
      const json = (await res.json()) as { error?: string; data?: { sms_sent: boolean; sms_error: string | null } }
      if (!res.ok) throw new Error(json.error ?? "Could not save intake")
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">Call notepad / lead dispatcher</p>
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

        <div className="mt-4">
          <IndustryIntakeFormFields fields={config.fields} values={values} onChange={setField} />
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
              onClick={() => void logJob("PENDING_TIME")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clock className="h-4 w-4" aria-hidden />
              Pending time
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
            <button
              type="button"
              onClick={() => void logJob("FAILED")}
              disabled={saving || Boolean(savedMsg)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/40 bg-zinc-500/10 px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Failed
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
