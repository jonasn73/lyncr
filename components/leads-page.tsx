"use client"

// ============================================
// LeadsPage — AI fallback leads from phone calls
// ============================================
// Fetches AI lead rows from the database (in-app capture).

import { useEffect, useState } from "react"
import { Inbox, Loader2, Phone, MessageSquare } from "lucide-react"
import { IconSurface } from "@/components/ui/icon-surface"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"

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
  const [leadSheet, setLeadSheet] = useState<LeadRow | null>(null)

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
            <li key={lead.id}>
              <button
                type="button"
                onClick={() => setLeadSheet(lead)}
                className="w-full rounded-2xl border border-border/70 bg-card/85 p-4 text-left shadow-sm transition-colors hover:border-primary/35 hover:bg-card"
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
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{lead.summary}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(lead.created_at).toLocaleString()} · tap for full capture
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={leadSheet != null} onOpenChange={(o) => !o && setLeadSheet(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {leadSheet ? (
            <>
              <StorySheetHeader
                eyebrow="AI intake story"
                storyline="What the assistant heard and saved — the same thread your routing promised callers."
                title={intentLabel(leadSheet.intent_slug)}
                description={
                  <>
                    Caller {formatCaller(leadSheet.caller_e164)} · {new Date(leadSheet.created_at).toLocaleString()}
                    {leadSheet.sms_sent ? (
                      <span className="mt-1 block text-success">SMS confirmation sent to your line.</span>
                    ) : null}
                    {leadSheet.sms_error ? (
                      <span className="mt-1 block text-warning">SMS: {leadSheet.sms_error}</span>
                    ) : null}
                  </>
                }
              />
              {leadSheet.summary ? (
                <p className="border-b border-border/60 px-4 py-3 text-sm font-medium text-foreground">{leadSheet.summary}</p>
              ) : null}
              <div className="max-h-[min(55vh,420px)] overflow-y-auto px-4 py-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Captured fields</p>
                <pre className="whitespace-pre-wrap rounded-xl bg-secondary/40 p-3 text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(leadSheet.collected, null, 2)}
                </pre>
              </div>
              <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                <p className="text-[11px] text-muted-foreground">
                  Tune how the assistant asks on{" "}
                  <a href="/dashboard" className="font-semibold text-primary underline-offset-2 hover:underline">
                    Call console
                  </a>{" "}
                  → Voice &amp; greetings.
                </p>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
