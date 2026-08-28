"use client"

// Customers & Leads CRM hub — list + profile (desktop side panel / mobile centered dialog).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarCheck,
  Car,
  Check,
  CreditCard,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react"
import { buildTelHref } from "@/lib/phone-e164"
import {
  flickerSafeSearchParamNames,
  logFlicker,
  logFlickerNav,
  useFlickerDebugLifecycle,
} from "@/lib/debug/flicker-debug"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { buildSchedulerFocusUrl } from "@/lib/scheduler-focus-url"
import {
  continueOpenQuoteStep,
  isOpenLeadPoolReady,
  resolveOpenQuoteYmm,
  serviceQuoteTypeIdFromCrmHistory,
} from "@/lib/callback-intake-chooser"
import { isSubstantialStreetAddress } from "@/lib/intake-address-helpers"
import {
  buildUnreachableFollowUpSms,
  crmCallbackOutcomeLabel,
  formatCrmBookedStatusLabel,
  formatCrmListRowMeta,
  isCrmBookedStatusLabel,
  isCrmPreBookStatusLabel,
  isCrmTerminalStatusLabel,
  shouldShowCrmLifecycleCard,
  type LeadCallbackOutcome,
} from "@/lib/unreachable-follow-up"
import { useInboundCallPanelOptional } from "@/lib/inbound-call-panel-context"
import { CustomerSmsComposer } from "@/components/messaging/customer-sms-composer"
import type {
  CrmCustomerListItem,
  CrmLeadBadge,
  CrmServiceHistoryItem,
  CustomerVehicle,
  DispatchJob,
} from "@/lib/types"
import {
  crmIntakeFilledByLabel,
  isBookFormIntakeSource,
} from "@/lib/book-form-sources"
import { jobTypeFromBookFormKind } from "@/lib/book-customer-request"
import {
  formatCollectedDollars,
  type OwnerCollectedTransaction,
} from "@/lib/owner-collected"
import { openCollectPaymentModal } from "@/lib/settings-modals-events"
import { pickOpenCollectJobForPhone } from "@/lib/collect-job-match"
import { looksLikePhoneQuery, pickCrmCustomerIdForPhone } from "@/lib/crm-phone-match"
import { RecordInvoicesPanel } from "@/components/dashboard/record-invoices-panel"
import { cn } from "@/lib/utils"
import { WorkspaceFilterPills } from "@/components/workspace-filter-pills"
import {
  ClientSearchParamsBridge,
  readWindowSearchQuery,
  searchQueryToParams,
} from "@/components/client-search-params-bridge"
import { usePollBudget } from "@/lib/hooks/use-poll-budget"
import { useSettledListSurface } from "@/lib/hooks/use-settled-list-surface"
import { useWorkspaceOrgId } from "@/lib/hooks/use-workspace-org-id"
import { persistedCacheKey, readPersistedCache, writePersistedCache } from "@/lib/swr/persisted-cache"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"
import {
  crmPaintToListItems,
  crmListFingerprint,
  readCrmListPaintSeed,
  readCrmListIndex,
  writeCrmListPaintSeed,
} from "@/lib/crm-list-paint-cache"
import {
  crmListIsQuietExpansion,
  mergePaintedCrmHeads,
  mergeVisibleCrmRows,
} from "@/lib/crm-list-merge"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import { useIsMobile } from "@/hooks/use-mobile"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { buildRescueOfferSmsPreview } from "@/lib/rescue-queue"
import { recoveryStepPrices } from "@/lib/price-negotiation"
import {
  emailFromCustomerNotes,
  isWalkUpHistoryId,
  mergeCrmServiceHistoryWithWalkUps,
} from "@/lib/crm-walk-up-history"

type CrmFilter = "all" | "leads" | "clients" | "book_forms"

const BADGE_LABEL: Record<CrmLeadBadge, string> = {
  booked_client: "Booked client",
  price_quoted: "Price quoted",
  // Salvage / PRICE_REJECTED — not “Price quoted” next to Recover.
  needs_recovery: "Needs recovery",
  // Missed-call / pending callback leads — operator should call back.
  callback: "Needs call",
  repeat_customer: "Repeat customer",
  new_contact: "New contact",
}

/** Soft color for the CRM list-row job status (Needs call / Booked / Complete…). */
function crmListStatusToneClass(
  tone: CrmCustomerListItem["job_status_tone"] | undefined
): string {
  if (tone === "amber") return "text-warning/90"
  if (tone === "rose") return "text-rose-300/90"
  if (tone === "sky") return "text-sky-300/90"
  if (tone === "emerald") return "text-success/90"
  return "text-muted-foreground"
}

/** Human service label from book chip or job_type (never invent Lockout from blanks). */
function crmServiceLabel(item: CrmServiceHistoryItem): string {
  const kind = String(item.job_kind ?? "").trim().toLowerCase()
  if (kind) return jobTypeFromBookFormKind(kind)
  const typed = String(item.job_type ?? "").trim()
  if (typed) return typed
  return String(item.summary ?? "").trim() || "Service request"
}

/** Short urgency line for book-form / open-lead cards. */
function crmUrgencyLabel(item: CrmServiceHistoryItem): string | null {
  if (String(item.urgency ?? "").toLowerCase() === "asap" || item.intake_source === "public_book_asap") {
    return "ASAP"
  }
  const avail = String(item.availability_label ?? "").trim()
  if (avail) return avail
  if (String(item.urgency ?? "").toLowerCase() === "window") return "Preferred window"
  return null
}

/** CRM → Scheduler action label for a history row (no more overloaded "Convert"). */
type CrmJobNavAction = "Book job" | "Open job" | "View job" | "Recover"

/** Open quote/callback → Book; salvage → Recover; pool/active → Open; terminal → View. */
function crmJobNavAction(item: CrmServiceHistoryItem): CrmJobNavAction | null {
  // Synthetic walk-up cards are not real ai_leads — no Scheduler deep-link.
  if (isWalkUpHistoryId(item.id) || item.status_label === "Paid walk-up") return null
  // Complete / Cancelled / referred close-outs open read-only on Scheduler.
  if (isCrmTerminalStatusLabel(item.status_label)) return "View job"
  // P2: fold PRICE_REJECTED / lost into CRM Leads with Recover (same Book/Continue path).
  if (item.is_open_lead && item.is_salvageable) return "Recover"
  if (item.is_open_lead) return "Book job"
  // Existing non-lead jobs (pool / scheduled / field progress).
  if (
    item.status_label === "In pool" ||
    item.status_label === "Scheduled" ||
    item.status_label === "En route" ||
    item.status_label === "On site" ||
    item.status_label === "Paused" ||
    item.status_label === "Active" || // legacy
    item.status_label === "Booked" || // legacy
    item.status_label.startsWith("Booked ·") ||
    item.status_label === "Job"
  ) {
    return "Open job"
  }
  return null
}

/** Header / row button text — one schedule CTA matching lead state. */
function crmJobNavButtonLabel(action: CrmJobNavAction, opts?: { poolReady?: boolean }): string {
  switch (action) {
    case "Book job":
      // Thin quote → Continue intake; pool-ready → Book on Scheduler.
      return opts?.poolReady === false ? "Continue" : "Book job"
    case "Recover":
      return "Recover quote"
    case "Open job":
      return "Open this job"
    case "View job":
      return "View job"
  }
}

function crmJobNavTitle(action: CrmJobNavAction): string {
  switch (action) {
    case "Book job":
      return "Upgrade this quote — schedule on Scheduler, or continue intake if details are thin"
    case "Recover":
      // Not a discount SMS — reopen the quote / continue booking.
      return "Reopen quote / continue booking"
    case "Open job":
      return "Open this job on Scheduler"
    case "View job":
      return "View this job on Scheduler"
  }
}

