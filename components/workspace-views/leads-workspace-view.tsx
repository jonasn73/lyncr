"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import {
  DrawerStepHeader,
  DrawerScrollBody,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  LeadIntentPill,
  WORKSPACE_SHEET_CLASS,
  type LeadIntentVariant,
} from "@/components/dashboard-workspace-ui"

interface LeadRow {
  id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  created_at: string
}

type DisplayLead = {
  id: string
  name: string
  contact: string
  dateLabel: string
  intentLabel: string
  intentVariant: LeadIntentVariant
  raw?: LeadRow
}

const DEMO_LEADS: DisplayLead[] = [
  {
    id: "demo-marcus",
    name: "Marcus Vance",
    contact: "(502) 883-9120",
    dateLabel: "Today, 1:15 PM",
    intentLabel: "Lockout Emergency",
    intentVariant: "amber",
  },
  {
    id: "demo-derrick",
    name: "Derrick Hall",
    contact: "(502) 441-0923",
    dateLabel: "Yesterday, 4:40 PM",
    intentLabel: "Price Quote Request",
    intentVariant: "blue",
  },
  {
    id: "demo-elena",
    name: "Elena Rostova",
    contact: "(305) 991-8841",
    dateLabel: "May 15, 11:02 AM",
    intentLabel: "General Inquiry",
    intentVariant: "muted",
  },
]

function formatCaller(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num
}

function leadName(lead: LeadRow): string {
  const c = lead.collected
  if (c && typeof c === "object") {
    const n = (c as Record<string, unknown>).name ?? (c as Record<string, unknown>).caller_name
    if (typeof n === "string" && n.trim()) return n.trim()
  }
  return "Unknown lead"
}

const INTENT_TAGS: Record<string, string> = {
  emergency: "Emergency Support",
  pest_active: "Emergency Support",
  scheduling: "Scheduling Request",
  appointment: "Scheduling Request",
  quote: "Price Quote",
  billing: "Billing Inquiry",
}

function intentLabel(slug: string | null): string {
  if (!slug) return "General Inquiry"
  if (INTENT_TAGS[slug]) return INTENT_TAGS[slug]
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function intentVariantForSlug(slug: string | null): LeadIntentVariant {
  if (!slug) return "muted"
  if (slug === "emergency" || slug === "pest_active") return "amber"
  if (slug === "quote" || slug === "scheduling" || slug === "appointment") return "blue"
  return "muted"
}

function formatCapturedDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.floor((startToday - startThatDay) / 86_400_000)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (diffDays === 0) return `Today, ${time}`
  if (diffDays === 1) return `Yesterday, ${time}`
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`
}

function apiLeadToDisplay(lead: LeadRow): DisplayLead {
  return {
    id: lead.id,
    name: leadName(lead),
    contact: formatCaller(lead.caller_e164),
    dateLabel: formatCapturedDate(lead.created_at),
    intentLabel: intentLabel(lead.intent_slug),
    intentVariant: intentVariantForSlug(lead.intent_slug),
    raw: lead,
  }
}

export function LeadsWorkspaceView() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DisplayLead | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/ai-leads", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load leads")
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setLeads(Array.isArray(data.leads) ? data.leads : [])
          setError(null)
        }
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

  const displayRows = useMemo(() => {
    if (leads.length > 0) return leads.map(apiLeadToDisplay)
    return DEMO_LEADS
  }, [leads])

  const usingDemo = leads.length === 0

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="CRM" title="Leads" />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error && !usingDemo ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <WorkspacePanel className="min-h-[280px]">
          <WorkspaceTableWrap>
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[24%]" />
              <col className="w-[26%]" />
              <col className="w-[26%]" />
            </colgroup>
            <thead>
              <tr>
                <WorkspaceTh>Lead name</WorkspaceTh>
                <WorkspaceTh>Contact info</WorkspaceTh>
                <WorkspaceTh>Date captured</WorkspaceTh>
                <WorkspaceTh>AI intent target</WorkspaceTh>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer transition-colors hover:bg-zinc-900/50"
                  onClick={() => setSelected(row)}
                >
                  <WorkspaceTd className="font-medium">{row.name}</WorkspaceTd>
                  <WorkspaceTd className="text-zinc-400">{row.contact}</WorkspaceTd>
                  <WorkspaceTd className="text-zinc-400">{row.dateLabel}</WorkspaceTd>
                  <WorkspaceTd>
                    <LeadIntentPill label={row.intentLabel} variant={row.intentVariant} />
                  </WorkspaceTd>
                </tr>
              ))}
            </tbody>
          </WorkspaceTableWrap>
        </WorkspacePanel>
      )}

      <Sheet open={selected != null} onOpenChange={(o) => !o && setSelected(null)} modal>
        <SheetContent side="right" className={WORKSPACE_SHEET_CLASS}>
          {selected ? (
            <>
              <DrawerStepHeader
                step="Lead"
                title={selected.name}
                subtitle={selected.contact}
              />
              <DrawerScrollBody>
                <LeadIntentPill label={selected.intentLabel} variant={selected.intentVariant} />
                {selected.raw?.summary ? (
                  <p className="mt-4 text-sm text-zinc-300">{selected.raw.summary}</p>
                ) : usingDemo ? (
                  <p className="mt-4 text-sm text-zinc-500">
                    Sample lead for preview. Live AI captures will appear here when calls route to your assistant.
                  </p>
                ) : null}
                {selected.raw ? (
                  <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs text-zinc-400">
                    {JSON.stringify(selected.raw.collected, null, 2)}
                  </pre>
                ) : null}
              </DrawerScrollBody>
              <DrawerStickyFooter
                dirty={false}
                saving={false}
                onSave={() => {
                  const raw = selected.raw?.caller_e164?.trim()
                  if (raw) {
                    window.location.href = `tel:${raw}`
                    return
                  }
                  const digits = selected.contact.replace(/\D/g, "")
                  if (digits.length >= 10) window.location.href = `tel:+1${digits.slice(-10)}`
                }}
                onCancel={() => setSelected(null)}
                saveLabel="Follow up"
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </WorkspacePage>
  )
}
