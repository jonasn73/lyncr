"use client"

// Receptionist web-phone "Company Briefing Card" — a dark-themed screen-pop overlay that opens the
// instant a WEB call rings. It looks up the target business (by the inbound line, falling back to the
// operator's linked business) so the agent can answer as that specific company, then shows a cheat
// sheet of hours, service rules, and the owner's live dispatch notes.

import { useEffect, useState } from "react"
import { Clock, ClipboardList, Loader2, Megaphone, PhoneCall, PhoneOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CompanyBriefing } from "@/lib/types"

function formatPhoneDisplay(phone: string | null): string {
  if (!phone) return "Unknown caller"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
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
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className={cn("flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide", accent)}>
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
          has ? "text-zinc-200" : "italic text-zinc-600"
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

  const ringing = status === "ringing"
  const businessName = briefing?.business_name?.trim() || fallbackBusinessName?.trim() || "this business"
  const operator = operatorName?.trim() || "your Lyncr operator"
  const script = `Thank you for calling ${businessName}, this is ${operator}, how can I help you?`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50">
        {/* Header — answer-as greeting */}
        <div
          className={cn(
            "rounded-t-2xl border-b border-zinc-800 p-6",
            ringing ? "bg-emerald-950/30" : "bg-primary/10"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  ringing ? "animate-pulse bg-emerald-400" : "bg-primary"
                )}
                aria-hidden
              />
              Lyncr Company Briefing · {ringing ? "Incoming call" : "On call"}
            </p>
            <span className="text-xs text-zinc-500">
              {formatPhoneDisplay(callerNumber)}
              {callerName ? ` · ${callerName}` : ""}
            </span>
          </div>

          <p className="mt-3 text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl">
            ANSWER AS:{" "}
            <span className="text-emerald-300">
              {loading && !briefing ? "…" : businessName}
            </span>
          </p>

          <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Opening script</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-100">&ldquo;{script}&rdquo;</p>
          </div>
        </div>

        {/* Phone controls */}
        <div className="flex items-center justify-center gap-3 p-5">
          {ringing ? (
            <button
              type="button"
              onClick={onAnswer}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 sm:flex-none sm:px-8"
            >
              <PhoneCall className="h-4 w-4" aria-hidden />
              Answer
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHangup}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/90 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 sm:flex-none sm:px-8"
          >
            <PhoneOff className="h-4 w-4" aria-hidden />
            {ringing ? "Decline" : "Hang up"}
          </button>
        </div>

        {/* Company cheat-sheet grid */}
        <div className="grid gap-3 px-5 pb-6 sm:grid-cols-3">
          <CheatSheetTile
            icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
            label="Hours"
            value={briefing?.business_hours ?? null}
            emptyHint={loading ? "Loading…" : "No hours set by owner yet."}
            accent="text-sky-300"
          />
          <CheatSheetTile
            icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />}
            label="Service Rules"
            value={briefing?.service_rules ?? null}
            emptyHint={loading ? "Loading…" : "No rates or policies set yet."}
            accent="text-violet-300"
          />
          <CheatSheetTile
            icon={<Megaphone className="h-3.5 w-3.5" aria-hidden />}
            label="Live Owner Dispatch Notes"
            value={briefing?.business_instructions ?? null}
            emptyHint={loading ? "Loading…" : "No live dispatch notes from the owner right now."}
            accent="text-amber-300"
          />
        </div>

        {loading && !briefing ? (
          <p className="flex items-center justify-center gap-2 border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Pulling company briefing…
          </p>
        ) : null}
      </div>
    </div>
  )
}
