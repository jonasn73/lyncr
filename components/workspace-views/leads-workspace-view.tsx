"use client"

import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { LifeBuoy, Loader2, PhoneOutgoing } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DrawerStepHeader,
  DrawerScrollBody,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  LeadIntentPill,
  type LeadIntentVariant,
} from "@/components/dashboard-workspace-ui"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"

import {
  useLeadsWorkspaceInitial,
  useLeadsWorkspaceCacheSnapshot,
} from "@/components/leads-workspace-initial-context"
import {
  readLeadsWorkspaceCache,
  refreshLeadsWorkspaceCache,
  writeLeadsWorkspaceCache,
  type CachedLeadRow,
  type CachedSalvageLead,
  type LeadsWorkspaceCache,
} from "@/lib/leads-cache"

type LeadRow = CachedLeadRow
type SalvageLead = CachedSalvageLead

type DisplayLead = {
  id: string
  name: string
  contact: string
  dateLabel: string
  intentLabel: string
  intentVariant: LeadIntentVariant
  isUrgent: boolean
  actionLabel: string
  raw?: LeadRow
}

/** First non-empty string value across the given keys in a collected blob. */
function readCollected(collected: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!collected || typeof collected !== "object") return ""
  for (const key of keys) {
    const v = (collected as Record<string, unknown>)[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

function formatCaller(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return num
}

function leadName(lead: LeadRow): string {
  const n = readCollected(lead.collected, ["name", "caller_name", "customer_name"])
  return n || "Unknown lead"
}

/** Best available callback number for the lead. */
function leadContact(lead: LeadRow): string {
  const fromCollected = readCollected(lead.collected, ["callback_number", "caller_number", "phone", "callback"])
  if (fromCollected) return formatCaller(fromCollected)
  return formatCaller(lead.caller_e164)
}

const URGENT_INTENTS = new Set(["emergency", "pest_active", "lockout", "urgent"])

/** True/False urgent priority flag derived from the captured intent + status keywords. */
function isUrgentLead(lead: LeadRow): boolean {
  if (lead.intent_slug && URGENT_INTENTS.has(lead.intent_slug)) return true
  const status = readCollected(lead.collected, ["status", "urgency", "priority", "key_status"]).toLowerCase()
  if (/urgent|emergency|asap|now|immediately|high|lockout|locked out/.test(status)) return true
  const flag = lead.collected?.urgent ?? lead.collected?.is_urgent ?? lead.collected?.emergency
  return flag === true || flag === "true" || flag === "yes"
}

/** Human "Action Required" label, e.g. "Needs Locksmith Dispatch", "Pricing Inbound Call". */
function actionRequiredLabel(lead: LeadRow): string {
  const slug = lead.intent_slug
  const service = readCollected(lead.collected, ["service_type", "issue_type", "request_type", "intent_label"])
  switch (slug) {
    case "emergency":
    case "pest_active":
    case "lockout":
      return service ? `Emergency ${service} Dispatch` : "Emergency Dispatch"
    case "quote":
      return "Pricing Inbound Call"
    case "scheduling":
    case "appointment":
      return "Schedule Appointment"
    case "billing":
      return "Billing Follow-up"
    default:
      break
  }
  if (service) return `Needs ${service}`
  if (slug) return `${slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Follow-up`
  return "Follow-up Required"
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
    contact: leadContact(lead),
    dateLabel: formatCapturedDate(lead.created_at),
    intentLabel: intentLabel(lead.intent_slug),
    intentVariant: intentVariantForSlug(lead.intent_slug),
    isUrgent: isUrgentLead(lead),
    actionLabel: actionRequiredLabel(lead),
    raw: lead,
  }
}

function LeadDetailSheet({
  selected,
  usingDemo,
  onClose,
}: {
  selected: DisplayLead
  usingDemo: boolean
  onClose: () => void
}) {
  return (
    <>
      <DrawerStepHeader step="Lead" title={selected.name} subtitle={selected.contact} />
      <DrawerScrollBody>
        <div className="flex flex-wrap items-center gap-2">
          <LeadIntentPill label={selected.intentLabel} variant={selected.intentVariant} />
          <UrgentFlag urgent={selected.isUrgent} />
        </div>
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Action required</p>
          <p className="mt-1 text-sm font-medium text-foreground">{selected.actionLabel}</p>
        </div>
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
        onCancel={onClose}
        saveLabel="Follow up"
      />
    </>
  )
}

function UrgentFlag({ urgent }: { urgent: boolean }) {
  if (urgent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" aria-hidden />
        Urgent · True
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-800/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      Urgent · False
    </span>
  )
}

const LeadsGrid = memo(function LeadsGrid({
  rows,
  selectedLead,
  onSelectLead,
}: {
  rows: DisplayLead[]
  selectedLead: DisplayLead | null
  onSelectLead: (lead: DisplayLead) => void
}) {
  const openLead = useWorkspaceRightSheet<DisplayLead>()

  if (rows.length === 0) {
    return (
      <WorkspacePanel className="flex min-h-[280px] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-sm font-medium text-zinc-200">No operator leads yet</p>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          When your Lyncr operators capture a caller&apos;s details, each profile appears here with their
          contact info, urgency, and the action they need from you.
        </p>
      </WorkspacePanel>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const isSelected = selectedLead?.id === row.id
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => {
              onSelectLead(row)
              openLead(row)
            }}
            className={cn(
              "flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 text-left transition-colors",
              "hover:border-zinc-600 hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              row.isUrgent && "border-rose-500/30",
              isSelected && "border-primary/40 ring-1 ring-inset ring-primary/30"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{row.name}</p>
                <p className="mt-0.5 truncate text-sm tabular-nums text-zinc-400">{row.contact}</p>
              </div>
              <UrgentFlag urgent={row.isUrgent} />
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Action required</p>
              <p className="mt-0.5 truncate text-sm font-medium text-foreground" title={row.actionLabel}>
                {row.actionLabel}
              </p>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <LeadIntentPill label={row.intentLabel} variant={row.intentVariant} />
              <span className="shrink-0 text-[11px] text-zinc-600">{row.dateLabel}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
})

/** Build a tel: href, defaulting to US (+1) when the stored number is bare 10 digits. */
function telHref(e164: string | null): string | null {
  if (!e164) return null
  const trimmed = e164.trim()
  if (trimmed.startsWith("+")) return `tel:${trimmed.replace(/[^\d+]/g, "")}`
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`
  if (digits.length === 10) return `tel:+1${digits}`
  return digits ? `tel:${digits}` : null
}

function salvageOperator(collected: Record<string, unknown>): string | null {
  const v = collected?.captured_by_name
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function salvageBadge(lead: SalvageLead): { label: string; className: string } {
  if (lead.manual_retry_required || lead.status === "failed_10dlc") {
    return {
      label: "SMS blocked — call manually",
      className: "border-red-500/40 bg-red-500/10 text-red-200",
    }
  }
  if (lead.source === "lost_lead") {
    return {
      label: "Lost lead",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    }
  }
  return {
    label: "Price rejected",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  }
}

function LeadSalvageSection({ leads }: { leads: SalvageLead[] }) {
  if (leads.length === 0) return null
  const manualCount = leads.filter((l) => l.manual_retry_required).length
  return (
    <section className="mb-7">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
          <LifeBuoy className="h-4 w-4 text-amber-300" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground sm:text-base">Lead Salvage Pool</h2>
          <p className="text-xs text-zinc-500">
            Price rejections and intake hang-ups — unified queue to rescue the deal.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300">
          {leads.length} to rescue
        </span>
        {manualCount > 0 ? (
          <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-200">
            {manualCount} need manual SMS retry
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {leads.map((lead) => {
          const href = telHref(lead.caller_e164)
          const operator = salvageOperator(lead.collected)
          const badge = salvageBadge(lead)
          return (
            <div
              key={`${lead.source ?? "ai"}-${lead.id}`}
              className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/15 p-5"
            >
              <span
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  badge.className
                )}
              >
                {badge.label}
              </span>
              {lead.has_receptionist_log ? (
                <span className="inline-flex w-fit items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-200">
                  Receptionist + intake
                </span>
              ) : null}

              {href ? (
                <a
                  href={href}
                  className="group inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-amber-200 transition-colors hover:text-amber-100"
                >
                  <PhoneOutgoing className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
                  {formatCaller(lead.caller_e164)}
                </a>
              ) : (
                <p className="text-2xl font-bold tracking-tight text-zinc-500">No number captured</p>
              )}
              {href ? (
                <p className="-mt-1 text-[11px] font-medium uppercase tracking-wide text-amber-400/70">
                  Tap to call back
                </p>
              ) : null}

              {lead.manual_retry_required && lead.recovery_blocked_reason ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-100">
                  Automated recovery SMS blocked (10DLC). {lead.recovery_blocked_reason}
                </p>
              ) : null}

              {lead.last_quoted_price_cents != null && lead.last_quoted_price_cents > 0 ? (
                <p className="text-xs font-semibold tabular-nums text-emerald-300">
                  Last quote: ${Math.round(lead.last_quoted_price_cents / 100)}
                </p>
              ) : null}

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                {lead.summary?.trim() || lead.failure_reason?.trim() || "No operator notes captured."}
              </p>

              <p className="mt-auto text-[11px] text-zinc-600">
                {operator ? `Logged by ${operator} · ` : ""}
                {lead.has_receptionist_log
                  ? "Receptionist log + intake sheet · "
                  : lead.source === "lost_lead"
                    ? "Intake sheet · "
                    : ""}
                {formatCapturedDate(lead.created_at)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const LeadsWorkspaceBody = memo(function LeadsWorkspaceBody({
  loading,
  error,
  leads,
  salvageLeads,
  usingDemo,
  selectedLead,
  onSelectLead,
}: {
  loading: boolean
  error: string | null
  leads: DisplayLead[]
  salvageLeads: SalvageLead[]
  usingDemo: boolean
  selectedLead: DisplayLead | null
  onSelectLead: (lead: DisplayLead) => void
}) {
  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="CRM" title="Leads" />

      <LeadSalvageSection leads={salvageLeads} />

      {loading && leads.length === 0 && salvageLeads.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <LeadsGrid rows={leads} selectedLead={selectedLead} onSelectLead={onSelectLead} />
      )}
    </WorkspacePage>
  )
})

export const LeadsWorkspaceView = memo(function LeadsWorkspaceView() {
  const initial = useLeadsWorkspaceInitial()
  const cached = useLeadsWorkspaceCacheSnapshot()
  const [fresh, setFresh] = useState<LeadsWorkspaceCache | null>(null)
  const [fetchDone, setFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<DisplayLead | null>(null)

  const payload = fresh ?? initial ?? cached ?? null

  useLayoutEffect(() => {
    if (initial) writeLeadsWorkspaceCache(initial)
  }, [initial])

  useEffect(() => {
    let cancelled = false
    void refreshLeadsWorkspaceCache()
      .then((data) => {
        if (cancelled) return
        setFresh(data)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        if (readLeadsWorkspaceCache() || initial || cached) return
        setError(e instanceof Error ? e.message : "Error")
      })
      .finally(() => {
        if (!cancelled) setFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const leads = useMemo(() => (payload?.leads ?? []).map(apiLeadToDisplay), [payload?.leads])
  const salvageLeads = payload?.salvageLeads ?? []
  const showSpinner = !payload && !fetchDone

  const usingDemo = false

  return (
    <WorkspaceRightSheetGate<DisplayLead>
      render={(selected, close) => (
        <LeadDetailSheet
          selected={selected}
          usingDemo={usingDemo}
          onClose={() => {
            close()
            setSelectedLead(null)
          }}
        />
      )}
    >
      <LeadsWorkspaceBody
        loading={showSpinner}
        error={error}
        leads={leads}
        salvageLeads={salvageLeads}
        usingDemo={usingDemo}
        selectedLead={selectedLead}
        onSelectLead={setSelectedLead}
      />
    </WorkspaceRightSheetGate>
  )
})
