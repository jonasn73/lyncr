"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LifeBuoy, Loader2, PhoneOutgoing } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
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
  type LeadsWorkspaceDebug,
} from "@/lib/leads-cache"
import { writeLeadsIntakeHandoff } from "@/lib/leads-intake-handoff"
import { CRM_LEAD_STATUS, LOST_LEAD_STATUS, UNASSIGNED_CALLBACK_STATUS } from "@/lib/job-pool"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"

type LeadRow = CachedLeadRow
type SalvageLead = CachedSalvageLead

type LeadRecoveryTab = "all" | "pending_callbacks" | "price_recovery" | "waiting_on_parts"
type LeadRecoveryStage = Exclude<LeadRecoveryTab, "all">

const LEAD_RECOVERY_TABS: { id: LeadRecoveryTab; label: string }[] = [
  { id: "all", label: "All Leads" },
  { id: "pending_callbacks", label: "Pending Callbacks" },
  { id: "price_recovery", label: "Price Recovery" },
  { id: "waiting_on_parts", label: "Waiting on Parts" },
]

const LEAD_RECOVERY_STAGE_OPTIONS: { id: LeadRecoveryStage; label: string }[] = [
  { id: "pending_callbacks", label: "Pending Callbacks" },
  { id: "price_recovery", label: "Price Recovery" },
  { id: "waiting_on_parts", label: "Waiting on Parts" },
]

type DisplayLead = {
  id: string
  name: string
  contact: string
  phoneE164: string | null
  dateLabel: string
  intentLabel: string
  intentVariant: LeadIntentVariant
  isUrgent: boolean
  isOverdue: boolean
  actionLabel: string
  recoveryStage: LeadRecoveryStage
  quotedPriceCents: number | null
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
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

/** Raw E.164 (or dialable digits) for tel: links and scheduler handoff. */
function leadPhoneE164(lead: LeadRow): string | null {
  const fromCollected = readCollected(lead.collected, ["callback_number", "caller_number", "phone", "callback"])
  const raw = fromCollected || lead.caller_e164?.trim() || ""
  if (!raw) return null
  const href = telHref(raw)
  return href ? href.replace(/^tel:/, "") : null
}

function leadVehicleFields(lead: LeadRow): { year: string; make: string; model: string } {
  return {
    year: readCollected(lead.collected, ["vehicle_year", "year"]),
    make: readCollected(lead.collected, ["vehicle_make", "make"]),
    model: readCollected(lead.collected, ["vehicle_model", "model"]),
  }
}

function leadQuotedPriceCents(lead: LeadRow): number | null {
  const raw = lead.collected?.quoted_price_cents ?? lead.collected?.last_quoted_price_cents
  if (typeof raw === "number" && raw > 0) return Math.round(raw)
  if (typeof raw === "string" && Number(raw) > 0) return Math.round(Number(raw))
  return null
}

function normalizeRecoveryStage(value: string): LeadRecoveryStage | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, "_")
  if (v === "pending_callbacks" || v === "pending_callback" || v === "callback") return "pending_callbacks"
  if (v === "price_recovery" || v === "price" || v === "quote") return "price_recovery"
  if (v === "waiting_on_parts" || v === "parts" || v === "waiting_parts") return "waiting_on_parts"
  return null
}

