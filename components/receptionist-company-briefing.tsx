"use client"

// Receptionist web-phone "Company Briefing Card" — a dark-themed screen-pop overlay that opens the
// instant a WEB call rings. It looks up the target business (by the inbound line, falling back to the
// operator's linked business) so the agent can answer as that specific company, then shows a cheat
// sheet of hours, service rules, and the owner's live dispatch notes.

import { useEffect, useState } from "react"
import {
  Clock,
  ClipboardList,
  FileText,
  Loader2,
  Megaphone,
  PhoneCall,
  PhoneOff,
  Repeat,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CompanyBriefing, ReceptionistCallerLookup } from "@/lib/types"

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return "Unknown caller"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

/** Tone classes for the CRM job-status label, matching the owner-side CRM list rows. */
const STATUS_TONE: Record<string, string> = {
  neutral: "border-border/50 bg-accent/30 text-foreground",
  amber: "border-warning/40 bg-warning/10 text-warning",
  emerald: "border-success/40 bg-success/10 text-success",
  rose: "border-destructive/40 bg-destructive/10 text-destructive",
  sky: "border-info/40 bg-info/10 text-info",
}

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/**
 * Who is on the line. Renders while the phone is still ringing — the whole point is that
 * the operator knows the caller before speaking, not after.
 */
function CallerIdentityStrip({
  caller,
  callerNumber,
  callerName,
}: {
  caller: ReceptionistCallerLookup | null
  callerNumber: string | null
  /** Carrier-supplied name, used only when CRM has no record of its own. */
  callerName: string | null
}) {
  const known = Boolean(caller?.found)
  const name = caller?.display_name?.trim() || callerName?.trim() || null
  const place = [caller?.city, caller?.region].filter(Boolean).join(", ")

  const facts: { icon: React.ReactNode; text: string }[] = []
  if (known && caller) {
    if (caller.jobs_completed > 0) {
      facts.push({
        icon: <Repeat className="h-3 w-3" aria-hidden />,
        text:
          caller.jobs_completed === 1
            ? "1 job completed"
            : `${caller.jobs_completed} jobs completed`,
      })
    }
    if (caller.lifetime_revenue_cents > 0) {
      facts.push({
        icon: <span aria-hidden>$</span>,
        text: `${formatUsdFromCents(caller.lifetime_revenue_cents)} lifetime`,
      })
    }
    if (caller.has_open_book_form) {
      facts.push({
        icon: <FileText className="h-3 w-3" aria-hidden />,
        text: "Book form waiting on a call",
      })
    } else if (caller.open_lead_count > 0) {
      facts.push({
        icon: <FileText className="h-3 w-3" aria-hidden />,
        text:
          caller.open_lead_count === 1
            ? "1 open lead"
            : `${caller.open_lead_count} open leads`,
      })
    }
  }

  return (
    <div
      className={cn(
        "mt-3 rounded-xl border px-4 py-3",
        known ? "border-info/30 bg-info/[0.07]" : "border-border bg-muted/40"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" aria-hidden />
          {known ? "Returning customer" : "Caller"}
        </span>
        <span className="text-base font-semibold text-foreground">
          {name || (caller === null ? "Looking up…" : "New caller")}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatPhoneDisplay(callerNumber)}
        </span>
        {place ? <span className="text-xs text-muted-foreground">{place}</span> : null}
        {caller?.job_status_label ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-2xs font-medium",
              STATUS_TONE[caller.job_status_tone ?? "neutral"] ?? STATUS_TONE.neutral
            )}
          >
            {caller.job_status_label}
          </span>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground">
          {facts.map((fact) => (
            <span key={fact.text} className="inline-flex items-center gap-2">
              {fact.icon}
              {fact.text}
            </span>
          ))}
        </div>
      ) : null}

      {caller !== null && !known ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          No record on file — take the details and they will be saved as a new customer.
        </p>
      ) : null}
    </div>
  )
}

function CheatSheetTile({
  icon,
  label,
  value,
  emptyHint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  emptyHint: string
  accent: string
}) {
  const has = Boolean(value && value.trim())
  return (
    <div className="flex flex-col rounded-xl border border-border bg-background/60 p-4">
      <p className={cn("flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide", accent)}>
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
          has ? "text-foreground" : "italic text-muted-foreground"
        )}
      >
        {has ? value : emptyHint}
      </p>
    </div>
  )
}