/** Customer street is enough for Book pool-ready when lead collected has no address. */
function crmCustomerAddressReady(customer: {
  address_line1?: string | null
  city?: string | null
}): boolean {
  const line1 = String(customer.address_line1 ?? "").trim()
  const city = String(customer.city ?? "").trim()
  if (line1 && city) return true
  return isSubstantialStreetAddress(line1)
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

/** Suggested rescue dollars from a quoted amount (same ~15% step as rescue-queue). */
function rescueOfferDollarsFromCents(amountCents: number | null | undefined): number {
  const dollars = Math.max(0, Math.round((amountCents ?? 0) / 100))
  if (dollars <= 0) return 0
  return recoveryStepPrices(dollars).step2Price
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

/** Short date/time for a payment row. */
function formatPaymentWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Plain English payment method for CRM. */
function paymentMethodLabel(method: OwnerCollectedTransaction["paymentMethod"]): string {
  if (method === "TAP_TO_PAY") return "Tap to Pay"
  if (method === "CASH") return "Cash"
  return "Card"
}

/** Paid / Pending / Failed badge text. */
function paymentStatusLabel(status: OwnerCollectedTransaction["status"]): string {
  if (status === "COMPLETED") return "Paid"
  if (status === "FAILED") return "Failed"
  return "Pending"
}

const EMPTY_CRM_ROWS: CrmCustomerListItem[] = []

/** Stable empties — `setX([])` every effect run allocates new arrays and can #185-loop. */
const EMPTY_CRM_VEHICLES: CustomerVehicle[] = []
const EMPTY_CRM_HISTORY: CrmServiceHistoryItem[] = []
const EMPTY_CRM_PAYMENTS: OwnerCollectedTransaction[] = []

/** Stable row id — avoid inline getId recreating frozen lists every render. */
function crmCustomerRowId(row: CrmCustomerListItem): string {
  return row.id
}

/** List fields that may refresh while a profile is open — used to skip no-op syncs (#185). */
function crmCustomerListSyncKey(row: CrmCustomerListItem): string {
  return [
    row.id,
    row.display_name,
    row.phone_e164,
    row.lead_badge,
    row.job_status_label ?? "",
    row.job_status_tone ?? "",
    row.open_lead_count,
    row.jobs_completed,
    row.lifetime_revenue_cents,
  ].join("|")
}

function crmListCacheKey(filter: CrmFilter, q: string): string {
  return persistedCacheKey("crm-customers", `${filter}:${q.trim().toLowerCase() || "all"}`)
}

function readCrmListCache(
  filter: CrmFilter,
  q: string,
  paint?: ReturnType<typeof readCrmListPaintSeed>,
  orgId?: string | null
): CrmCustomerListItem[] {
  const cached = readPersistedCache<{ customers: CrmCustomerListItem[] }>(crmListCacheKey(filter, q))
  if (cached && Array.isArray(cached.customers) && cached.customers.length > 0) {
    return cached.customers
  }
  // Default All list — session index (80) then cookie paint (16).
  if (filter === "all" && !q.trim()) {
    const index = readCrmListIndex(orgId ?? null)
    if (index?.customers.length) return crmPaintToListItems(index)
    if (paint?.customers.length) return crmPaintToListItems(paint)
  }
  if (!cached || !Array.isArray(cached.customers)) return EMPTY_CRM_ROWS
  return cached.customers.length > 0 ? cached.customers : EMPTY_CRM_ROWS
}

const CrmWorkspaceViewInner = memo(function CrmWorkspaceViewInner({
  isActive = true,
  urlQuery,
}: {
  isActive?: boolean
  // Live URL query from ClientSearchParamsBridge (does not suspend this pane).
  urlQuery: string
}) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const inboundCallPanel = useInboundCallPanelOptional()
  const { orgId: crmOrgId, orgReady, orgResolving } = useWorkspaceOrgId()
  const paintSeeds = useDashboardPaintSeeds()
  // Memoize — cookie fallback must not allocate a new object every render (#185).
  const crmPaint = useMemo(
    () => readCrmListPaintSeed(paintSeeds.crm, crmOrgId),
    [paintSeeds.crm, crmOrgId]
  )
  // Parse ?tab= / ?customer= / ?phone= without useSearchParams() remounting CRM on tab click.
  const searchParams = useMemo(() => searchQueryToParams(urlQuery), [urlQuery])
  // Pause CRM list fetches when the pane or browser tab is hidden.
  const pollEnabled = usePollBudget(isActive)
  const tabParam = searchParams.get("tab")
  // Return-from-Scheduler deep link — reopen this customer profile.
  const customerParam = searchParams.get("customer")?.trim() || null
  const initialFilter: CrmFilter =
    tabParam === "leads"
      ? "leads"
      : tabParam === "clients"
        ? "clients"
        : tabParam === "book_forms"
          ? "book_forms"
          : "all"

  const [q, setQ] = useState("")
  const [debounced, setDebounced] = useState("")
  const [filter, setFilter] = useState<CrmFilter>(initialFilter)
  // Seed list search from ?phone= (waiting-card CRM deep-link).
  useEffect(() => {
    const phoneParam = searchParams.get("phone")?.trim() || ""
    if (phoneParam) setQ(phoneParam)
  }, [searchParams])

  const listScopeKey = `${crmOrgId ?? "default"}:${filter}:${debounced}`

  const readCrmSession = useCallback(
    () => readCrmListCache(filter, debounced, crmPaint, crmOrgId),
    [filter, debounced, crmPaint, crmOrgId]
  )

  const readCrmPaintRows = useCallback(
    () =>
      filter === "all" && !debounced.trim() && crmPaint?.customers.length
        ? crmPaintToListItems(crmPaint)
        : EMPTY_CRM_ROWS,
    [crmPaint, filter, debounced]
  )

  const {
    rows,
    paintRows: paintListRows,
    applyNetworkList,
    resetSurface,
    networkSettled: listSettled,
    hasSeedRows,
    rowsForCompareRef,
    setNetworkSettled,
    setLiveRows,
  } = useSettledListSurface<CrmCustomerListItem>({
    scopeKey: listScopeKey,
    empty: EMPTY_CRM_ROWS,
    orgReady,
    readSession: readCrmSession,
    readPaint: readCrmPaintRows,
    mergePaintWithSession: mergePaintedCrmHeads,
    mergeVisibleWithLive: mergeVisibleCrmRows,
    getId: crmCustomerRowId,
  })
  // Keep reset out of effect deps — identity churn was retriggering list clears (#185).
  const resetSurfaceRef = useRef(resetSurface)
  resetSurfaceRef.current = resetSurface

  // Paint rows via ref so loadList identity does not churn when paint array identity changes.
  const paintListRowsRef = useRef(paintListRows)
  paintListRowsRef.current = paintListRows
  const phoneDeepLinkKey = (searchParams.get("phone")?.replace(/\D/g, "").slice(-10) || "")


  const [loading, setLoading] = useState(() => !hasSeedRows)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(customerParam)
  // Apply ?phone= once so closing the card does not immediately reopen it.
  const phoneDeepLinkAppliedRef = useRef<string | null>(null)
  // CRM pane stays mounted — false until we see it active so Messages → CRM can reopen.
  const crmWasActiveRef = useRef(false)

  useFlickerDebugLifecycle("CrmWorkspaceView", {
    isActive,
    loading,
    rowCount: rows.length,
    liveRowsNull: !listSettled,
    cachedRowCount: rows.length,
    showingEmpty: listSettled && rows.length === 0,
    filter,
    searchParamNames: flickerSafeSearchParamNames(urlQuery).join(","),
  })

  const [profileLoading, setProfileLoading] = useState(false)
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([])
  const [history, setHistory] = useState<CrmServiceHistoryItem[]>([])
  // Wallet charges for this phone (walk-up Collect + job payments).
  const [payments, setPayments] = useState<OwnerCollectedTransaction[]>([])
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

  // Profile fields — name inline; appointment edited on history rows.
  const [editName, setEditName] = useState("")
  // Which history row is in micro-edit for scheduled appointment (lead/job id).
  const [editingApptId, setEditingApptId] = useState<string | null>(null)
  // datetime-local draft while editing that row’s appointment.
  const [editApptLocal, setEditApptLocal] = useState("")
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  // Job id while CRM “Send review” backup is in flight.
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null)
  // Send invoice/receipt for a past payment (same API as Money → payments).
  const [receiptTx, setReceiptTx] = useState<OwnerCollectedTransaction | null>(null)
  const [receiptName, setReceiptName] = useState("")
  const [receiptEmail, setReceiptEmail] = useState("")
  const [receiptPhone, setReceiptPhone] = useState("")
  const [receiptChannel, setReceiptChannel] = useState<"email" | "sms">("sms")
  const [receiptBusy, setReceiptBusy] = useState(false)
  // Record invoice for jobs paid outside Lyncr (Venmo) — no Stripe charge.
  const [recordInvoiceOpen, setRecordInvoiceOpen] = useState(false)
  const [recordInvoiceJobId, setRecordInvoiceJobId] = useState<string | null>(null)
  const [recordAmountDollars, setRecordAmountDollars] = useState("75")
  const [recordPayMethod, setRecordPayMethod] = useState<"VENMO" | "CASH" | "OTHER" | "EXTERNAL">(
    "VENMO"
  )
  const [recordPayNote, setRecordPayNote] = useState("Paid via Venmo")
  const [recordChannel, setRecordChannel] = useState<"email" | "sms" | "both">("sms")
  const [recordVin, setRecordVin] = useState("")
  const [recordBusy, setRecordBusy] = useState(false)
  // After a successful send, highlight this invoice in the Invoices list.
  const [invoiceHighlightId, setInvoiceHighlightId] = useState<string | null>(null)
  const [invoicesRefreshKey, setInvoicesRefreshKey] = useState(0)
  // Inline garage VIN / YMM edit.
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)
  const [editVehicleForm, setEditVehicleForm] = useState({
    year: "",
    make: "",
    model: "",
    vin: "",
  })
  const [editVehicleBusy, setEditVehicleBusy] = useState(false)
  // SMS preview sheet — follow-up / rescue draft before real send.
  const [smsPreviewOpen, setSmsPreviewOpen] = useState(false)
  const [smsPreviewKind, setSmsPreviewKind] = useState<"follow_up" | "rescue">("follow_up")
  const [smsPreviewDraft, setSmsPreviewDraft] = useState("")
  const [smsPreviewSending, setSmsPreviewSending] = useState(false)
  /** Message button → template picker (not a blank Messages tab). */
  const [messageTemplatesOpen, setMessageTemplatesOpen] = useState(false)
  /** Busy flag while marking Called · no answer / answered / unreachable SMS. */
  const [unreachableBusy, setUnreachableBusy] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (tabParam === "leads") setFilter("leads")
    else if (tabParam === "clients") setFilter("clients")
    else if (tabParam === "book_forms") setFilter("book_forms")
  }, [tabParam])

  // Reopen profile when Scheduler returns with ?customer= (or operator shares the link).
  useEffect(() => {
    if (!customerParam) return
    setSelectedId(customerParam)
  }, [customerParam])

  // Messages CRM chip: open this phone’s card, including a second tap after close.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useEffect(() => {
    const becameActive = isActive && !crmWasActiveRef.current
    crmWasActiveRef.current = isActive
    if (becameActive && !selectedId) phoneDeepLinkAppliedRef.current = null
    if (customerParam) return
    const phoneParam = searchParams.get("phone")?.trim() || ""
    const key = phoneParam.replace(/\D/g, "").slice(-10)
    if (key.length < 10) return
    if (phoneDeepLinkAppliedRef.current === key) return
    const id = pickCrmCustomerIdForPhone(rowsRef.current, phoneParam)
    if (!id) return
    phoneDeepLinkAppliedRef.current = key
    setSelectedId(id)
  }, [isActive, customerParam, phoneDeepLinkKey, selectedId, rows.length])

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 280)
    return () => window.clearTimeout(t)
  }, [q])

  const loadList = useCallback(() => {
    if (!pollEnabled || orgResolving || !orgReady) return
    const params = new URLSearchParams()
    if (debounced) params.set("q", debounced)
    params.set("filter", filter)
    // Same zone as Activity — “Booked · …” and paint cookies stay stable.
    params.set("timezone", resolveBrowserTimezone())
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
        const baseline = rowsForCompareRef.current
        if (
          baseline.length > 0 &&
          crmListFingerprint(baseline) === crmListFingerprint(list)
        ) {
          setNetworkSettled(true)
          setError(null)
          return
        }
        let toApply = list
        const painted = paintListRowsRef.current
        if (
          painted.length > 0 &&
          crmListIsQuietExpansion(painted, list)
        ) {
          toApply = mergePaintedCrmHeads(painted, list)
        }
        if (baseline.length === 0) {
          logFlicker({
            event: "list-replace",
            component: "CrmWorkspaceView",
            rowCount: list.length,
            liveRowsNull: false,
          })
        }
        applyNetworkList(toApply)
        writePersistedCache(crmListCacheKey(filter, debounced), {
          customers: list,
        })
        if (filter === "all" && !debounced.trim()) {
          writeCrmListPaintSeed(list, crmOrgId)
        }
        setError(null)
        setSelectedId((prev) => {
          if (prev && list.some((r) => r.id === prev)) return prev
          const phoneParam = searchParams.get("phone")?.trim() || ""
          // No phone deep-link — never clear/force selection from a list poll (#185).
          if (!phoneParam) return prev
          const key = phoneParam.replace(/\D/g, "").slice(-10)
          // Deep link already handled (open or closed) — keep current selection as-is.
          if (key.length >= 10 && phoneDeepLinkAppliedRef.current === key) return prev
          const fromPhone = pickCrmCustomerIdForPhone(list, phoneParam)
          if (fromPhone) {
            phoneDeepLinkAppliedRef.current = key
            return fromPhone
          }
          return prev
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => {
        setLoading(false)
      })
  }, [
    debounced,
    filter,
    pollEnabled,
    phoneDeepLinkKey,
    crmOrgId,
    orgResolving,
    orgReady,
    applyNetworkList,
    setNetworkSettled,
  ])

  // Filter/search change — drop live override so the matching seed can show.
  // Skip the first mount — org bootstrap must not look like a filter change (#185).
  const didMountFilterResetRef = useRef(false)
  useEffect(() => {
    if (!didMountFilterResetRef.current) {
      didMountFilterResetRef.current = true
      return
    }
    logFlicker({
      event: "list-clear",
      component: "CrmWorkspaceView",
      reason: "filter-or-search",
      liveRowsNull: true,
    })
    resetSurfaceRef.current()
    const seeded = readCrmListCache(filter, debounced, crmPaint, crmOrgId).length > 0
    setLoading((prev) => {
      const next = !seeded
      return prev === next ? prev : next
    })
  }, [filter, debounced])

  const prevOrgForCrmRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const prev = prevOrgForCrmRef.current
    prevOrgForCrmRef.current = crmOrgId
    if (prev === undefined) return
    if (prev === crmOrgId) return
    logFlicker({
      event: "list-clear",
      component: "CrmWorkspaceView",
      reason: "org-switch",
      liveRowsNull: true,
    })
    resetSurfaceRef.current()
    const seeded = readCrmListCache(filter, debounced, crmPaint, crmOrgId).length > 0
    setLoading((prevLoading) => {
      const next = !seeded
      return prevLoading === next ? prevLoading : next
    })
  }, [crmOrgId])

  useEffect(() => {
    if (rows.length > 0) setLoading(false)
  }, [rows.length])

  useEffect(() => {
    if (hasSeedRows) setLoading(false)
  }, [hasSeedRows])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const applyProfilePayload = useCallback(
    (json: {
      data?: {
        customer?: CrmCustomerListItem | { id: string; display_name: string; notes: string; phone_e164: string; company_name: string }
        vehicles?: CustomerVehicle[]
        history?: CrmServiceHistoryItem[]
        payments?: OwnerCollectedTransaction[]
      }
    }) => {
      const c = json.data?.customer
      const hist = json.data?.history ?? []
      const pays = Array.isArray(json.data?.payments) ? json.data!.payments! : []
      if (c) {
        // Prefer API fields when present; otherwise keep list-row LTV/jobs (never flash $0).
        const fromApi = c as Partial<CrmCustomerListItem>
        setSelected((prev) => {
          const listRow = prev?.id === c.id ? prev : null
          return {
            ...(listRow ?? ({} as CrmCustomerListItem)),
            ...c,
            jobs_completed:
              typeof fromApi.jobs_completed === "number"
                ? fromApi.jobs_completed
                : listRow?.jobs_completed ?? 0,
            lifetime_revenue_cents:
              typeof fromApi.lifetime_revenue_cents === "number"
                ? fromApi.lifetime_revenue_cents
                : listRow?.lifetime_revenue_cents ?? 0,
            lead_badge: fromApi.lead_badge ?? listRow?.lead_badge ?? "new_contact",
            open_lead_count:
              typeof fromApi.open_lead_count === "number"
                ? fromApi.open_lead_count
                : listRow?.open_lead_count ?? 0,
          }
        })
        setEditName(c.display_name ?? "")
      }
      setVehicles(json.data?.vehicles?.length ? json.data.vehicles : EMPTY_CRM_VEHICLES)
      setHistory(hist.length ? hist : EMPTY_CRM_HISTORY)
      setPayments(pays.length ? pays : EMPTY_CRM_PAYMENTS)
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
          setVehicles(EMPTY_CRM_VEHICLES)
          setHistory(EMPTY_CRM_HISTORY)
          setPayments(EMPTY_CRM_PAYMENTS)
        })
        .finally(() => setProfileLoading(false))
    },
    [applyProfilePayload]
  )

  // List refresh must not re-hit the profile API (was a CRM drawer refetch storm).
  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      setVehicles(EMPTY_CRM_VEHICLES)
      setHistory(EMPTY_CRM_HISTORY)
      setPayments(EMPTY_CRM_PAYMENTS)
      setEditName("")
      setEditingApptId(null)
      setEditApptLocal("")
      setEditingName(false)
      setReceiptTx(null)
      setInvoiceHighlightId(null)
      return
    }
    setEditingName(false)
    setEditingApptId(null)
    setEditApptLocal("")
    void loadProfile(selectedId)
  }, [selectedId, loadProfile])

  // Keep selected summary in sync with list badges — only when list fields actually change (#185).
  // Fingerprint only — do not put `rows` in effect deps (array identity churn → #185).
  const selectedListSyncKey =
    selectedId
      ? (() => {
          const fromList = rowsRef.current.find((r) => r.id === selectedId)
          return fromList ? crmCustomerListSyncKey(fromList) : ""
        })()
      : ""

  useEffect(() => {
    if (!selectedId || !selectedListSyncKey) return
    const fromList = rows.find((r) => r.id === selectedId) ?? null
    if (!fromList) return
    setSelected((prev) => {
      if (!prev || prev.id !== fromList.id) return fromList
      // Same list fields already applied — return prev to avoid update-depth loops.
      if (crmCustomerListSyncKey(prev) === selectedListSyncKey) return prev
      return {
        ...prev,
        ...fromList,
      }
    })
    setEditName((prev) => {
      if (prev.trim()) return prev
      const next = fromList.display_name || ""
      return prev === next ? prev : next
    })
    // Intentionally depend on selectedListSyncKey (not rows) so array identity churn cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rows read only when sync key changes
  }, [selectedId, selectedListSyncKey])

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

  const customerDisplayName = editName.trim() || selected?.display_name || "there"

  // First salvageable open lead — powers Recover CTA + Draft rescue offer.
  const salvageOpenLead = useMemo(
    () => openLeadHistory.find((h) => h.is_salvageable) ?? null,
    [openLeadHistory]
  )

  // Header: one schedule CTA — open lead first, else active job, else latest terminal.
  const headerJobTarget = useMemo((): CrmServiceHistoryItem | null => {
    if (openLeadHistory[0]) return openLeadHistory[0]
    const openJob = history.find((h) => crmJobNavAction(h) === "Open job")
    if (openJob) return openJob
    const viewJob = history.find((h) => crmJobNavAction(h) === "View job")
    return viewJob ?? null
  }, [openLeadHistory, history])

  const headerJobAction: CrmJobNavAction | null = headerJobTarget
    ? crmJobNavAction(headerJobTarget)
    : null

  // Pool-ready drives Continue vs Book job on the header CTA.
  const headerPoolReady =
    headerJobTarget != null &&
    selected != null &&
    (headerJobAction === "Book job" || headerJobAction === "Recover")
      ? isOpenLeadPoolReady({
          lead: headerJobTarget,
          customerAddressReady: crmCustomerAddressReady(selected),
          garage: vehicles[0] ?? null,
        })
      : true

  /** Open SMS preview with rescue / lower-price draft (salvage leads only). */
  const openRescuePreview = () => {
    if (!selected || !salvageOpenLead) return
    const offer = rescueOfferDollarsFromCents(salvageOpenLead.amount_cents)
    if (offer <= 0) {
      toast({
        title: "No quoted price",
        description: "Add a quote amount before drafting a rescue offer.",
        variant: "destructive",
      })
      return
    }
    setSmsPreviewKind("rescue")
    setSmsPreviewDraft(
      buildRescueOfferSmsPreview({
        customerName: customerDisplayName,
        offerDollars: offer,
      })
    )
    setSmsPreviewOpen(true)
  }

  /** POST the preview draft via Messages send API — Send means send. */
  const sendSmsPreview = async () => {
    if (!selected || smsPreviewSending) return
    const text = smsPreviewDraft.trim()
    if (!text) {
      toast({
        title: "Empty message",
        description: "Type a message before sending.",
        variant: "destructive",
      })
      return
    }
    setSmsPreviewSending(true)
    try {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.phone_e164,
          text,
          lead_id: salvageOpenLead?.id || openLeadHistory[0]?.id || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast({
          title: "SMS failed",
          description: json.error || "Could not send the text.",
          variant: "destructive",
        })
        return
      }
      toast({ title: "SMS sent", description: text })
      setSmsPreviewOpen(false)
      setSaveMsg("SMS sent")
    } catch {
      toast({
        title: "SMS failed",
        description: "Could not send the text.",
        variant: "destructive",
      })
    } finally {
      setSmsPreviewSending(false)
    }
  }

  /** Jump to Messages with the edited draft (does not send). */
  const editSmsInMessages = () => {
    if (!selected) return
    const href = `/dashboard/messages?phone=${encodeURIComponent(selected.phone_e164)}&draft=${encodeURIComponent(
      smsPreviewDraft
    )}`
    setSmsPreviewOpen(false)
    setSelectedId(null)
    setSelected(null)
    logFlickerNav("push", href, "CrmWorkspaceView")
    router.push(href)
  }

  /**
   * Mark Called · no answer / Called · answered (status only — SMS lives under Message templates).
   * Updates the local history badge immediately so Needs call clears.
   */
  const markCallbackOutcome = useCallback(
    async (lead: CrmServiceHistoryItem, outcome: LeadCallbackOutcome) => {
      // Guard: need a selected customer and no other status request in flight.
      if (!selected || unreachableBusy) return
      // Flip the busy flag so chips show a spinner and cannot double-tap.
      setUnreachableBusy(true)
      // Human badge text for the toast + optimistic UI.
      const label = crmCallbackOutcomeLabel(outcome)
      try {
        // Persist callback_outcome on the lead (no SMS from this path).
        const res = await fetch(
          `/api/owner/jobs/${encodeURIComponent(lead.id)}/callback-outcome`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              outcome,
              send_sms: false,
              customer_phone: selected.phone_e164,
              customer_name: editName.trim() || selected.display_name,
            }),
          }
        )
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: { label?: string }
        }
        if (!res.ok) {
          toast({
            title: "Could not update",
            description: json.error || "Try again.",
            variant: "destructive",
          })
          return
        }
        // Prefer server label; fall back to the local glossary string.
        const nextLabel = json.data?.label || label
        // Answered is sky; no-answer stays amber like Needs call.
        const nextTone = outcome === "called_answered" ? ("sky" as const) : ("amber" as const)
        // Optimistic history patch so the badge flips without a full reload.
        setHistory((prev) =>
          prev.map((h) =>
            h.id === lead.id ? { ...h, status_label: nextLabel, status_tone: nextTone } : h
          )
        )
        toast({
          title: nextLabel,
          description: "Status updated on this request.",
        })
        setSaveMsg(nextLabel)
      } catch {
        toast({
          title: "Could not update",
          description: "Check your connection and try again.",
          variant: "destructive",
        })
      } finally {
        // Always clear the spinner / disable state.
        setUnreachableBusy(false)
      }
    },
    [selected, unreachableBusy, editName, toast]
  )

  /**
   * Mark Cancelled or Complete from the Submitted request card (same owner status API as Scheduler).
   */
  const markJobLifecycleStatus = useCallback(
    async (lead: CrmServiceHistoryItem, status: "cancelled" | "completed") => {
      // Guard: need a selected customer and no other status request in flight.
      if (!selected || unreachableBusy) return
      // Flip the busy flag so chips show a spinner and cannot double-tap.
      setUnreachableBusy(true)
      // Badge text for optimistic UI + toast.
      const nextLabel = status === "completed" ? "Complete" : "Cancelled"
      // Complete is emerald; Cancelled is neutral grey.
      const nextTone = status === "completed" ? ("emerald" as const) : ("neutral" as const)
      try {
        // PATCH job_status + dispatch_status on ai_leads (no new Neon columns).
        const res = await fetch(`/api/owner/jobs/${encodeURIComponent(lead.id)}/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // CRM chips do not force review SMS — Scheduler Complete still can.
          body: JSON.stringify({ status, send_review_sms: false }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast({
            title: "Could not update",
            description: json.error || "Try again.",
            variant: "destructive",
          })
          return
        }
        // Optimistic patch: close the open-lead flag so Book job becomes View job.
        setHistory((prev) =>
          prev.map((h) =>
            h.id === lead.id
              ? {
                  ...h,
                  status_label: nextLabel,
                  status_tone: nextTone,
                  is_open_lead: false,
                  is_salvageable: false,
                  dispatch_status: status,
                }
              : h
          )
        )
        toast({
          title: nextLabel,
          description:
            status === "completed"
              ? "Marked this job complete."
              : "Marked this request cancelled.",
        })
        setSaveMsg(nextLabel)
      } catch {
        toast({
          title: "Could not update",
          description: "Check your connection and try again.",
          variant: "destructive",
        })
      } finally {
        // Always clear the spinner / disable state.
        setUnreachableBusy(false)
      }
    },
    [selected, unreachableBusy, toast]
  )

  /**
   * Universal job sheet: Open/View (and pool-ready Book) → Scheduler JobDetailDrawer.
   * Thin Book / Recover → Continue-intake with existing_lead_id (upgrade, not blank Service/Lockout).
   * Always close the CRM profile first so Dialog z-[7000] cannot bury the drawer/intake.
   */
  const openJobOnScheduler = useCallback(
    (lead?: CrmServiceHistoryItem | null) => {
      if (!selected) return
      const target = lead ?? headerJobTarget ?? null
      const customerId = selected.id
      const customerPhone = selected.phone_e164
      const customerName = editName.trim() || selected.display_name || ""
      const action = target ? crmJobNavAction(target) : null

      // Book / Recover on a thin quote → Continue-intake (same as callback chooser).
      if (
        (action === "Book job" || action === "Recover") &&
        target?.id &&
        inboundCallPanel
      ) {
        const garageHead = vehicles[0] ?? null
        const poolReady = isOpenLeadPoolReady({
          lead: target,
          customerAddressReady: crmCustomerAddressReady(selected),
          garage: garageHead,
        })
        if (!poolReady) {
          const ymm = resolveOpenQuoteYmm({ lead: target, garage: garageHead })
          const serviceId = serviceQuoteTypeIdFromCrmHistory(target) ?? ""
          const addressReady =
            Boolean(target.has_job_address) ||
            crmCustomerAddressReady(selected) ||
            isSubstantialStreetAddress(String(target.address_line1 ?? ""))
          const startStep = continueOpenQuoteStep({
            serviceTypeId: serviceId,
            vehicleYear: ymm.year,
            vehicleMake: ymm.make,
            vehicleModel: ymm.model,
            addressReady,
            displayName: customerName,
          })
          // Same rich hydrate as Latest book-form alert → Book job.
          const fromBook = Boolean(
            target.filled_by_customer || isBookFormIntakeSource(target.intake_source)
          )
          const asapNote =
            String(target.urgency ?? "").toLowerCase() === "asap" ||
            target.intake_source === "public_book_asap"
              ? "Customer urgency: ASAP / emergency"
              : ""
          const notesParts = [
            asapNote,
            String(target.customer_notes ?? "").trim(),
            String(target.job_notes ?? "").trim(),
          ].filter(Boolean)
          setSelectedId(null)
          setSelected(null)
          inboundCallPanel.openManualCallPanel({
            phoneNumber: customerPhone,
            customerName,
            vehicleYear: ymm.year,
            vehicleMake: ymm.make,
            vehicleModel: ymm.model,
            quotedPriceCents:
              target.amount_cents != null && target.amount_cents > 0
                ? target.amount_cents
                : undefined,
            serviceQuoteTypeId: serviceId || undefined,
            leadId: target.id,
            // Thin book forms and thin quotes both Continue into the first incomplete step.
            continueOpenQuote: true,
            fromBookForm: fromBook,
            intakeStartStep: startStep,
            addressLine1: target.address_line1 || undefined,
            notes: notesParts.join("\n") || undefined,
          })
          return
        }
      }

      // Drop the profile layer immediately so Scheduler UI is not covered by it.
      setSelectedId(null)
      setSelected(null)
      if (target?.id) {
        const href = buildSchedulerFocusUrl(target.id, {
          fromCrm: true,
          customerId,
          // Open schedule picker when booking a submitted / open lead.
          schedule: action === "Book job" || action === "Recover",
        })
        logFlickerNav("push", href, "CrmWorkspaceView")
        router.push(href)
        return
      }
      logFlickerNav("push", "/dashboard/scheduler", "CrmWorkspaceView")
      router.push("/dashboard/scheduler")
    },
    [selected, headerJobTarget, router, inboundCallPanel, vehicles, editName]
  )

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
        toast({
          title: "Could not add vehicle",
          description: json?.migration ? `Run ${json.migration} in Neon` : json?.error || undefined,
          variant: "destructive",
        })
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

  /** Partial PATCH — only send the fields the user just edited. */
  const patchProfile = async (body: Record<string, unknown>) => {
    if (!selectedId || saveBusy) return false
    setSaveBusy(true)
    setSaveMsg(null)
    try {
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
        return false
      }
      if (json) applyProfilePayload(json)
      setLiveRows((prev) =>
        (prev ?? rowsForCompareRef.current).map((r) => {
          if (r.id !== selectedId) return r
          return {
            ...r,
            ...(typeof body.display_name === "string"
              ? { display_name: String(body.display_name).trim() }
              : {}),
          }
        })
      )
      setSaveMsg("Saved")
      return true
    } finally {
      setSaveBusy(false)
    }
  }

  const saveName = async () => {
    const ok = await patchProfile({ display_name: editName })
    if (ok) setEditingName(false)
  }

  /** Open compact appointment editor for one service-history lead/job row. */
  const beginEditAppointment = (item: CrmServiceHistoryItem) => {
    setEditingApptId(item.id)
    // Prefill only a real scheduled_at — never the call/created time.
    setEditApptLocal(isoToDatetimeLocal(item.scheduled_at ?? null))
    setSaveMsg(null)
  }

  const cancelEditAppointment = () => {
    setEditingApptId(null)
    setEditApptLocal("")
  }

  const saveAppointment = async (leadId: string, localValue: string) => {
    const ok = await patchProfile({
      appointment_lead_id: leadId,
      scheduled_at: datetimeLocalToIso(localValue),
    })
    if (ok) cancelEditAppointment()
  }

  const clearAppointment = async (leadId: string) => {
    const ok = await patchProfile({
      appointment_lead_id: leadId,
      scheduled_at: null,
    })
    if (ok) cancelEditAppointment()
  }

  /** Backup when Lines Latest is empty — same Thanks + review endpoint. */
  const sendReviewSms = async (leadId: string) => {
    setReviewBusyId(leadId)
    setSaveMsg(null)
    try {
      const res = await fetch(
        `/api/owner/jobs/${encodeURIComponent(leadId)}/thanks-review`,
        { method: "POST", credentials: "include" }
      )
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(json?.error || "Could not send review SMS")
      setHistory((prev) =>
        prev.map((h) => (h.id === leadId ? { ...h, needs_review_sms: false } : h))
      )
      setSaveMsg("Thanks + review SMS sent")
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Could not send review SMS")
    } finally {
      setReviewBusyId(null)
    }
  }

  /** Open the invoice/receipt popup (Sheet) for a paid charge — same API as Money. */
  const openSendReceipt = (tx: OwnerCollectedTransaction) => {
    setReceiptTx(tx)
    setReceiptName(
      tx.customerName?.trim() ||
        selected?.display_name?.trim() ||
        editName.trim() ||
        ""
    )
    setReceiptPhone(tx.customerPhone || selected?.phone_e164 || "")
    // Prefill email from CRM notes when we stored "Email: …" on the profile.
    setReceiptEmail(emailFromCustomerNotes(selected?.notes))
    // Default to email when we already know their address; otherwise SMS.
    const hasEmail = Boolean(emailFromCustomerNotes(selected?.notes))
    setReceiptChannel(
      hasEmail ? "email" : tx.customerPhone || selected?.phone_e164 ? "sms" : "email"
    )
  }

  /** Open Send invoice for a job paid outside Lyncr (Venmo, cash, etc.). */
  const openRecordInvoice = (job?: CrmServiceHistoryItem | null) => {
    const item = job ?? headerJobTarget
    const garage = vehicles[0]
    const dollars =
      item?.amount_cents != null && item.amount_cents > 0
        ? String(Math.round(item.amount_cents) / 100)
        : "75"
    setRecordInvoiceJobId(item && !isWalkUpHistoryId(item.id) ? item.id : null)
    setRecordAmountDollars(dollars)
    setRecordPayMethod("VENMO")
    setRecordPayNote("Paid via Venmo")
    setRecordVin(
      (garage?.vin || "").trim() ||
        ""
    )
    setReceiptName(editName.trim() || selected?.display_name?.trim() || "")
    setReceiptPhone(selected?.phone_e164 || "")
    setReceiptEmail(emailFromCustomerNotes(selected?.notes))
    const hasEmail = Boolean(emailFromCustomerNotes(selected?.notes))
    setRecordChannel(hasEmail ? (selected?.phone_e164 ? "both" : "email") : "sms")
    setRecordInvoiceOpen(true)
  }

  const saveEditedVehicle = async () => {
    if (!selectedId || !editingVehicleId || editVehicleBusy) return
    setEditVehicleBusy(true)
    try {
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(selectedId)}/vehicles`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: editingVehicleId,
          year: editVehicleForm.year,
          make: editVehicleForm.make,
          model: editVehicleForm.model,
          vin: editVehicleForm.vin,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        migration?: string
        data?: { vehicle?: CustomerVehicle }
      }
      if (!res.ok) {
        toast({
          title: "Could not save vehicle",
          description: json?.migration ? `Run ${json.migration} in Neon` : json?.error || undefined,
          variant: "destructive",
        })
        return
      }
      if (json.data?.vehicle) {
        setVehicles((prev) =>
          prev.map((v) => (v.id === json.data!.vehicle!.id ? json.data!.vehicle! : v))
        )
      }
      setEditingVehicleId(null)
      toast({ title: "Vehicle updated", description: "Year, make, model, and VIN saved." })
    } catch {
      toast({ title: "Could not save vehicle", variant: "destructive" })
    } finally {
      setEditVehicleBusy(false)
    }
  }

  const sendRecordInvoiceFromCrm = async () => {
    if (!selected) return
    const dollars = Number(recordAmountDollars)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast({
        title: "Enter an amount",
        description: "Need a dollar amount for the invoice.",
        variant: "destructive",
      })
      return
    }
    if (
      (recordChannel === "email" || recordChannel === "both") &&
      !receiptEmail.trim().includes("@")
    ) {
      toast({
        title: "Enter an email",
        description: "Need a valid address to email the invoice.",
        variant: "destructive",
      })
      return
    }
    if (
      (recordChannel === "sms" || recordChannel === "both") &&
      receiptPhone.replace(/\D/g, "").length < 10
    ) {
      toast({
        title: "Enter a phone number",
        description: "Need a valid number to text the invoice.",
        variant: "destructive",
      })
      return
    }
    const job =
      (recordInvoiceJobId
        ? history.find((h) => h.id === recordInvoiceJobId) ?? headerJobTarget
        : headerJobTarget) ?? null
    const garage = vehicles[0]
    const vehicleLabel =
      job?.vehicle_label ||
      [garage?.year || job?.vehicle_year, garage?.make || job?.vehicle_make, garage?.model || job?.vehicle_model]
        .filter(Boolean)
        .join(" ") ||
      ""
    setRecordBusy(true)
    try {
      const res = await fetch("/api/payments/send-record-invoice", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selected.id,
          jobId: recordInvoiceJobId,
          amount: dollars,
          paymentMethod: recordPayMethod,
          paymentNote: recordPayNote.trim() || undefined,
          channel: recordChannel,
          customerName: receiptName.trim() || undefined,
          email: receiptEmail.trim() || undefined,
          phone: receiptPhone.trim() || undefined,
          serviceLabel: job ? crmServiceLabel(job) : undefined,
          vehicleLabel: vehicleLabel || undefined,
          vehicleVin: recordVin.trim() || garage?.vin || undefined,
          vehicleYear: garage?.year || job?.vehicle_year || undefined,
          vehicleMake: garage?.make || job?.vehicle_make || undefined,
          vehicleModel: garage?.model || job?.vehicle_model || undefined,
          addressLine1: job?.address_line1 || selected.address_line1 || undefined,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        migration?: string
        data?: {
          receiptUrl?: string
          channels?: string[]
          invoiceId?: string
          invoiceNumber?: string
          deliveryStatus?: string
          emailOk?: boolean
          smsOk?: boolean
          emailError?: string
          smsError?: string
        }
      }
      // Persist always creates a history row — surface failures with Retry in Invoices.
      if (!res.ok) {
        if (json.data?.invoiceId) {
          setInvoiceHighlightId(json.data.invoiceId)
          setInvoicesRefreshKey((k) => k + 1)
          setRecordInvoiceOpen(false)
          toast({
            title: "Invoice saved — send failed",
            description:
              json.error ||
              "Open Invoices below to Retry. Delivery was not marked as sent.",
            variant: "destructive",
          })
          return
        }
        throw new Error(
          json.migration
            ? `Run ${json.migration} in Neon SQL Editor, then try again.`
            : json.error || "Could not send invoice"
        )
      }
      const via = (json.data?.channels ?? []).join(" + ") || recordChannel
      const status = json.data?.deliveryStatus || "sent"
      const bits: string[] = []
      if (json.data?.emailOk) bits.push("Email ✓")
      if (json.data?.smsOk) bits.push("Text ✓")
      if (json.data?.emailError) bits.push("Email ✗")
      if (json.data?.smsError) bits.push("Text ✗")
      toast({
        title:
          status === "partial"
            ? "Invoice partially sent"
            : `Invoice sent (${json.data?.invoiceNumber || "saved"})`,
        description: `${bits.join(" · ") || via}. Find it under Invoices — View · PDF · Resend.`,
      })
      if (json.data?.invoiceId) setInvoiceHighlightId(json.data.invoiceId)
      setInvoicesRefreshKey((k) => k + 1)
      setRecordInvoiceOpen(false)
      if (recordVin.trim() && garage && !garage.vin.trim()) {
        void loadProfile(selected.id)
      }
    } catch (e) {
      toast({
        title: "Could not send invoice",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setRecordBusy(false)
    }
  }

  /** Paid walk-up / completed charges with nothing pending → Collect feels pushy. */
  const isFullyPaidCustomer = useMemo(() => {
    const completed = payments.filter((p) => p.status === "COMPLETED")
    const pending = payments.filter((p) => p.status === "PENDING")
    const hasPaid =
      completed.length > 0 || (selected?.lifetime_revenue_cents ?? 0) > 0
    return hasPaid && pending.length === 0
  }, [payments, selected?.lifetime_revenue_cents])

  /** Past jobs only — hide the lifecycle hero card (already shown above). */
  const displayHistory = useMemo(() => {
    const merged = mergeCrmServiceHistoryWithWalkUps({
      history,
      payments,
      vehicles,
      notes: selected?.notes,
    })
    // Hide whichever job is rendered in the Submitted request / lifecycle hero.
    const heroId =
      headerJobTarget &&
      shouldShowCrmLifecycleCard({
        isOpenLead: headerJobTarget.is_open_lead,
        statusLabel: headerJobTarget.status_label,
        navAction: headerJobAction,
      })
        ? headerJobTarget.id
        : null
    if (!heroId) return merged
    return merged.filter((item) => item.id !== heroId)
  }, [history, payments, vehicles, selected?.notes, headerJobTarget, headerJobAction])

  /** Suggested Message templates for this customer (couldn’t reach + follow-up). */
  const messageExtraTemplates = useMemo(() => {
    if (!selected) return [] as { id: string; label: string; body: string }[]
    const name = customerDisplayName
    const out: { id: string; label: string; body: string }[] = []
    if (headerJobTarget?.is_open_lead) {
      out.push({
        id: "couldnt_reach",
        label: "Couldn’t reach you",
        body: buildUnreachableFollowUpSms({ customerName: name }),
      })
      out.push({
        id: "follow_up",
        label: "Follow-up",
        body: followUpTemplate(name, vehicleForFollowUp),
      })
    }
    return out
  }, [selected, customerDisplayName, headerJobTarget, vehicleForFollowUp])

  /** Email or text a paid receipt — same endpoint as Money → All payments. */
  const sendReceiptFromCrm = async () => {
    if (!receiptTx?.stripePaymentIntentId) return
    if (receiptChannel === "email" && !receiptEmail.trim().includes("@")) {
      toast({
        title: "Enter an email",
        description: "Need a valid address to send the invoice.",
        variant: "destructive",
      })
      return
    }
    if (receiptChannel === "sms" && receiptPhone.replace(/\D/g, "").length < 10) {
      toast({
        title: "Enter a phone number",
        description: "Need a valid number to text the invoice.",
        variant: "destructive",
      })
      return
    }
    setReceiptBusy(true)
    try {
      const res = await fetch("/api/payments/send-receipt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId: receiptTx.stripePaymentIntentId,
          channel: receiptChannel,
          customerName: receiptName.trim() || undefined,
          email: receiptChannel === "email" ? receiptEmail.trim() : undefined,
          phone: receiptChannel === "sms" ? receiptPhone.trim() : undefined,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not send invoice")
      toast({
        title: receiptChannel === "email" ? "Invoice emailed" : "Invoice texted",
        description: "Customer gets a paid invoice with a view link.",
      })
      setReceiptTx(null)
    } catch (e) {
      toast({
        title: "Could not send invoice",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setReceiptBusy(false)
    }
  }

  /** Open Collect on matching open job first; walk-up only when no open job. */
  const openCollectForCustomer = async () => {
    if (!selected) return
    const customerName = editName.trim() || selected.display_name || undefined
    const customerPhone = selected.phone_e164
    try {
      const res = await fetch("/api/owner/jobs?scope=collect", {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { data?: { jobs?: DispatchJob[] } }
      const jobs = Array.isArray(json.data?.jobs) ? json.data!.jobs! : []
      const match = pickOpenCollectJobForPhone(jobs, customerPhone)
      if (match) {
        openCollectPaymentModal({
          customerName,
          customerPhone,
          jobId: match.id,
        })
        return
      }
    } catch {
      /* fall through to walk-up */
    }
    // No open job — walk-up Collect / Charge again with name+phone filled.
    openCollectPaymentModal({
      customerName,
      customerPhone,
      startAdhoc: true,
    })
  }

  const closeProfile = () => setSelectedId(null)
  const profileOpen = selectedId != null
  const listSectionRef = useRef<HTMLElement>(null)
  const profileSectionRef = useRef<HTMLElement>(null)

  // Below lg the profile stacks under the list instead of sitting beside it, so a fresh
  // selection would otherwise land off-screen. Effect (not render) — no hydration risk.
  useEffect(() => {
    if (!isActive || !selectedId) return
    if (typeof window === "undefined") return
    if (!window.matchMedia("(min-width: 768px)").matches) return // phones use the dialog
    if (window.matchMedia("(min-width: 1024px)").matches) return // lg+ is side by side
    profileSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [isActive, selectedId])

  /** Name + pencil in the profile header (desktop panel + mobile dialog). */
  const renderProfileName = (titleClassName: string) => {
    if (!selected) return null
    const fallback = formatPhoneDisplay(selected.phone_e164)
    if (editingName) {
      return (
        <div className="flex min-w-0 items-center gap-2">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Customer name"
            className="h-9 min-w-0 flex-1 border-border bg-background"
            autoComplete="name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName()
              if (e.key === "Escape") {
                setEditName(selected.display_name || "")
                setEditingName(false)
              }
            }}
          />
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void saveName()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-success/40 bg-success/15 text-success hover:bg-success/25 disabled:opacity-50"
            aria-label="Save name"
          >
            {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => {
              setEditName(selected.display_name || "")
              setEditingName(false)
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Cancel name edit"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    }
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 truncate", titleClassName)}>
          {editName.trim() || fallback}
        </span>
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Edit name"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Factory so desktop panel + mobile dialog each get their own element tree.
  const renderProfileBody = () =>
    !selected ? (
      // Quiet empty chrome — a spinner here looked like CRM was still loading after tab click.
      <p className="px-2 py-16 text-center text-sm text-muted-foreground">
        Select a customer to see their profile.
      </p>
    ) : (
      <div className="space-y-6">
        {/* One loud next step by situation; Call / Message / more stay quieter. */}
        {(() => {
          const hasJobPrimary =
            headerJobAction === "Book job" ||
            headerJobAction === "Recover" ||
            headerJobAction === "Open job" ||
            headerJobAction === "View job"
          const collectPrimary = !hasJobPrimary && !isFullyPaidCustomer
          const quietBtn =
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-background/50 px-3 text-xs font-semibold text-muted-foreground hover:border-border hover:bg-card/80 hover:text-foreground"
          return (
            <div className="space-y-2">
              {collectPrimary ? (
                <button
                  type="button"
                  onClick={() => void openCollectForCustomer()}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-teal-500/50 bg-teal-500/20 px-3 text-sm font-semibold text-teal-50 hover:bg-teal-500/30"
                  title="Collect payment"
                  aria-label="Collect payment"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  Collect
                </button>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={buildTelHref(selected.phone_e164) || undefined}
                  className={quietBtn}
                >
                  <Phone className="h-3.5 w-3.5" />
                  Call
                </a>
                <button
                  type="button"
                  onClick={() => setMessageTemplatesOpen(true)}
                  className={quietBtn}
                  title="Pick a text template to send"
                  aria-label="Pick a text template to send"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Message
                </button>
                {!collectPrimary ? (
                  <button
                    type="button"
                    onClick={() => void openCollectForCustomer()}
                    className={quietBtn}
                    title="Collect payment"
                    aria-label="Collect payment"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    {isFullyPaidCustomer ? "Charge again" : "Collect"}
                  </button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={quietBtn}
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      More
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="z-[7200] min-w-[11rem] border-border bg-background">
                    <DropdownMenuItem
                      onClick={() => void openCollectForCustomer()}
                      className="gap-2 text-xs focus:bg-card"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      {isFullyPaidCustomer ? "Charge again" : "Collect"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openRecordInvoice(headerJobTarget)}
                      className="gap-2 text-xs focus:bg-card"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Send invoice
                    </DropdownMenuItem>
                    {salvageOpenLead ? (
                      <DropdownMenuItem
                        onClick={openRescuePreview}
                        className="gap-2 text-xs focus:bg-card"
                      >
                        Draft rescue offer
                      </DropdownMenuItem>
                    ) : null}
                    {headerJobAction &&
                    headerJobTarget &&
                    !(headerJobTarget.is_open_lead && headerJobAction === "Book job") ? (
                      <DropdownMenuItem
                        onClick={() => openJobOnScheduler(headerJobTarget)}
                        className="gap-2 text-xs focus:bg-card"
                      >
                        <CalendarCheck className="h-3.5 w-3.5" />
                        {crmJobNavButtonLabel(headerJobAction, { poolReady: headerPoolReady })}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem asChild className="gap-2 text-xs focus:bg-card">
                      <Link href={messagesHref}>
                        <MessageSquare className="h-3.5 w-3.5" />
                        Open Messages thread
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {hasJobPrimary ? (
                <p className="px-0.5 text-2xs text-muted-foreground">
                  Next job step is in the card below
                  {headerJobAction ? ` (${crmJobNavButtonLabel(headerJobAction, { poolReady: headerPoolReady })})` : ""}.
                </p>
              ) : null}
            </div>
          )
        })()}

        {saveMsg && saveMsg !== "Saved" ? (
          <p className="text-xs text-rose-300">{saveMsg}</p>
        ) : null}

        {profileLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profile…
          </div>
        ) : null}

        {/* Job / book-form details — stays through Booked → Cancelled / Complete. */}
        {headerJobTarget &&
        shouldShowCrmLifecycleCard({
          isOpenLead: headerJobTarget.is_open_lead,
          statusLabel: headerJobTarget.status_label,
          navAction: headerJobAction,
        }) ? (
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-200/90">
                {headerJobTarget.is_open_lead || isCrmPreBookStatusLabel(headerJobTarget.status_label)
                  ? "Submitted request"
                  : "Job status"}
              </h3>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-micro font-semibold",
                  headerJobTarget.filled_by_customer
                    ? "bg-orange-500/20 text-orange-100"
                    : "bg-muted text-foreground"
                )}
              >
                {crmIntakeFilledByLabel(headerJobTarget.intake_source)}
              </span>
              {crmUrgencyLabel(headerJobTarget) === "ASAP" ? (
                <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-micro font-semibold text-rose-100">
                  ASAP
                </span>
              ) : null}
              {/* Current lifecycle badge — Needs call → Booked · time → Cancelled / Complete. */}
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-micro font-semibold",
                  headerJobTarget.status_tone === "amber" && "bg-warning/15 text-warning",
                  headerJobTarget.status_tone === "rose" && "bg-rose-500/15 text-rose-300",
                  headerJobTarget.status_tone === "sky" && "bg-sky-500/15 text-sky-200",
                  headerJobTarget.status_tone === "emerald" && "bg-success/15 text-success",
                  headerJobTarget.status_tone === "neutral" && "bg-muted text-muted-foreground"
                )}
              >
                {isCrmBookedStatusLabel(headerJobTarget.status_label) &&
                headerJobTarget.scheduled_at &&
                headerJobTarget.status_label === "Booked"
                  ? formatCrmBookedStatusLabel(headerJobTarget.scheduled_at)
                  : headerJobTarget.status_label}
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Service</dt>
                <dd className="min-w-0 font-medium text-foreground">
                  {crmServiceLabel(headerJobTarget)}
                </dd>
              </div>
              {headerJobTarget.vehicle_label ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Vehicle</dt>
                  <dd className="min-w-0 text-foreground">{headerJobTarget.vehicle_label}</dd>
                </div>
              ) : null}
              {vehicles[0]?.vin ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">VIN</dt>
                  <dd className="min-w-0 font-mono text-xs text-foreground">{vehicles[0].vin}</dd>
                </div>
              ) : null}
              {headerJobTarget.address_line1 ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Address</dt>
                  <dd className="min-w-0 text-foreground">{headerJobTarget.address_line1}</dd>
                </div>
              ) : null}
              {crmUrgencyLabel(headerJobTarget) && crmUrgencyLabel(headerJobTarget) !== "ASAP" ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">When</dt>
                  <dd className="min-w-0 text-foreground">{crmUrgencyLabel(headerJobTarget)}</dd>
                </div>
              ) : null}
              {headerJobTarget.amount_cents != null && headerJobTarget.amount_cents > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Quote</dt>
                  <dd className="min-w-0 tabular-nums text-success">
                    {formatMoney(headerJobTarget.amount_cents)}
                  </dd>
                </div>
              ) : null}
              {(headerJobTarget.customer_notes || headerJobTarget.job_notes) && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Notes</dt>
                  <dd className="min-w-0 whitespace-pre-wrap text-foreground">
                    {headerJobTarget.customer_notes || headerJobTarget.job_notes}
                  </dd>
                </div>
              )}
              {headerJobTarget.at ? (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-2xs font-medium text-muted-foreground">Submitted</dt>
                  <dd className="min-w-0 text-2xs text-muted-foreground">
                    {new Date(headerJobTarget.at).toLocaleString()}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 space-y-2">
              {/* Book job only while still an open lead / salvage — not after Booked. */}
              {headerJobAction === "Book job" || headerJobAction === "Recover" ? (
                <button
                  type="button"
                  onClick={() => openJobOnScheduler(headerJobTarget)}
                  className={cn(
                    "inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold",
                    headerJobAction === "Recover"
                      ? "border border-rose-500/45 bg-rose-500/20 text-rose-100"
                      : "border border-success/50 bg-success/20 text-success"
                  )}
                  title={crmJobNavTitle(headerJobAction)}
                >
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {crmJobNavButtonLabel(headerJobAction, { poolReady: headerPoolReady })}
                </button>
              ) : null}
              {/* After booking: open / view the scheduled job on Scheduler. */}
              {headerJobAction === "Open job" || headerJobAction === "View job" ? (
                <button
                  type="button"
                  onClick={() => openJobOnScheduler(headerJobTarget)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 text-xs font-semibold text-sky-100"
                  title={crmJobNavTitle(headerJobAction)}
                >
                  <CalendarCheck className="h-3.5 w-3.5" />
                  {crmJobNavButtonLabel(headerJobAction)}
                </button>
              ) : null}
              {/* Reimbursement invoice — works for Venmo / cash paid outside Lyncr. */}
              {(headerJobAction === "View job" ||
                headerJobAction === "Open job" ||
                isCrmTerminalStatusLabel(headerJobTarget.status_label)) && (
                <button
                  type="button"
                  onClick={() => openRecordInvoice(headerJobTarget)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 text-xs font-semibold text-success"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Send invoice
                </button>
              )}
              {/* Compact status chips — texts live under Message; this row is lifecycle only. */}
              <div className="flex flex-wrap gap-2">
                {/* Call outcomes only before Booked / Cancelled / Complete. */}
                {isCrmPreBookStatusLabel(headerJobTarget.status_label) ||
                headerJobTarget.is_open_lead ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        unreachableBusy ||
                        headerJobTarget.status_label === "Called · no answer"
                      }
                      onClick={() =>
                        void markCallbackOutcome(headerJobTarget, "called_no_answer")
                      }
                      className={cn(
                        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-2xs font-semibold disabled:opacity-50",
                        headerJobTarget.status_label === "Called · no answer"
                          ? "border-warning/40 bg-warning/20 text-warning"
                          : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
                      )}
                    >
                      {unreachableBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "No answer"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={
                        unreachableBusy ||
                        headerJobTarget.status_label === "Called · answered"
                      }
                      onClick={() =>
                        void markCallbackOutcome(headerJobTarget, "called_answered")
                      }
                      className={cn(
                        "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-2xs font-semibold disabled:opacity-50",
                        headerJobTarget.status_label === "Called · answered"
                          ? "border-sky-500/40 bg-sky-500/20 text-sky-100"
                          : "border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                      )}
                    >
                      {unreachableBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Answered"
                      )}
                    </button>
                  </>
                ) : null}
                {/* Cancelled — customer cancelled before or after booking. */}
                <button
                  type="button"
                  disabled={unreachableBusy || headerJobTarget.status_label === "Cancelled"}
                  onClick={() => void markJobLifecycleStatus(headerJobTarget, "cancelled")}
                  className={cn(
                    "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-2xs font-semibold disabled:opacity-50",
                    headerJobTarget.status_label === "Cancelled"
                      ? "border-border/50 bg-accent/40 text-foreground"
                      : "border-border bg-card/60 text-foreground hover:bg-muted"
                  )}
                >
                  {unreachableBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Cancelled"
                  )}
                </button>
                {/* Complete — job finished. */}
                <button
                  type="button"
                  disabled={
                    unreachableBusy ||
                    headerJobTarget.status_label === "Complete" ||
                    headerJobTarget.status_label === "Done" ||
                    headerJobTarget.status_label === "Completed"
                  }
                  onClick={() => void markJobLifecycleStatus(headerJobTarget, "completed")}
                  className={cn(
                    "inline-flex h-8 items-center justify-center rounded-lg border px-3 text-2xs font-semibold disabled:opacity-50",
                    headerJobTarget.status_label === "Complete" ||
                      headerJobTarget.status_label === "Done" ||
                      headerJobTarget.status_label === "Completed"
                      ? "border-success/40 bg-success/20 text-success"
                      : "border-success/40 bg-success/10 text-success hover:bg-success/20"
                  )}
                >
                  {unreachableBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Complete"
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Only show vehicle block when there is at least one saved vehicle (or the add form is open). */}
        {vehicles.length > 0 || addingVehicle ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Vehicle information
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
              <div className="mb-3 grid gap-2 rounded-xl border border-border bg-card/50 p-3 sm:grid-cols-2">
                {(
                  [
                    ["year", "Year"],
                    ["make", "Make"],
                    ["model", "Model"],
                    ["vin", "VIN"],
                    ["fcc_id", "FCC ID"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-2xs text-muted-foreground">
                    {label}
                    <Input
                      value={vehicleForm[key]}
                      onChange={(e) =>
                        setVehicleForm((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="mt-1 h-9 border-border bg-background"
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
            {vehicles.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {vehicles.map((v) => (
                  <li
                    key={v.id}
                    className="rounded-xl border border-border bg-card/40 px-3 py-3"
                  >
                    {editingVehicleId === v.id ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            ["year", "Year"],
                            ["make", "Make"],
                            ["model", "Model"],
                            ["vin", "VIN"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="block text-2xs text-muted-foreground">
                            {label}
                            <Input
                              value={editVehicleForm[key]}
                              onChange={(e) =>
                                setEditVehicleForm((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              className="mt-1 h-9 border-border bg-background"
                            />
                          </label>
                        ))}
                        <div className="flex gap-2 sm:col-span-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={editVehicleBusy}
                            onClick={() => void saveEditedVehicle()}
                          >
                            {editVehicleBusy ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingVehicleId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <Car className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                          </p>
                          {v.vin ? (
                            <p className="truncate text-2xs text-muted-foreground">VIN {v.vin}</p>
                          ) : (
                            <p className="text-2xs text-warning/80">No VIN yet</p>
                          )}
                          {v.fcc_id ? (
                            <p className="truncate text-2xs text-muted-foreground">FCC {v.fcc_id}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVehicleId(v.id)
                            setEditVehicleForm({
                              year: v.year,
                              make: v.make,
                              model: v.model,
                              vin: v.vin,
                            })
                          }}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Edit vehicle"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* Paid-outside invoices (Venmo/cash) — always available for history / resend. */}
        {selected ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoices
              </h3>
              <button
                type="button"
                onClick={() => openRecordInvoice(headerJobTarget)}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-2xs font-semibold text-teal-300/90 hover:bg-teal-500/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Send paid invoice
              </button>
            </div>
            <RecordInvoicesPanel
              key={`inv-${selected.id}-${invoicesRefreshKey}`}
              customerId={selected.id}
              highlightId={invoiceHighlightId}
              showSearch={false}
              compact
            />
          </div>
        ) : null}

        {/* Hide Payments entirely when this phone has no linked charges yet. */}
        {payments.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payments
              </h3>
              <button
                type="button"
                onClick={() => void openCollectForCustomer()}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-2xs font-semibold text-teal-300/90 hover:bg-teal-500/10"
              >
                <Plus className="h-3.5 w-3.5" />
                {isFullyPaidCustomer ? "Charge again" : "New charge"}
              </button>
            </div>
            <ul className="space-y-2">
              {payments.map((tx) => {
                const amountCents = Math.round(tx.amount * 100)
                const canInvoice =
                  tx.status === "COMPLETED" && Boolean(tx.stripePaymentIntentId)
                return (
                  <li
                    key={tx.id}
                    className="rounded-xl border border-border bg-card/40 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tabular-nums text-success">
                          {formatCollectedDollars(amountCents)}
                        </p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          {formatPaymentWhen(tx.createdAt)}
                          {" · "}
                          {paymentMethodLabel(tx.paymentMethod)}
                          {!tx.jobId ? " · Walk-up" : tx.jobLabel ? ` · ${tx.jobLabel}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-2 py-0.5 text-micro font-semibold",
                          tx.status === "COMPLETED" && "bg-success/15 text-success",
                          tx.status === "FAILED" && "bg-rose-500/15 text-rose-300",
                          tx.status === "PENDING" && "bg-warning/15 text-warning"
                        )}
                      >
                        {paymentStatusLabel(tx.status)}
                      </span>
                    </div>
                    {canInvoice ? (
                      <button
                        type="button"
                        onClick={() => openSendReceipt(tx)}
                        className="mt-2 inline-flex h-8 items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3 text-2xs font-semibold text-success hover:bg-success/20"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Send invoice / receipt
                      </button>
                    ) : tx.paymentMethod === "CASH" && tx.status === "COMPLETED" ? (
                      <p className="mt-1.5 text-micro text-muted-foreground">
                        Cash — no digital card receipt link.
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {/* Invoice form lives in a Sheet popup below — keeps the profile short. */}
          </div>
        ) : null}

        {/* Past jobs only — open submitted request stays in the orange hero card above. */}
        {displayHistory.length > 0 ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Past jobs
            </h3>
            <ol className="space-y-2">
              {displayHistory.map((item) => {
                const serviceLabel = crmServiceLabel(item)
                const urgencyBit = crmUrgencyLabel(item)
                const sourceBit =
                  item.intake_source || item.filled_by_customer != null
                    ? crmIntakeFilledByLabel(item.intake_source)
                    : null
                const detailBits = [
                  serviceLabel,
                  item.vehicle_label,
                  item.address_line1,
                  urgencyBit,
                  item.amount_cents != null && item.amount_cents > 0
                    ? formatMoney(item.amount_cents)
                    : null,
                  sourceBit,
                ].filter(Boolean)
                return (
                <li
                  key={item.id}
                  className="rounded-xl border border-border bg-card/40 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {serviceLabel}
                        {item.vehicle_label ? (
                          <span className="font-normal text-muted-foreground">
                            {" · "}
                            {item.vehicle_label}
                          </span>
                        ) : null}
                      </p>
                      {/* Flattened book-form / quote metadata — not just “Lockout · Needs call · $49”. */}
                      <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">
                        {detailBits.slice(item.vehicle_label ? 2 : 1).join(" · ") ||
                          (item.summary?.trim() && item.summary.trim() !== serviceLabel
                            ? item.summary.trim()
                            : null)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-micro font-semibold",
                        item.status_tone === "emerald" && "bg-success/15 text-success",
                        item.status_tone === "amber" && "bg-warning/15 text-warning",
                        item.status_tone === "rose" && "bg-rose-500/15 text-rose-300",
                        item.status_tone === "sky" && "bg-sky-500/15 text-sky-200",
                        item.status_tone === "neutral" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {item.status_label}
                    </span>
                  </div>
                  {(item.customer_notes || item.job_notes) && item.is_open_lead ? (
                    <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                      {item.customer_notes || item.job_notes}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                    {/* Call / lead timestamp — not the future appointment */}
                    <span className="min-w-0 truncate">
                      {item.at ? new Date(item.at).toLocaleString() : ""}
                      {item.assigned_tech_name ? ` · ${item.assigned_tech_name}` : ""}
                    </span>
                    {/* Compact future-appointment control (distinct from call time) */}
                    {!isWalkUpHistoryId(item.id) && editingApptId === item.id ? (
                      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
                        <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                          Appt
                        </span>
                        <Input
                          type="datetime-local"
                          value={editApptLocal}
                          onChange={(e) => setEditApptLocal(e.target.value)}
                          className="h-7 w-[11.5rem] border-border bg-background px-2 text-2xs"
                          aria-label="Appointment date and time"
                        />
                        <button
                          type="button"
                          disabled={saveBusy || !editApptLocal.trim()}
                          onClick={() => void saveAppointment(item.id, editApptLocal)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-success hover:bg-muted disabled:opacity-40"
                          aria-label="Save appointment"
                          title="Save appointment"
                        >
                          {saveBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={saveBusy}
                          onClick={cancelEditAppointment}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Cancel"
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {item.scheduled_at ? (
                          <button
                            type="button"
                            disabled={saveBusy}
                            onClick={() => void clearAppointment(item.id)}
                            className="h-6 rounded px-1 text-micro text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Clear appointment"
                          >
                            Clear
                          </button>
                        ) : null}
                      </span>
                    ) : !isWalkUpHistoryId(item.id) ? (
                      <button
                        type="button"
                        onClick={() => beginEditAppointment(item)}
                        className="inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded px-0.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        title={
                          item.scheduled_at
                            ? "Edit scheduled appointment"
                            : "Set scheduled appointment"
                        }
                        aria-label={
                          item.scheduled_at
                            ? "Edit scheduled appointment"
                            : "Set scheduled appointment"
                        }
                      >
                        <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                          Appt
                        </span>
                        {item.scheduled_at ? (
                          <span className="truncate text-micro text-sky-300/90">
                            {new Date(item.scheduled_at).toLocaleString(undefined, {
                              month: "numeric",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : null}
                        <Pencil className="h-3 w-3 shrink-0 opacity-70" />
                      </button>
                    ) : null}
                    {/* Book / Recover / Open / View — never "Convert" on completed rows */}
                    {(() => {
                      const action = crmJobNavAction(item)
                      if (!action) return null
                      // History rows keep short labels; Recover tooltip clarifies it’s not SMS.
                      const rowLabel =
                        action === "Recover"
                          ? "Recover"
                          : action === "Open job"
                            ? "Open job"
                            : action === "View job"
                              ? "View job"
                              : "Book job"
                      return (
                        <button
                          type="button"
                          onClick={() => openJobOnScheduler(item)}
                          className={cn(
                            "inline-flex h-5 items-center gap-1 rounded px-0.5 text-micro font-semibold hover:bg-muted",
                            action === "Recover"
                              ? "text-rose-300/95 hover:text-rose-200"
                              : "text-success/90 hover:text-success"
                          )}
                          title={crmJobNavTitle(action)}
                        >
                          <CalendarCheck className="h-3 w-3" />
                          {rowLabel}
                        </button>
                      )
                    })()}
                    {item.needs_review_sms ? (
                      <button
                        type="button"
                        disabled={reviewBusyId === item.id}
                        onClick={() => void sendReviewSms(item.id)}
                        className="inline-flex h-5 items-center gap-1 rounded px-0.5 text-micro font-semibold text-warning/95 hover:bg-muted hover:text-warning disabled:opacity-50"
                        title="Send thanks + Google review SMS"
                      >
                        {reviewBusyId === item.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Star className="h-3 w-3" />
                        )}
                        Send review
                      </button>
                    ) : null}
                  </div>
                </li>
                )
              })}
            </ol>
          </div>
        ) : null}
      </div>
    )

  const renderProfileMeta = () =>
    selected ? (
      <>
        <span className="tabular-nums">{formatPhoneDisplay(selected.phone_e164)}</span>
        {" · "}
        {headerJobTarget?.is_open_lead
          ? headerJobTarget.status_label
          : BADGE_LABEL[selected.lead_badge]}
        {selected.jobs_completed > 0 ? (
          <>
            {" · "}
            {selected.jobs_completed} job
            {selected.jobs_completed === 1 ? "" : "s"}
          </>
        ) : null}
      </>
    ) : null

  // Messages CRM chip with no saved row — don’t say the whole shop is empty.
  const searchingPhone = looksLikePhoneQuery(debounced || q)
  /** Empty because a text search filtered everything out, not because the tab is empty. */
  const nameSearchEmpty = Boolean((debounced || q).trim()) && !searchingPhone

  // Lines pattern: list paints from cookie/session; inline skeleton only when empty+loading.
  // pb clears the fixed mobile dock so the last list cards stay reachable while main scrolls.
  return (
    <div className="mx-auto flex w-full max-w-workspace flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 sm:px-4 md:pb-8">
      <header className="flex flex-col gap-1">
        <p className="hidden text-micro font-semibold uppercase tracking-wider text-muted-foreground md:block">
          CRM
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
          Customers &amp; Leads
        </h1>
        <p className="hidden text-sm text-muted-foreground md:block">
          People, vehicles, history, and follow-ups — including book-form submissions (stay here after
          you clear Lines alerts). Use Book forms to find customer-filled requests that still need a call.
        </p>
      </header>

      {/* One column until a customer is picked — the reserved profile pane was ~51% of a
          1280px screen sitting empty. From lg up a selection splits it side by side;
          at tablet the profile stacks under the list instead (768px cannot afford
          a 223px master column). */}
      <div
        className={cn(
          "flex flex-col gap-3",
          selectedId &&
            "lg:grid lg:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] lg:items-start lg:gap-4"
        )}
      >
        {/* List — always visible (dimmed behind the mobile dialog) */}
        <section
          ref={listSectionRef}
          className="flex flex-col rounded-2xl border border-border/90 bg-background md:min-h-0 md:max-h-[calc(100dvh-10rem)]"
        >
          <div className="shrink-0 space-y-2 border-b border-border/80 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or phone…"
                className="h-10 border-border bg-card/80 pl-9"
                aria-label="Search customers"
              />
            </div>
            <WorkspaceFilterPills
              layoutId="lyncr-crm-filter-pill"
              aria-label="CRM filters"
              size="sm"
              value={filter}
              onChange={(id) => setFilter(id as CrmFilter)}
              items={[
                { id: "all", label: "All", tone: "sky" },
                { id: "leads", label: "Leads", tone: "sky" },
                { id: "book_forms", label: "Book forms", tone: "orange" },
                { id: "clients", label: "Clients", tone: "sky" },
              ]}
            />
          </div>

          <div className="min-h-[18rem] p-2 lyncr-content-swap md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
            {rows.length === 0 && !listSettled ? (
              // Quiet well — never show “No customers yet” before first fetch settles.
              <div className="min-h-[18rem]" aria-busy="true" aria-label="Loading customers" />
            ) : error ? (
              <p className="px-2 py-6 text-center text-sm text-rose-300">{error}</p>
            ) : rows.length === 0 ? (
              <div className="flex min-h-[18rem] flex-col items-center gap-3 px-3 py-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  {/* A name search that matches nothing is not the same as having nothing —
                      saying "none exist" here reads as data loss on a filtered list. */}
                  {nameSearchEmpty
                    ? `No matches for “${(debounced || q).trim()}”`
                    : filter === "book_forms"
                      ? "No open book-form leads"
                      : searchingPhone
                        ? "This number isn’t saved yet"
                        : "No customers yet"}
                </p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {nameSearchEmpty
                    ? filter === "all"
                      ? "Nobody here matches that search."
                      : "Nobody in this tab matches that search — clear it, or try another tab."
                    : filter === "book_forms"
                      ? "When a customer submits your /book link, they show up here."
                      : searchingPhone
                        ? "They show up here after a book form, intake, or Activity save."
                        : "Save a caller from Activity or intake — they’ll show up here."}
                </p>
                {nameSearchEmpty ? (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
                  >
                    Clear search
                  </button>
                ) : (
                  <Link
                    href={
                      searchingPhone && (debounced || q).trim()
                        ? `/dashboard/messages?phone=${encodeURIComponent((debounced || q).trim())}`
                        : "/dashboard/activity"
                    }
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
                  >
                    Open Activity
                  </Link>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => {
                  const active = row.id === selectedId
                  const name = row.display_name.trim() || formatPhoneDisplay(row.phone_e164)
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          // Paint list-row LTV/jobs immediately — profile fetch must not zero them.
                          setSelected(row)
                          setSelectedId(row.id)
                          setEditName(row.display_name || "")
                        }}
                        className={cn(
                          "w-full rounded-xl border px-3 py-3 text-left",
                          active
                            ? "border-sky-500/40 bg-sky-500/10"
                            : "border-border/80 bg-card/40 hover:border-border"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                          <span className="shrink-0 rounded-md bg-background/80 px-2 py-0.5 text-micro font-medium text-muted-foreground">
                            {BADGE_LABEL[row.lead_badge]}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                          {formatPhoneDisplay(row.phone_e164)}
                        </p>
                        <p className="mt-1 break-words text-2xs leading-snug text-muted-foreground">
                          {(() => {
                            // Prefer latest open job status over booking source (“From book link”).
                            const status = String(row.job_status_label ?? "").trim()
                            const meta = formatCrmListRowMeta({
                              statusLabel: status || null,
                              openLeadCount: row.open_lead_count,
                              jobsCompleted: row.jobs_completed,
                            })
                            // When we have a status, color just that prefix; keep counts muted.
                            if (status && meta.startsWith(status)) {
                              const rest = meta.slice(status.length)
                              return (
                                <>
                                  <span className={crmListStatusToneClass(row.job_status_tone)}>
                                    {status}
                                  </span>
                                  {rest ? <span>{rest}</span> : null}
                                </>
                              )
                            }
                            return meta
                          })()}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Tablet + desktop profile pane. Phones use the dialog below, so this stays
            hidden there; with nothing selected it is not rendered at all. */}
        <section
          ref={profileSectionRef}
          className={cn(
            "rounded-2xl border border-border/90 bg-background p-3 sm:p-4",
            "hidden md:block lg:sticky lg:top-3 lg:min-h-[20rem] lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto",
            !selectedId && "md:hidden"
          )}
        >
          {!selectedId ? null : (
            <>
              {selected ? (
                <div className="mb-4 border-b border-border pb-3">
                  {renderProfileName("text-lg font-semibold text-foreground")}
                  <p className="mt-0.5 text-sm text-muted-foreground">{renderProfileMeta()}</p>
                </div>
              ) : null}
              {renderProfileBody()}
            </>
          )}
        </section>
      </div>

      {/* Mobile: compact centered floating dialog (list stays dimmed behind).
          Gate on isActive — CRM pane stays mounted when switching tabs; without this,
          Book/Open job can leave the Dialog open over the Scheduler job drawer. */}
      <Dialog
        open={isActive && isMobile && profileOpen}
        onOpenChange={(open) => {
          if (!open) closeProfile()
        }}
      >
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden border-border bg-background p-0 shadow-overlay",
            "max-h-[min(85dvh,36rem)] w-[calc(100%-2rem)] max-w-md",
            "[&>button]:top-3 [&>button]:right-3 [&>button]:text-muted-foreground"
          )}
        >
          {selected ? (
            <>
              <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-12 text-left">
                <DialogTitle asChild>
                  <div className="text-lg font-semibold text-foreground">
                    {renderProfileName("text-lg font-semibold text-foreground")}
                  </div>
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {renderProfileMeta()}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[min(72dvh,30rem)] overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {renderProfileBody()}
              </div>
            </>
          ) : (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">
              Select a customer to see their profile.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Message → template picker (custom snippets + presets + couldn’t reach). */}
      <Dialog open={messageTemplatesOpen} onOpenChange={setMessageTemplatesOpen}>
        <DialogContent
          showCloseButton
          overlayClassName="z-[7100]"
          className="z-[7110] max-h-[min(90dvh,36rem)] overflow-y-auto border-border bg-background sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Message templates</DialogTitle>
            <DialogDescription>
              Tap a saved or suggested text to send. Your custom SMS templates from Settings show
              here too.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <CustomerSmsComposer
              toPhone={selected.phone_e164}
              customerName={customerDisplayName}
              title="Text customer"
              variant={headerJobTarget?.is_open_lead ? "missed" : "follow_up"}
              showRunningLate={!headerJobTarget?.is_open_lead}
              showBookingLink={Boolean(headerJobTarget?.is_open_lead)}
              extraTemplates={messageExtraTemplates}
              onSent={() => {
                setMessageTemplatesOpen(false)
                setSaveMsg("SMS sent")
              }}
              onClose={() => setMessageTemplatesOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* SMS preview — above mobile CRM profile (z-7100+) so Send means send after edit. */}
      <Dialog
        open={smsPreviewOpen}
        onOpenChange={(open) => {
          if (!open && !smsPreviewSending) setSmsPreviewOpen(false)
        }}
      >
        <DialogContent
          showCloseButton={!smsPreviewSending}
          overlayClassName="z-[7100]"
          className="z-[7110] border-border bg-background sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Here’s the text we’re about to send</DialogTitle>
            <DialogDescription>
              {smsPreviewKind === "rescue"
                ? "Rescue offer — edit if needed, then Send or open Messages."
                : "Follow-up — edit if needed, then Send or open Messages."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={smsPreviewDraft}
            onChange={(e) => setSmsPreviewDraft(e.target.value)}
            rows={5}
            disabled={smsPreviewSending}
            className="min-h-[7.5rem] border-border bg-card text-sm text-foreground"
            aria-label="SMS message draft"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={smsPreviewSending}
              onClick={() => setSmsPreviewOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={smsPreviewSending || !smsPreviewDraft.trim()}
              onClick={editSmsInMessages}
            >
              Edit in Messages
            </Button>
            <Button
              type="button"
              disabled={smsPreviewSending || !smsPreviewDraft.trim()}
              onClick={() => void sendSmsPreview()}
              className="bg-success text-white hover:bg-success"
            >
              {smsPreviewSending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send invoice / receipt — popup Sheet (not an inline accordion that forces scroll). */}
      <Sheet
        open={receiptTx != null}
        onOpenChange={(open) => {
          if (!open && !receiptBusy) setReceiptTx(null)
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Above mobile CRM profile dialog so the form is always reachable.
          overlayClassName="z-[7200]"
          className="z-[7210] flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl border-border bg-[#101018] p-0 sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-bold text-foreground">
                  Send invoice / receipt
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
                  Already paid — this emails or texts a receipt, not a new bill.
                </SheetDescription>
              </div>
              <button
                type="button"
                onClick={() => setReceiptTx(null)}
                disabled={receiptBusy}
                className="rounded-lg p-2 text-muted-foreground hover:text-white disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </SheetHeader>

          {receiptTx ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
              <p className="text-2xl font-bold tabular-nums text-teal-50">
                {formatCollectedDollars(Math.round(receiptTx.amount * 100))}
              </p>

              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background/60 p-1">
                <button
                  type="button"
                  onClick={() => setReceiptChannel("email")}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold",
                    receiptChannel === "email"
                      ? "bg-teal-500/20 text-teal-100"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptChannel("sms")}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold",
                    receiptChannel === "sms"
                      ? "bg-teal-500/20 text-teal-100"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Text
                </button>
              </div>

              <label className="block space-y-1">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Customer name
                </span>
                <Input
                  value={receiptName}
                  onChange={(e) => setReceiptName(e.target.value)}
                  placeholder="Optional"
                  className="h-10 border-border bg-background"
                />
              </label>

              {receiptChannel === "email" ? (
                <label className="block space-y-1">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Email
                  </span>
                  <Input
                    type="email"
                    value={receiptEmail}
                    onChange={(e) => setReceiptEmail(e.target.value)}
                    placeholder="customer@email.com"
                    className="h-10 border-border bg-background"
                    autoComplete="email"
                  />
                </label>
              ) : (
                <label className="block space-y-1">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Phone
                  </span>
                  <Input
                    type="tel"
                    value={receiptPhone}
                    onChange={(e) => setReceiptPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-10 border-border bg-background"
                    autoComplete="tel"
                  />
                </label>
              )}

              <Button
                type="button"
                disabled={receiptBusy}
                onClick={() => void sendReceiptFromCrm()}
                className="h-11 w-full gap-2 bg-success text-white hover:bg-success"
              >
                {receiptBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : receiptChannel === "email" ? (
                  <Mail className="h-4 w-4" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                {receiptChannel === "email" ? "Email invoice" : "Text invoice"}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Record invoice — Venmo / cash / paid outside Lyncr (no Stripe charge). */}
      <Sheet
        open={recordInvoiceOpen}
        onOpenChange={(open) => {
          if (!open && !recordBusy) setRecordInvoiceOpen(false)
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          overlayClassName="z-[7200]"
          className="z-[7210] flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl border-border bg-[#101018] p-0 sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-bold text-foreground">
                  Send paid invoice
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
                  Already paid (Venmo, cash, etc.) — emails or texts a paid invoice.
                  No card charge.
                </SheetDescription>
              </div>
              <button
                type="button"
                onClick={() => setRecordInvoiceOpen(false)}
                disabled={recordBusy}
                className="rounded-lg p-2 text-muted-foreground hover:text-white disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <label className="block space-y-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amount ($)
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={recordAmountDollars}
                onChange={(e) => setRecordAmountDollars(e.target.value)}
                className="h-10 border-border bg-background"
              />
            </label>

            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background/60 p-1 sm:grid-cols-4">
              {(
                [
                  ["VENMO", "Venmo"],
                  ["CASH", "Cash"],
                  ["EXTERNAL", "Outside"],
                  ["OTHER", "Other"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setRecordPayMethod(id)
                    if (id === "VENMO") setRecordPayNote("Paid via Venmo")
                    else if (id === "CASH") setRecordPayNote("Paid in cash")
                    else if (id === "EXTERNAL") setRecordPayNote("Paid outside the app")
                    else setRecordPayNote("Paid outside the app")
                  }}
                  className={cn(
                    "rounded-lg py-2 text-2xs font-semibold",
                    recordPayMethod === id
                      ? "bg-teal-500/20 text-teal-100"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="block space-y-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Paid note
              </span>
              <Input
                value={recordPayNote}
                onChange={(e) => setRecordPayNote(e.target.value)}
                placeholder="Paid via Venmo"
                className="h-10 border-border bg-background"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                VIN
              </span>
              <Input
                value={recordVin}
                onChange={(e) => setRecordVin(e.target.value)}
                placeholder="17-character VIN"
                className="h-10 border-border bg-background font-mono text-sm"
              />
            </label>

            <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/60 p-1">
              {(
                [
                  ["email", "Email"],
                  ["sms", "Text"],
                  ["both", "Both"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRecordChannel(id)}
                  className={cn(
                    "rounded-lg py-2 text-xs font-semibold",
                    recordChannel === id
                      ? "bg-teal-500/20 text-teal-100"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="block space-y-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Customer name
              </span>
              <Input
                value={receiptName}
                onChange={(e) => setReceiptName(e.target.value)}
                className="h-10 border-border bg-background"
              />
            </label>

            {(recordChannel === "email" || recordChannel === "both") && (
              <label className="block space-y-1">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Email
                </span>
                <Input
                  type="email"
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                  placeholder="customer@email.com"
                  className="h-10 border-border bg-background"
                />
              </label>
            )}

            {(recordChannel === "sms" || recordChannel === "both") && (
              <label className="block space-y-1">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Phone
                </span>
                <Input
                  type="tel"
                  value={receiptPhone}
                  onChange={(e) => setReceiptPhone(e.target.value)}
                  className="h-10 border-border bg-background"
                />
              </label>
            )}

            <Button
              type="button"
              disabled={recordBusy}
              onClick={() => void sendRecordInvoiceFromCrm()}
              className="h-11 w-full gap-2 bg-success text-white hover:bg-success"
            >
              {recordBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Send paid invoice / receipt
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
})

/** Outer wrapper: URL bridge is isolated — Inner stays mounted across tab clicks. */
export const CrmWorkspaceView = memo(function CrmWorkspaceView({
  isActive = true,
}: {
  isActive?: boolean
}) {
  // Seed from window so ?tab= / ?customer= paint before the bridge hydrates.
  const [urlQuery, setUrlQuery] = useState(readWindowSearchQuery)
  const onQuery = useCallback((q: string) => setUrlQuery(q), [])
  return (
    <>
      <ClientSearchParamsBridge onQuery={onQuery} />
      <CrmWorkspaceViewInner isActive={isActive} urlQuery={urlQuery} />
    </>
  )
})