/** Parse follow-up deadline from collected blob; returns epoch ms or null. */
function followUpDeadlineMs(lead: LeadRow): number | null {
  const raw = readCollected(lead.collected, [
    "follow_up_deadline",
    "follow_up_at",
    "callback_due_at",
    "follow_up_due_at",
  ])
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

/** True when a follow-up deadline exists and is in the past. */
function isFollowUpOverdue(lead: LeadRow): boolean {
  const ms = followUpDeadlineMs(lead)
  return ms != null && ms < Date.now()
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

/** Human "Action Required" label — custom callback note wins over intent defaults. */
function actionRequiredLabel(lead: LeadRow): string {
  const custom = readCollected(lead.collected, ["action_required_label", "action_required"])
  if (custom) return custom
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

/** Infer sales-recovery bucket when no explicit stage is saved on the lead. */
function inferLeadRecoveryStage(lead: LeadRow): LeadRecoveryStage {
  const dispatch = readCollected(lead.collected, ["dispatch_status", "status"]).toLowerCase()
  if (dispatch === LOST_LEAD_STATUS || dispatch === "price_too_high") return "price_recovery"
  if (dispatch === CRM_LEAD_STATUS || dispatch === UNASSIGNED_CALLBACK_STATUS) return "pending_callbacks"
  const blob = JSON.stringify(lead.collected ?? {}).toLowerCase()
  const action = actionRequiredLabel(lead).toLowerCase()
  const status = readCollected(lead.collected, ["status", "stage", "disposition"]).toLowerCase()
  const haystack = `${blob} ${action} ${status}`

  if (/waiting on parts|parts on order|backorder|awaiting parts|part order/.test(haystack)) {
    return "waiting_on_parts"
  }
  if (
    lead.intent_slug === "quote" ||
    leadQuotedPriceCents(lead) != null ||
    /price|quote|too high|negotiat|discount|recovery|rejected/.test(haystack)
  ) {
    return "price_recovery"
  }
  return "pending_callbacks"
}

function leadRecoveryStage(lead: LeadRow): LeadRecoveryStage {
  const explicit = readCollected(lead.collected, ["sales_recovery_stage", "lead_stage", "crm_stage"])
  return normalizeRecoveryStage(explicit) ?? inferLeadRecoveryStage(lead)
}

function leadMatchesTab(lead: DisplayLead, tab: LeadRecoveryTab): boolean {
  if (tab === "all") return true
  return lead.recoveryStage === tab
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

function apiLeadToDisplay(lead: LeadRow): DisplayLead {
  const vehicle = leadVehicleFields(lead)
  return {
    id: lead.id,
    name: leadName(lead),
    contact: leadContact(lead),
    phoneE164: leadPhoneE164(lead),
    dateLabel: formatCapturedDate(lead.created_at),
    intentLabel: intentLabel(lead.intent_slug),
    intentVariant: intentVariantForSlug(lead.intent_slug),
    isUrgent: isUrgentLead(lead),
    isOverdue: isFollowUpOverdue(lead),
    actionLabel: actionRequiredLabel(lead),
    recoveryStage: leadRecoveryStage(lead),
    quotedPriceCents: leadQuotedPriceCents(lead),
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
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
          <LeadPriorityBadge urgent={selected.isUrgent} overdue={selected.isOverdue} />
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

function LeadPriorityBadge({ urgent, overdue }: { urgent: boolean; overdue: boolean }) {
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-200">
        ⚠️ Callback Overdue
      </span>
    )
  }
  if (urgent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" aria-hidden />
        Urgent
      </span>
    )
  }
  return null
}

function LeadsSegmentNav({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: LeadRecoveryTab
  onTabChange: (tab: LeadRecoveryTab) => void
  counts: Record<LeadRecoveryTab, number>
}) {
  return (
    <nav
      className="flex flex-wrap gap-2"
      aria-label="Lead recovery stages"
    >
      {LEAD_RECOVERY_TABS.map((tab) => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              active
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-zinc-700/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                active ? "bg-primary/20 text-primary" : "bg-zinc-800 text-zinc-500"
              )}
            >
              {counts[tab.id]}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function LeadNotesStageSheet({
  lead,
  open,
  onOpenChange,
  onSave,
}: {
  lead: DisplayLead | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (lead: DisplayLead, note: string, stage: LeadRecoveryStage) => Promise<void>
}) {
  const [draft, setDraft] = useState("")
  const [stage, setStage] = useState<LeadRecoveryStage>("pending_callbacks")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !lead) return
    setDraft(lead.actionLabel)
    setStage(lead.recoveryStage)
    setError(null)
  }, [open, lead])

  const handleSave = async () => {
    if (!lead) return
    const note = draft.trim()
    if (!note) {
      setError("Add follow-up notes before saving.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(lead, note, stage)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" variant="drawer" className="border-zinc-800 bg-zinc-950 p-0 sm:max-w-md">
        {lead ? (
          <>
            <DrawerStepHeader
              step="Recovery"
              title="Update Notes / Stage"
              subtitle={lead.name}
            />
            <DrawerScrollBody>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Recovery stage</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {LEAD_RECOVERY_STAGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setStage(option.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      stage === option.id
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Follow-up log</p>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What happened on the last call? What is the next step?"
                className="mt-2 min-h-[140px] border-zinc-700 bg-zinc-900 text-sm"
                disabled={saving}
              />
              {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
            </DrawerScrollBody>
            <DrawerStickyFooter
              dirty
              saving={saving}
              onSave={() => void handleSave()}
              onCancel={() => onOpenChange(false)}
              saveLabel="Save notes"
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

const LeadsGrid = memo(function LeadsGrid({
  rows,
  selectedLead,
  onSelectLead,
  onOpenNotesStage,
  onConvertToBooking,
  convertingId,
  emptyTabLabel,
}: {
  rows: DisplayLead[]
  selectedLead: DisplayLead | null
  onSelectLead: (lead: DisplayLead) => void
  onOpenNotesStage: (lead: DisplayLead) => void
  onConvertToBooking: (lead: DisplayLead) => Promise<void>
  convertingId: string | null
  emptyTabLabel?: string
}) {
  const openLead = useWorkspaceRightSheet<DisplayLead>()

  if (rows.length === 0) {
    return (
      <WorkspacePanel className="flex min-h-[280px] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-sm font-medium text-zinc-200">
          {emptyTabLabel ?? "No operator leads yet"}
        </p>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {emptyTabLabel
            ? "Try another recovery stage tab or update a lead's stage from Update Notes / Stage."
            : "When your Lyncr operators capture a caller's details, each profile appears here with their contact info, urgency, and the action they need from you."}
        </p>
      </WorkspacePanel>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const isSelected = selectedLead?.id === row.id
        const tel = row.phoneE164 ? `tel:${row.phoneE164}` : null
        const isConverting = convertingId === row.id
        return (
          <div
            key={row.id}
            className={cn(
              "flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors",
              row.isOverdue &&
                "border-l-4 border-amber-500 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.05)]",
              !row.isOverdue && row.isUrgent && "border-rose-500/30",
              isSelected && "border-primary/40 ring-1 ring-inset ring-primary/30"
            )}
          >
            <button
              type="button"
              onClick={() => {
                onSelectLead(row)
                openLead(row)
              }}
              className={cn(
                "flex flex-col gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl -m-1 p-1",
                "hover:bg-zinc-900/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{row.name}</p>
                  {tel ? (
                    <a
                      href={tel}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 block truncate text-sm font-medium tabular-nums text-sky-400 hover:underline"
                    >
                      {row.contact}
                    </a>
                  ) : (
                    <p className="mt-0.5 truncate text-sm tabular-nums text-zinc-400">{row.contact}</p>
                  )}
                </div>
                <LeadPriorityBadge urgent={row.isUrgent} overdue={row.isOverdue} />
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Action required</p>
                <p className="mt-0.5 truncate text-sm font-medium text-foreground" title={row.actionLabel}>
                  {row.actionLabel}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <LeadIntentPill label={row.intentLabel} variant={row.intentVariant} />
                <span className="shrink-0 text-[11px] text-zinc-600">{row.dateLabel}</span>
              </div>
            </button>

            <div className="mt-3 flex gap-2 border-t border-zinc-800/80 pt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isConverting}
                className="h-8 flex-1 bg-slate-700 text-xs text-slate-100 hover:bg-slate-600"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenNotesStage(row)
                }}
              >
                Update Notes / Stage
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isConverting}
                className="h-8 flex-1 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                onClick={(e) => {
                  e.stopPropagation()
                  void onConvertToBooking(row)
                }}
              >
                {isConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Book & Convert"}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
})

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
  leadsData,
  debugInfo,
  activeOrganizationId,
  salvageLeads,
  usingDemo,
  selectedLead,
  activeTab,
  tabCounts,
  onTabChange,
  onSelectLead,
  onOpenNotesStage,
  onConvertToBooking,
  convertingId,
}: {
  loading: boolean
  error: string | null
  leads: DisplayLead[]
  leadsData: LeadRow[]
  debugInfo?: LeadsWorkspaceDebug
  activeOrganizationId: string | null
  salvageLeads: SalvageLead[]
  usingDemo: boolean
  selectedLead: DisplayLead | null
  activeTab: LeadRecoveryTab
  tabCounts: Record<LeadRecoveryTab, number>
  onTabChange: (tab: LeadRecoveryTab) => void
  onSelectLead: (lead: DisplayLead) => void
  onOpenNotesStage: (lead: DisplayLead) => void
  onConvertToBooking: (lead: DisplayLead) => Promise<void>
  convertingId: string | null
}) {
  const activeTabLabel = LEAD_RECOVERY_TABS.find((tab) => tab.id === activeTab)?.label
  const firstRaw = leadsData[0]
  const firstDispatchStatus =
    (firstRaw?.collected?.dispatch_status as string | undefined) ||
    debugInfo?.sampleRows?.[0]?.dispatch_status ||
    debugInfo?.sampleRows?.[0]?.collected_dispatch_status ||
    "no dispatch_status field"

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="CRM" title="Leads Dashboard" />

      <div className="bg-red-900 text-white p-4 text-xs font-mono space-y-2">
        <p>
          Raw array length from server: {JSON.stringify(leadsData?.length)} | First item dispatch_status:{" "}
          {firstDispatchStatus}
        </p>
        <p>
          UI mapped rows (after tabs): {JSON.stringify(leads.length)} | Salvage pool:{" "}
          {JSON.stringify(salvageLeads.length)} | Active org: {activeOrganizationId ?? "none"}
        </p>
        <p>
          DB total for auth user: {JSON.stringify(debugInfo?.totalRowsForUser ?? "?")} | Raw API count:{" "}
          {JSON.stringify(debugInfo?.rawLeadCount ?? "?")} | Filtered count (old query):{" "}
          {JSON.stringify(debugInfo?.filteredLeadCount ?? "?")} | With org_id:{" "}
          {JSON.stringify(debugInfo?.rowsWithOrganizationId ?? "?")} | Without org_id:{" "}
          {JSON.stringify(debugInfo?.rowsWithoutOrganizationId ?? "?")}
        </p>
        <p>Auth user_id: {debugInfo?.authUserId ?? "?"}</p>
        <p>{debugInfo?.orgFilterNote ?? "Org filter note unavailable"}</p>
        {debugInfo?.apiDegraded ? (
          <p className="text-yellow-200">API DEGRADED: {debugInfo.apiWarning ?? "unknown error"}</p>
        ) : null}
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-snug">
          {JSON.stringify(debugInfo?.sampleRows ?? [], null, 2)}
        </pre>
      </div>

      <LeadsSegmentNav activeTab={activeTab} onTabChange={onTabChange} counts={tabCounts} />

      <LeadSalvageSection leads={salvageLeads} />

      {loading && leads.length === 0 && salvageLeads.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <LeadsGrid
          rows={leads}
          selectedLead={selectedLead}
          onSelectLead={onSelectLead}
          onOpenNotesStage={onOpenNotesStage}
          onConvertToBooking={onConvertToBooking}
          convertingId={convertingId}
          emptyTabLabel={activeTab !== "all" ? `No leads in ${activeTabLabel ?? "this stage"}` : undefined}
        />
      )}
    </WorkspacePage>
  )
})

export const LeadsWorkspaceView = memo(function LeadsWorkspaceView() {
  const router = useRouter()
  const { activeOrganizationId, activeTab: dashboardTab } = useDashboardWorkspace()
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const initial = useLeadsWorkspaceInitial()
  const cached = useLeadsWorkspaceCacheSnapshot()
  const [fresh, setFresh] = useState<LeadsWorkspaceCache | null>(null)
  const [fetchDone, setFetchDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLead, setSelectedLead] = useState<DisplayLead | null>(null)
  const [activeTab, setActiveTab] = useState<LeadRecoveryTab>("all")
  const [notesLead, setNotesLead] = useState<DisplayLead | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [localLeadPatches, setLocalLeadPatches] = useState<Record<string, Partial<DisplayLead>>>({})
  const [removedLeadIds, setRemovedLeadIds] = useState<ReadonlySet<string>>(() => new Set())
  const [convertingId, setConvertingId] = useState<string | null>(null)

  const payload = fresh ?? initial ?? cached ?? null

  useEffect(() => {
    console.log("RAW DATABASE RESP:", {
      payloadLeads: payload?.leads,
      payloadDebug: payload?._debug,
      activeOrganizationId,
      ownerUserId,
    })
  }, [payload, activeOrganizationId, ownerUserId])

  useLayoutEffect(() => {
    if (initial) writeLeadsWorkspaceCache(initial)
  }, [initial])

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setOwnerUserId((data?.data?.user?.id as string | undefined) ?? null)
      })
      .catch(() => setOwnerUserId(null))
  }, [])

  const reloadLeads = useCallback(() => {
    void refreshLeadsWorkspaceCache()
      .then((data) => {
        console.log("RAW DATABASE RESP:", data)
        setFresh({ ...data, _debug: { ...data._debug, activeOrganizationId } })
        setError(null)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load leads")
      })
      .finally(() => {
        setFetchDone(true)
      })
  }, [activeOrganizationId])

  useEffect(() => {
    reloadLeads()
  }, [reloadLeads])

  useEffect(() => {
    if (dashboardTab !== "leads") return
    reloadLeads()
  }, [dashboardTab, reloadLeads])

  useEffect(() => {
    if (!ownerUserId || !isRealtimeClientConfigured()) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channel = pusher.subscribe(`owner-${ownerUserId}`)
    const onLeadChanged = () => {
      reloadLeads()
    }
    channel.bind("lead-salvageable", onLeadChanged)
    channel.bind("disposition-updated", onLeadChanged)
    return () => {
      channel.unbind("lead-salvageable", onLeadChanged)
      channel.unbind("disposition-updated", onLeadChanged)
    }
  }, [ownerUserId, reloadLeads])

  const allLeads = useMemo(() => {
    return (payload?.leads ?? [])
      .map(apiLeadToDisplay)
      .filter((row) => !removedLeadIds.has(row.id))
      .map((row) => ({ ...row, ...(localLeadPatches[row.id] ?? {}) }))
  }, [payload?.leads, removedLeadIds, localLeadPatches])

  const tabCounts = useMemo(() => {
    const counts: Record<LeadRecoveryTab, number> = {
      all: allLeads.length,
      pending_callbacks: 0,
      price_recovery: 0,
      waiting_on_parts: 0,
    }
    for (const lead of allLeads) {
      if (lead.recoveryStage === "pending_callbacks") counts.pending_callbacks += 1
      if (lead.recoveryStage === "price_recovery") counts.price_recovery += 1
      if (lead.recoveryStage === "waiting_on_parts") counts.waiting_on_parts += 1
    }
    return counts
  }, [allLeads])

  const leads = useMemo(
    () => allLeads.filter((row) => leadMatchesTab(row, activeTab)),
    [allLeads, activeTab]
  )

  const handleSaveNotesStage = useCallback(
    async (lead: DisplayLead, note: string, stage: LeadRecoveryStage) => {
      const res = await fetch(`/api/ai-leads/${encodeURIComponent(lead.id)}/callback-note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action_required: note, sales_recovery_stage: stage }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not save notes.")

      setLocalLeadPatches((prev) => ({
        ...prev,
        [lead.id]: { ...prev[lead.id], actionLabel: note, recoveryStage: stage },
      }))

      const cache = readLeadsWorkspaceCache()
      if (cache) {
        writeLeadsWorkspaceCache({
          ...cache,
          leads: cache.leads.map((row) =>
            row.id === lead.id
              ? {
                  ...row,
                  collected: {
                    ...(row.collected ?? {}),
                    action_required: note,
                    action_required_label: note,
                    sales_recovery_stage: stage,
                  },
                }
              : row
          ),
        })
      }
    },
    []
  )

  const handleConvertToBooking = useCallback(
    async (lead: DisplayLead) => {
      setConvertingId(lead.id)
      try {
        const res = await fetch(`/api/ai-leads/${encodeURIComponent(lead.id)}/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ organization_id: activeOrganizationId }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(json.error || "Could not convert lead.")

        writeLeadsIntakeHandoff({
          leadId: lead.id,
          phoneNumber: lead.phoneE164 || lead.raw?.caller_e164?.trim() || "",
          customerName: lead.name,
          vehicleYear: lead.vehicleYear || undefined,
          vehicleMake: lead.vehicleMake || undefined,
          vehicleModel: lead.vehicleModel || undefined,
          quotedPriceCents: lead.quotedPriceCents ?? undefined,
        })

        setRemovedLeadIds((prev) => new Set(prev).add(lead.id))
        if (selectedLead?.id === lead.id) setSelectedLead(null)
        router.push("/dashboard/scheduler")
      } finally {
        setConvertingId(null)
      }
    },
    [activeOrganizationId, router, selectedLead?.id]
  )

  const salvageLeads = payload?.salvageLeads ?? []
  const showSpinner = !payload && !fetchDone

  const usingDemo = false

  return (
    <>
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
          leadsData={payload?.leads ?? []}
          debugInfo={{
            ...payload?._debug,
            activeOrganizationId,
          }}
          activeOrganizationId={activeOrganizationId}
          salvageLeads={salvageLeads}
          usingDemo={usingDemo}
          selectedLead={selectedLead}
          activeTab={activeTab}
          tabCounts={tabCounts}
          onTabChange={setActiveTab}
          onSelectLead={setSelectedLead}
          onOpenNotesStage={(lead) => {
            setNotesLead(lead)
            setNotesOpen(true)
          }}
          onConvertToBooking={handleConvertToBooking}
          convertingId={convertingId}
        />
      </WorkspaceRightSheetGate>

      <LeadNotesStageSheet
        lead={notesLead}
        open={notesOpen}
        onOpenChange={(open) => {
          setNotesOpen(open)
          if (!open) setNotesLead(null)
        }}
        onSave={handleSaveNotesStage}
      />
    </>
  )
})