export function CompanyBriefingCard({
  status,
  operatorName,
  callerNumber,
  callerName,
  lookupNumber,
  fallbackBusinessName,
  onAnswer,
  onHangup,
}: {
  status: "ringing" | "active"
  operatorName: string | null
  callerNumber: string | null
  callerName: string | null
  /** Inbound business line to resolve the briefing; the API falls back to the operator's business. */
  lookupNumber: string | null
  fallbackBusinessName: string | null
  onAnswer: () => void
  onHangup: () => void
}) {
  const [briefing, setBriefing] = useState<CompanyBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [caller, setCaller] = useState<ReceptionistCallerLookup | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = lookupNumber ? `?number=${encodeURIComponent(lookupNumber)}` : ""
    fetch(`/api/receptionist/company-briefing${qs}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("briefing"))))
      .then((j: { data?: CompanyBriefing }) => {
        if (!cancelled) setBriefing(j.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setBriefing(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lookupNumber])

  // Who is calling — fetched separately from the company briefing so a slow CRM lookup
  // never delays "ANSWER AS", and a failed one never blocks the Answer button.
  useEffect(() => {
    let cancelled = false
    setCaller(null)
    if (!callerNumber?.trim()) return
    fetch(`/api/receptionist/caller?number=${encodeURIComponent(callerNumber)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("caller"))))
      .then((j: { data?: ReceptionistCallerLookup }) => {
        if (!cancelled) setCaller(j.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setCaller(null)
      })
    return () => {
      cancelled = true
    }
  }, [callerNumber])

  const ringing = status === "ringing"
  const businessName = briefing?.business_name?.trim() || fallbackBusinessName?.trim() || "this business"
  const operator = operatorName?.trim() || "your Lyncr operator"
  const script = `Thank you for calling ${businessName}, this is ${operator}, how can I help you?`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-overlay shadow-black/50">
        {/* Header — answer-as greeting */}
        <div
          className={cn(
            "rounded-t-2xl border-b border-border p-6",
            ringing ? "bg-success/30" : "bg-primary/10"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  ringing ? "animate-pulse bg-success" : "bg-primary"
                )}
                aria-hidden
              />
              Lyncr Company Briefing · {ringing ? "Incoming call" : "On call"}
            </p>
            <span className="text-xs text-muted-foreground">
              {formatPhoneDisplay(callerNumber)}
              {callerName ? ` · ${callerName}` : ""}
            </span>
          </div>

          <p className="mt-3 text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl">
            ANSWER AS:{" "}
            <span className="text-success">
              {loading && !briefing ? "…" : businessName}
            </span>
          </p>

          <div className="mt-3 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-success">Opening script</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">&ldquo;{script}&rdquo;</p>
          </div>

          <CallerIdentityStrip caller={caller} callerNumber={callerNumber} callerName={callerName} />
        </div>

        {/* Phone controls */}
        <div className="flex items-center justify-center gap-3 p-6">
          {ringing ? (
            <button
              type="button"
              onClick={onAnswer}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-success px-6 py-3 text-sm font-semibold text-success-foreground transition-colors hover:bg-success sm:flex-none sm:px-8"
            >
              <PhoneCall className="h-4 w-4" aria-hidden />
              Answer
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHangup}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive/90 px-6 py-3 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive sm:flex-none sm:px-8"
          >
            <PhoneOff className="h-4 w-4" aria-hidden />
            {ringing ? "Decline" : "Hang up"}
          </button>
        </div>

        {/* Company cheat-sheet grid */}
        <div className="grid gap-3 px-6 pb-6 sm:grid-cols-3">
          <CheatSheetTile
            icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
            label="Hours"
            value={briefing?.business_hours ?? null}
            emptyHint={loading ? "Loading…" : "No hours set by owner yet."}
            accent="text-info"
          />
          <CheatSheetTile
            icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
            label="Service Rules"
            value={briefing?.service_rules ?? null}
            emptyHint={loading ? "Loading…" : "No rates or policies set yet."}
            accent="text-operator"
          />
          <CheatSheetTile
            icon={<Megaphone className="h-3.5 w-3.5" aria-hidden />}
            label="Live Owner Dispatch Notes"
            value={briefing?.business_instructions ?? null}
            emptyHint={loading ? "Loading…" : "No live dispatch notes from the owner right now."}
            accent="text-warning"
          />
        </div>

        {loading && !briefing ? (
          <p className="flex items-center justify-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Pulling company briefing…
          </p>
        ) : null}
      </div>
    </div>
  )
}
