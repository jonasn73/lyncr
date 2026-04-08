"use client"

// ============================================
// LeadsPage — AI fallback leads from phone calls
// ============================================
// Fetches AI lead rows from the database (in-app capture).

import { useEffect, useState } from "react"
import { Inbox, Loader2, Phone, MessageSquare } from "lucide-react"
import { IconSurface } from "@/components/ui/icon-surface"
import { Badge } from "@/components/ui/badge"

/** One lead row from GET /api/ai-leads */
interface LeadRow {
  id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  sms_sent: boolean
  sms_error: string | null
  created_at: string
}

/** Pretty-print intent for badges */
function intentLabel(slug: string | null): string {
  if (!slug) return "Unknown"
  if (slug === "other") return "Other"
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

/** Format E.164 for display (US-focused) */
function formatCaller(num: string | null): string {
  if (!num) return "Unknown caller"
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num
}

export function LeadsPage() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/ai-leads", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || "Could not load leads")
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setLeads(Array.isArray(data.leads) ? data.leads : [])
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <IconSurface tone="primary">
          <Inbox className="h-5 w-5" />
        </IconSurface>
        <div>
          <h1 className="text-lg font-semibold text-foreground">AI leads</h1>
          <p className="text-xs text-muted-foreground">
            Captured when the AI receptionist takes a call (no answer / busy fallback).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : leads.length === 0 ? (
        <p className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-muted-foreground">
          No leads yet. When a caller speaks with your AI assistant and it saves their details, they will show up
          here and (if SMS is on) text your main line.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {leads.map((lead) => (
            <li
              key={lead.id}
              className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {intentLabel(lead.intent_slug)}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {formatCaller(lead.caller_e164)}
                </span>
                {lead.sms_sent ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-success">
                    <MessageSquare className="h-3 w-3" />
                    Text sent
                  </span>
                ) : lead.sms_error ? (
                  <span className="text-[11px] text-warning">SMS: {lead.sms_error}</span>
                ) : null}
              </div>
              {lead.summary ? (
                <p className="mt-2 text-sm font-medium text-foreground">{lead.summary}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {new Date(lead.created_at).toLocaleString()}
              </p>
              <details className="mt-2 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">Details</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-2 text-[10px]">
                  {JSON.stringify(lead.collected, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
