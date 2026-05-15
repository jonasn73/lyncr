"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import {
  Moon,
  Bell,
  Clock,
  Voicemail,
  Shield,
  ChevronRight,
  User,
  LogOut,
  HelpCircle,
  MessageSquare,
  Volume2,
  Phone,
  PhoneForwarded,
  ArrowRightLeft,
  Plus,
  Hash,
  X,
  Check,
  Loader2,
  Sparkles,
  Pencil,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { BrandWordmark } from "@/components/brand-wordmark"
import { displayPortingMessageBody } from "@/lib/porting-display"
import { useToast } from "@/hooks/use-toast"
import { IconSurface } from "@/components/ui/icon-surface"
import { SIGNUP_INDUSTRY_OPTIONS } from "@/lib/business-industries"
import { PortingOrderCommentsDialog } from "@/components/porting-order-comments-dialog"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import { StoryPopoverInfo } from "@/components/story-popover-info"

interface SettingToggle {
  id: string
  label: string
  description: string
  icon: typeof Moon
  enabled: boolean
  iconColor: string
}

// Receptionist fetched from /api/receptionists
interface ReceptionistInfo {
  id: string
  name: string
  phone: string
  initials: string
  color: string
}

// Per-number routing config fetched from /api/routing?all=true
interface NumberRouting {
  business_number: string | null
  selected_receptionist_id: string | null
  fallback_type: string | null
}

// Format E.164 phone for display, e.g. +15551234567 -> (555) 123-4567. Safe for null/undefined or non-string (e.g. from API).
function formatPhoneDisplay(phone: string | undefined | null): string {
  if (phone == null || typeof phone !== "string") return "your cell"
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

export function SettingsPage() {
  const { toast } = useToast()
  const [signingOut, setSigningOut] = useState(false)
  const [user, setUser] = useState<{
    name: string
    email: string
    phone: string
    industry: string
    business_name: string
    inbound_receptionist_whisper_enabled: boolean
  } | null>(null)
  const [businessNameDraft, setBusinessNameDraft] = useState("")
  const [businessNameSaving, setBusinessNameSaving] = useState(false)
  const [businessNameSavedAt, setBusinessNameSavedAt] = useState<number | null>(null)
  const [whisperSaving, setWhisperSaving] = useState(false)
  const [settings, setSettings] = useState<SettingToggle[]>([
    {
      id: "dnd",
      label: "Do Not Disturb",
      description: "Silence all notifications",
      icon: Moon,
      enabled: false,
      iconColor: "text-chart-3",
    },
    {
      id: "voicemail",
      label: "Voicemail Fallback",
      description: "Send to voicemail when no answer",
      icon: Voicemail,
      enabled: true,
      iconColor: "text-primary",
    },
    {
      id: "notifications",
      label: "Push Notifications",
      description: "Get notified of routing changes",
      icon: Bell,
      enabled: true,
      iconColor: "text-warning",
    },
    {
      id: "ring-all",
      label: "Ring All Simultaneously",
      description: "Ring all active contacts at once",
      icon: Volume2,
      enabled: false,
      iconColor: "text-chart-5",
    },
    {
      id: "sms-forward",
      label: "SMS Forwarding",
      description: "Forward texts to active contacts",
      icon: MessageSquare,
      enabled: true,
      iconColor: "text-chart-2",
    },
  ])

  const [showNumberModal, setShowNumberModal] = useState(false)
  const [numberTab, setNumberTab] = useState<"buy" | "port">("buy")
  const [portNumber, setPortNumber] = useState("")
  const [portCarrier, setPortCarrier] = useState("")
  const [portSubmitted, setPortSubmitted] = useState(false)
  const [portSubmitMessage, setPortSubmitMessage] = useState("")
  const [selectedAreaCode, setSelectedAreaCode] = useState("")
  const [buyStep, setBuyStep] = useState<"search" | "results">("search")
  const [buyLoading, setBuyLoading] = useState(false)
  /** User picked a search result — must enter a line business name before POST /api/numbers/telnyx/buy. */
  const [buyPendingNumber, setBuyPendingNumber] = useState<string | null>(null)
  const [buyAcquireBusinessName, setBuyAcquireBusinessName] = useState("")
  /** Port step 1: name for this line (saved to `phone_numbers.label` when the port order is created). */
  const [portLineBusinessName, setPortLineBusinessName] = useState("")
  const [portingNumbers, setPortingNumbers] = useState<{ id: string; number: string; status: string; statusLabel?: string }[]>([])
  const [portingLoading, setPortingLoading] = useState(false)
  /** Porting webhook → in-app notifications (see `016-porting-notifications.sql`). */
  const [portingNotifs, setPortingNotifs] = useState<
    { id: string; title: string; body: string; created_at: string; read_at: string | null }[]
  >([])
  const [portingNotifsUnread, setPortingNotifsUnread] = useState(0)
  /** Port order message thread (GET/POST comments API). */
  const [portingMsgs, setPortingMsgs] = useState<{
    id: string
    number: string
    allowReply: boolean
  } | null>(null)
  const [portSubmitLoading, setPortSubmitLoading] = useState(false)
  const [portError, setPortError] = useState<string | null>(null)
  // Port multi-step: 1 = number, 2 = account info, 3 = address
  const [portStep, setPortStep] = useState(1)
  const [portAccountName, setPortAccountName] = useState("")
  const [portAuthPerson, setPortAuthPerson] = useState("")
  const [portAccountNumber, setPortAccountNumber] = useState("")
  const [portPin, setPortPin] = useState("")
  const [portStreet, setPortStreet] = useState("")
  const [portCity, setPortCity] = useState("")
  const [portState, setPortState] = useState("")
  const [portZip, setPortZip] = useState("")
  const [portInvoiceFile, setPortInvoiceFile] = useState<File | null>(null) // recent carrier bill (image or PDF)
  const [portInvoiceBase64, setPortInvoiceBase64] = useState<string | null>(null) // base64 data to send to API
  const [editingMainLine, setEditingMainLine] = useState(false)
  const [mainLineEdit, setMainLineEdit] = useState("")
  const [mainLineSaveLoading, setMainLineSaveLoading] = useState(false)
  const [mainLineError, setMainLineError] = useState<string | null>(null)
  const [mainLineSavedAt, setMainLineSavedAt] = useState<number | null>(null)
  const [industryDraft, setIndustryDraft] = useState("generic")
  const [industrySaving, setIndustrySaving] = useState(false)
  const [industrySavedAt, setIndustrySavedAt] = useState<number | null>(null)

  // Per-number routing state
  const [receptionistsList, setReceptionistsList] = useState<ReceptionistInfo[]>([])
  const [numberRoutings, setNumberRoutings] = useState<NumberRouting[]>([])
  const [routingModalNumber, setRoutingModalNumber] = useState<string | null>(null) // E.164 number being configured, or null if closed
  const [routingSaving, setRoutingSaving] = useState(false)
  /** Draft line name in the Route Calls modal — saved to `phone_numbers.label` (whisper + UI). */
  const [routingLineLabelDraft, setRoutingLineLabelDraft] = useState("")
  const [routingLineLabelSaving, setRoutingLineLabelSaving] = useState(false)
  const [routingLineLabelError, setRoutingLineLabelError] = useState<string | null>(null)
  /** Account has voice AI assistant id — pairs with per-line `fallback_type === "ai"` for “AI live”. */
  const [telnyxAssistantLinked, setTelnyxAssistantLinked] = useState(false)
  /** Key into `getAppSheetStory` for member story bottom sheets on Settings. */
  const [settingsStorySheet, setSettingsStorySheet] = useState<string | null>(null)

  const pathname = usePathname()

  // Deep link from dashboard Quick setup: /dashboard/settings#business-numbers
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.location.hash !== "#business-numbers") return
    const id = window.setTimeout(() => {
      document.getElementById("business-numbers")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 120)
    return () => window.clearTimeout(id)
  }, [pathname])

  // Load current user so we can show main line (cell) in profile
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.data?.user) {
          const u = data.data.user
          setUser({
            name: u.name ?? "My Business",
            email: u.email ?? "",
            phone: u.phone ?? "",
            industry: u.industry ?? "generic",
            business_name: u.business_name ?? "My Business",
            inbound_receptionist_whisper_enabled: u.inbound_receptionist_whisper_enabled !== false,
          })
          setIndustryDraft(u.industry ?? "generic")
          setBusinessNameDraft(String(u.business_name ?? "").trim() || "My Business")
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Load receptionists for per-number routing picker
  useEffect(() => {
    let cancelled = false
    fetch("/api/receptionists", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.data)) {
          setReceptionistsList(data.data.map((r: Record<string, string>) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            initials: r.initials || r.name?.slice(0, 2)?.toUpperCase() || "??",
            color: r.color || "bg-primary",
          })))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Know if Voice AI can run (same signal as dashboard / per-line “AI live” labels).
  useEffect(() => {
    let cancelled = false
    fetch("/api/ai-assistant", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (!cancelled && data?.hasAssistant === true) setTelnyxAssistantLinked(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Load all routing configs (default + per-number) so we can show which receptionist is assigned
  useEffect(() => {
    let cancelled = false
    fetch("/api/routing?all=true", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { configs: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.configs)) {
          setNumberRoutings(
            data.configs.map((c: Record<string, string | null>) => ({
              business_number: c.business_number,
              selected_receptionist_id: c.selected_receptionist_id,
              fallback_type: c.fallback_type ?? null,
            }))
          )
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Load porting orders + in-app porting notifications (carrier updates)
  useEffect(() => {
    let cancelled = false
    setPortingLoading(true)
    Promise.all([
      fetch("/api/numbers/porting", { credentials: "include" }).then((res) =>
        res.ok ? res.json() : { porting: [] }
      ),
      fetch("/api/notifications/porting", { credentials: "include" }).then((res) =>
        res.ok ? res.json() : { data: { notifications: [], unreadCount: 0 } }
      ),
    ])
      .then(([portData, notifRes]) => {
        if (cancelled) return
        if (Array.isArray(portData.porting)) setPortingNumbers(portData.porting)
        const n = notifRes?.data?.notifications
        if (Array.isArray(n)) {
          setPortingNotifs(
            n.map((x: Record<string, unknown>) => ({
              id: String(x.id ?? ""),
              title: String(x.title ?? "Update"),
              body: String(x.body ?? ""),
              created_at: String(x.created_at ?? ""),
              read_at: x.read_at != null ? String(x.read_at) : null,
            }))
          )
        }
        setPortingNotifsUnread(Number(notifRes?.data?.unreadCount ?? 0))
      })
      .catch(() => {
        if (!cancelled) {
          setPortingNumbers([])
          setPortingNotifs([])
        }
      })
      .finally(() => {
        if (!cancelled) setPortingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [availableNumbers, setAvailableNumbers] = useState<{ number: string; friendly: string; type: string; price: string }[]>([])
  const [buyError, setBuyError] = useState<string | null>(null)
  const [buyingNumber, setBuyingNumber] = useState<string | null>(null) // number currently being purchased
  const [buySuccess, setBuySuccess] = useState<string | null>(null) // number just purchased

  // Business numbers = numbers customers call (bought or ported). Your main line (cell) is in the profile above.
  const [myNumbers, setMyNumbers] = useState<{ id: string; number: string; label: string; type: string; status: string }[]>([])

  // Load user's purchased/active business numbers from the database
  useEffect(() => {
    let cancelled = false
    fetch("/api/numbers/mine", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.numbers)) {
          setMyNumbers(data.numbers.map((n: Record<string, string>) => ({
            id: n.id,
            number: n.number,
            label: n.label || "Business Line",
            type: n.type || "local",
            status: n.status || "active",
          })))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // When the per-line routing modal opens (or numbers reload), copy the saved label into the draft field.
  useEffect(() => {
    if (!routingModalNumber) {
      setRoutingLineLabelDraft("")
      setRoutingLineLabelError(null)
      return
    }
    const row = myNumbers.find((n) => n.number === routingModalNumber)
    setRoutingLineLabelDraft(row?.label ?? "")
    setRoutingLineLabelError(null)
  }, [routingModalNumber, myNumbers])

  // Auto-configure any unconfigured numbers with voice webhooks (runs silently)
  useEffect(() => {
    fetch("/api/numbers/configure", { method: "POST", credentials: "include" }).catch(() => {})
  }, [])

  async function handleSearchNumbers() {
    setBuyLoading(true)
    setBuyError(null)
    setAvailableNumbers([])
    setBuySuccess(null)
    setBuyPendingNumber(null)
    setBuyAcquireBusinessName("")
    try {
      const res = await fetch(`/api/numbers/telnyx?area_code=${selectedAreaCode}&type=local`, { credentials: "include" })
      const data = await res.json()
      if (!res.ok) {
        setBuyError(data.error || "Search failed")
        return
      }
      const nums = (data.numbers || []).map((n: { number: string; friendly_name: string; type: string; monthly_cost: string | number }) => ({
        number: n.number,
        friendly: formatPhoneDisplay(n.number),
        type: n.type === "toll_free" ? "Toll-Free" : "Local",
        price: `$${parseFloat(String(n.monthly_cost || "1")).toFixed(2)}/mo`,
      }))
      setAvailableNumbers(nums)
      if (nums.length === 0) setBuyError("No numbers found for this area code. Try another.")
      setBuyStep("results")
    } catch {
      setBuyError("Search failed. Try again.")
    } finally {
      setBuyLoading(false)
    }
  }

  async function handleBuyNumber(phoneNumber: string, lineBusinessName: string) {
    setBuyingNumber(phoneNumber)
    setBuyError(null)
    try {
      const res = await fetch("/api/numbers/telnyx/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone_number: phoneNumber, line_business_name: lineBusinessName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBuyError(data.error || "Failed to buy number")
        return
      }
      setBuySuccess(phoneNumber)
      setBuyPendingNumber(null)
      setBuyAcquireBusinessName("")
      toast({
        title: "Number purchased",
        description: `${formatPhoneDisplay(phoneNumber)} is ready to receive calls.`,
      })
      setAvailableNumbers((prev) => prev.filter((n) => n.number !== phoneNumber))
      const savedLabel = typeof data.number?.label === "string" ? data.number.label : lineBusinessName
      setMyNumbers((prev) => [...prev, {
        id: data.number?.id || phoneNumber,
        number: phoneNumber,
        label: savedLabel,
        type: "local",
        status: "active",
      }])
    } catch {
      setBuyError("Failed to buy number. Try again.")
    } finally {
      setBuyingNumber(null)
    }
  }

  async function handlePortSubmit() {
    setPortError(null)
    setPortSubmitLoading(true)
    try {
      const res = await fetch("/api/numbers/port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          number: portNumber,
          line_business_name: portLineBusinessName.trim(),
          account_name: portAccountName,
          authorized_person: portAuthPerson,
          account_number: portAccountNumber || undefined,
          pin: portPin || undefined,
          street_address: portStreet,
          city: portCity,
          state: portState,
          zip: portZip,
          invoice_base64: portInvoiceBase64 || undefined,
          invoice_filename: portInvoiceFile?.name || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPortError(data.error || "Failed to start port")
        return
      }
      setPortSubmitMessage(data.message || `Your number is being transferred to ${SITE_NAME}.`)
      setPortSubmitted(true)
      toast({
        title: "Port request submitted",
        description: "We started your transfer and will keep status updated here.",
      })
      const [portingRes, notifRes] = await Promise.all([
        fetch("/api/numbers/porting", { credentials: "include" }),
        fetch("/api/notifications/porting", { credentials: "include" }),
      ])
      const portingData = await portingRes.json()
      const notifData = await notifRes.json().catch(() => ({}))
      if (Array.isArray(portingData.porting)) setPortingNumbers(portingData.porting)
      const n = notifData?.data?.notifications
      if (Array.isArray(n)) {
        setPortingNotifs(
          n.map((x: Record<string, unknown>) => ({
            id: String(x.id ?? ""),
            title: String(x.title ?? "Update"),
            body: String(x.body ?? ""),
            created_at: String(x.created_at ?? ""),
            read_at: x.read_at != null ? String(x.read_at) : null,
          }))
        )
      }
      setPortingNotifsUnread(Number(notifData?.data?.unreadCount ?? 0))
    } catch {
      setPortError("Failed to start port. Try again.")
    } finally {
      setPortSubmitLoading(false)
    }
  }

  // Convert a file to base64 string (for sending to our API)
  function handleInvoiceFile(file: File | null) {
    setPortInvoiceFile(file)
    if (!file) {
      setPortInvoiceBase64(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data:... prefix so we have pure base64
      const base64 = result.includes(",") ? result.split(",")[1] : result
      setPortInvoiceBase64(base64)
    }
    reader.readAsDataURL(file)
  }

  function formatPortingNotifTime(iso: string) {
    try {
      const d = new Date(iso)
      const diff = Date.now() - d.getTime()
      const days = Math.floor(diff / 86_400_000)
      if (days === 0) return "Today"
      if (days === 1) return "Yesterday"
      if (days < 14) return `${days} days ago`
      return d.toLocaleDateString()
    } catch {
      return ""
    }
  }

  async function markAllPortingNotifsRead() {
    await fetch("/api/notifications/porting", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    })
    setPortingNotifs((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    setPortingNotifsUnread(0)
  }

  function resetPortForm() {
    setPortStep(1)
    setPortNumber("")
    setPortLineBusinessName("")
    setPortCarrier("")
    setPortAccountName("")
    setPortAuthPerson("")
    setPortAccountNumber("")
    setPortPin("")
    setPortStreet("")
    setPortCity("")
    setPortState("")
    setPortZip("")
    setPortInvoiceFile(null)
    setPortInvoiceBase64(null)
    setPortSubmitted(false)
    setPortSubmitMessage("")
    setPortError(null)
  }

  /** True when a routing row’s `business_number` is the same line as `e164` (handles +1 vs digits). */
  function routingRowMatchesE164(businessNumber: string | null, e164: string): boolean {
    if (businessNumber == null || businessNumber === "") return false
    if (businessNumber === e164) return true
    const a = businessNumber.replace(/\D/g, "")
    const b = e164.replace(/\D/g, "")
    return a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10)
  }

  // Look up which receptionist is assigned to a specific business number
  function getRoutingForNumber(e164: string): { receptionist: ReceptionistInfo | null; isDefault: boolean } {
    const specific = numberRoutings.find((r) => routingRowMatchesE164(r.business_number, e164))
    if (specific) {
      const rec = receptionistsList.find((r) => r.id === specific.selected_receptionist_id) || null
      return { receptionist: rec, isDefault: false }
    }
    // No specific config → uses default
    const defaultConfig = numberRoutings.find((r) => r.business_number === null)
    if (defaultConfig?.selected_receptionist_id) {
      const rec = receptionistsList.find((r) => r.id === defaultConfig.selected_receptionist_id) || null
      return { receptionist: rec, isDefault: true }
    }
    return { receptionist: null, isDefault: true }
  }

  /** Label + style for the no-answer fallback row (matches GET /api/numbers/mine `routing_summary` idea). */
  function getFallbackLineLabel(e164: string): { label: string; tone: "success" | "warning" | "muted"; title: string } {
    const specific = numberRoutings.find((r) => routingRowMatchesE164(r.business_number, e164))
    const defaultRow = numberRoutings.find((r) => r.business_number === null)
    const fb = (specific?.fallback_type || defaultRow?.fallback_type || "owner").toLowerCase()
    if (fb === "ai" && telnyxAssistantLinked) {
      return {
        label: "AI fallback live",
        tone: "success",
        title: "This line uses AI after no answer and your voice assistant is connected.",
      }
    }
    if (fb === "ai" && !telnyxAssistantLinked) {
      return {
        label: "AI — finish setup",
        tone: "warning",
        title: "AI fallback is selected but no assistant is linked yet. Open Dashboard → AI fallback and save.",
      }
    }
    if (fb === "voicemail") {
      return { label: "Voicemail fallback", tone: "muted", title: "No-answer calls go to voicemail." }
    }
    return {
      label: "Ring phone fallback",
      tone: "muted",
      title: "No-answer follows your “ring again / owner” routing (see Dashboard).",
    }
  }

  // Persist the line name for the number open in the routing modal (used in receptionist whisper + lists).
  async function saveRoutingLineLabel() {
    if (!routingModalNumber) return // Modal closed — nothing to save
    const row = myNumbers.find((n) => n.number === routingModalNumber) // Look up UUID for this E.164
    if (!row) return // Numbers list not loaded yet
    setRoutingLineLabelSaving(true) // Disable button while the request runs
    setRoutingLineLabelError(null) // Clear any previous error message
    try {
      const res = await fetch(`/api/numbers/${row.id}`, {
        method: "PATCH", // Partial update of one phone_numbers row
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Send session cookie so the API knows the user
        body: JSON.stringify({ label: routingLineLabelDraft.trim() || "Business Line" }), // Empty input → default label
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string } // Parse error body if present
      if (!res.ok) {
        setRoutingLineLabelError(typeof data?.error === "string" ? data.error : "Could not save line name") // Show server message
        return // Leave modal open so they can retry
      }
      const saved = routingLineLabelDraft.trim() || "Business Line" // Value we optimistically mirror in state
      setMyNumbers((prev) => prev.map((n) => (n.number === routingModalNumber ? { ...n, label: saved } : n))) // Update list under the hood
      toast({
        title: "Line name saved",
        description: "Your team hears this in the short whisper when they pick up a forwarded call.",
      }) // Lightweight confirmation
    } catch {
      setRoutingLineLabelError("Network error — try again.") // Offline or CORS-style failure
    } finally {
      setRoutingLineLabelSaving(false) // Re-enable the save button
    }
  }

  // Save a receptionist assignment for a specific number
  async function saveNumberRouting(e164: string, receptionistId: string | null) {
    setRoutingSaving(true)
    try {
      const res = await fetch("/api/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          business_number: e164,
          selected_receptionist_id: receptionistId,
        }),
      })
      if (res.ok) {
        const all = await fetch("/api/routing?all=true", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : { configs: [] }
        )
        if (Array.isArray(all.configs)) {
          setNumberRoutings(
            all.configs.map((c: Record<string, string | null>) => ({
              business_number: c.business_number,
              selected_receptionist_id: c.selected_receptionist_id,
              fallback_type: c.fallback_type ?? null,
            }))
          )
        }
        setRoutingModalNumber(null)
        toast({
          title: "Routing saved",
          description: `${formatPhoneDisplay(e164)} was updated.`,
        })
      }
    } catch {
      // silently fail
    } finally {
      setRoutingSaving(false)
    }
  }

  function toggleSetting(id: string) {
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    )
  }

  function startEditMainLine() {
    setMainLineError(null)
    setMainLineEdit(user?.phone ? formatPhoneDisplay(user.phone) : "")
    setEditingMainLine(true)
  }

  function cancelEditMainLine() {
    setEditingMainLine(false)
    setMainLineEdit("")
    setMainLineError(null)
  }

  async function saveIndustry() {
    setIndustrySaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ industry: industryDraft }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Could not save industry",
          description: data.error || "Try again.",
          variant: "destructive",
        })
        return
      }
      setUser((prev) => (prev ? { ...prev, industry: industryDraft } : prev))
      setIndustrySavedAt(Date.now())
      toast({
        title: "Industry updated",
        description:
          "When AI flow is set to Auto, your playbook follows this industry. Open AI flow to confirm or override.",
      })
    } catch {
      toast({ title: "Error", description: "Could not save industry.", variant: "destructive" })
    } finally {
      setIndustrySaving(false)
    }
  }

  async function saveAccountBusinessName() {
    const trimmed = businessNameDraft.trim() || "My Business"
    setBusinessNameSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ business_name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Could not save business name",
          description: data.error || "Try again.",
          variant: "destructive",
        })
        return
      }
      setUser((prev) => (prev ? { ...prev, business_name: trimmed } : prev))
      setBusinessNameDraft(trimmed)
      setBusinessNameSavedAt(Date.now())
      toast({
        title: "Business name saved",
        description: "Used for outbound caller ID name on forwarded calls when your carrier supports it. Team whisper uses your line label only.",
      })
    } catch {
      toast({ title: "Error", description: "Could not save business name.", variant: "destructive" })
    } finally {
      setBusinessNameSaving(false)
    }
  }

  async function saveWhisperEnabled(next: boolean) {
    setWhisperSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inbound_receptionist_whisper_enabled: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Could not update whisper",
          description: data.error || "Try again.",
          variant: "destructive",
        })
        return
      }
      setUser((prev) => (prev ? { ...prev, inbound_receptionist_whisper_enabled: next } : prev))
      toast({
        title: next ? "Whisper on" : "Whisper off",
        description: next
          ? "Your team will hear a short spoken ID after they answer a forwarded call."
          : "Forwarded calls connect without the spoken line ID.",
      })
    } catch {
      toast({ title: "Error", description: "Could not update whisper setting.", variant: "destructive" })
    } finally {
      setWhisperSaving(false)
    }
  }

  async function saveMainLine() {
    if (!mainLineEdit.trim()) return
    setMainLineError(null)
    setMainLineSaveLoading(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: mainLineEdit.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMainLineError(data.error || "Failed to update")
        return
      }
      setEditingMainLine(false)
      setMainLineEdit("")
      // Refetch session so user state has the updated phone (E.164 from server)
      const sessionRes = await fetch("/api/auth/session", { credentials: "include" })
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json()
        if (sessionData?.data?.user) {
          const su = sessionData.data.user
          setUser({
            name: su.name ?? "My Business",
            email: su.email ?? "",
            phone: su.phone ?? "",
            industry: su.industry ?? "generic",
            business_name: su.business_name ?? "My Business",
            inbound_receptionist_whisper_enabled: su.inbound_receptionist_whisper_enabled !== false,
          })
          setBusinessNameDraft(String(su.business_name ?? "").trim() || "My Business")
          toast({
            title: "Main line updated",
            description: "Default destination number has been saved.",
          })
          setMainLineSavedAt(Date.now())
        }
      }
    } catch {
      setMainLineError("Something went wrong")
    } finally {
      setMainLineSaveLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 pb-8">
      {/* Profile card: main line = owner's cell (default destination for calls) */}
      <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm transition-colors">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
            ME
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground">{user?.name ?? "My Business"}</p>
              <p className="text-sm text-muted-foreground">{user?.email || "owner@mybusiness.com"}</p>
            </div>
            <SheetInfoTrigger
              onPress={() => setSettingsStorySheet("profile-overview")}
              label="About owner profile"
            />
          </div>
          {editingMainLine ? (
            <div className="mt-2 space-y-2">
              <input
                type="tel"
                value={mainLineEdit}
                onChange={(e) => setMainLineEdit(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full rounded-xl border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                autoFocus
              />
              {mainLineError && (
                <p className="text-xs text-destructive">{mainLineError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveMainLine}
                  disabled={mainLineSaveLoading || !mainLineEdit.trim()}
                  className="sigo-btn-sm bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {mainLineSaveLoading ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditMainLine}
                  disabled={mainLineSaveLoading}
                  className="sigo-btn-sm border border-border/70 text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {mainLineSavedAt && (
                <p className="text-[11px] text-success">Saved just now</p>
              )}
            </div>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
              Main line: {formatPhoneDisplay(user?.phone)} — calls default here when no receptionist is selected.{" "}
              <button
                type="button"
                onClick={startEditMainLine}
                className="font-medium text-primary underline decoration-primary/60 underline-offset-2 hover:no-underline"
              >
                Edit
              </button>
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("main-line")}
                label="About main line"
                className="h-7 w-7"
              />
            </p>
          )}
          <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <label className="text-[11px] font-semibold text-muted-foreground">
              Industry (signup) — default AI phone script
            </label>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                When AI fallback is set to <span className="font-medium text-foreground">Auto</span>, callers get questions
                tailored to this trade. You can override the script below.
              </p>
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("industry-ai")}
                label="Industry and AI script"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={industryDraft}
                onChange={(e) => setIndustryDraft(e.target.value)}
                className="min-w-[12rem] flex-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {SIGNUP_INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveIndustry}
                disabled={industrySaving || industryDraft === (user?.industry ?? "")}
                className="sigo-btn-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {industrySaving ? "Saving…" : "Save industry"}
              </button>
            </div>
            {industrySavedAt ? (
              <p className="text-[11px] text-success">Industry saved — check AI call flow if you use Auto playbook.</p>
            ) : null}
          </div>
          <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="sigo-settings-account-business-name" className="text-[11px] font-semibold text-muted-foreground">
                Account business name
              </label>
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("account-business-name")}
                label="About account business name"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Spoken first in the team whisper (if enabled). Telnyx also sends it as the outbound display name on forwarded
              calls when your carrier supports it, which can reduce &quot;spam risk&quot; labels compared to showing only a bare number.
            </p>
            <input
              id="sigo-settings-account-business-name"
              type="text"
              value={businessNameDraft}
              onChange={(e) => setBusinessNameDraft(e.target.value)}
              placeholder="e.g. Key Squad Locksmith"
              maxLength={120}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveAccountBusinessName()}
                disabled={
                  businessNameSaving ||
                  !businessNameDraft.trim() ||
                  businessNameDraft.trim() === (user?.business_name ?? "").trim()
                }
                className="sigo-btn-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {businessNameSaving ? "Saving…" : "Save business name"}
              </button>
            </div>
            {businessNameSavedAt ? (
              <p className="text-[11px] text-success">Business name saved.</p>
            ) : null}
          </div>
          <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground">Team whisper after answer</p>
              <p className="text-[11px] text-muted-foreground">
                Only the person who picks up the forwarded leg hears it (not the caller), right before the caller is
                connected. It says this line&apos;s label only — not your account business name.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("team-whisper")}
                label="About team whisper"
              />
              <Switch
                checked={user?.inbound_receptionist_whisper_enabled !== false}
                onCheckedChange={(v) => void saveWhisperEnabled(v)}
                disabled={whisperSaving || !user}
                aria-label="Toggle team whisper after answer"
              />
            </div>
          </div>
          <Badge variant="secondary" className="mt-1 text-[10px]">
            Pro Plan
          </Badge>
        </div>
        {!editingMainLine && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
      </div>

      {/* Business numbers: the numbers customers call; buy or port; route to cell or receptionists */}
      <section id="business-numbers" className="scroll-mt-20 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Business numbers
            </h3>
            <p className="text-xs text-muted-foreground">
              Numbers your customers call (buy or port). Calls ring your main line or receptionist. For transfers in
              progress, use <span className="font-medium text-foreground">Messages</span> for updates from the porting team
              (PIN fixes, deadlines) and to send replies.
            </p>
          </div>
          <SheetInfoTrigger
            onPress={() => setSettingsStorySheet("business-numbers-section")}
            label="About business numbers"
          />
        </div>
        <div className="flex flex-col gap-2">
          {myNumbers
            .filter((num) => num.status === "active")
            .map((num) => {
            const routing = getRoutingForNumber(num.number)
            const fb = getFallbackLineLabel(num.number)
            return (
              <div
                key={num.number}
                className="flex w-full items-stretch overflow-hidden rounded-2xl border border-border/70 bg-card/85 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
              >
                <button
                  type="button"
                  onClick={() => setRoutingModalNumber(num.number)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 p-4 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <IconSurface tone="primary">
                      <Phone className="h-4 w-4" />
                    </IconSurface>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{formatPhoneDisplay(num.number)}</p>
                      <p className="truncate text-[11px] text-muted-foreground/90">{num.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {routing.receptionist
                          ? `→ ${routing.receptionist.name}${routing.isDefault ? " (default)" : ""}`
                          : `→ Your Phone${routing.isDefault ? " (default)" : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        Active
                      </span>
                      <Badge
                        variant="secondary"
                        title={fb.title}
                        className={cn(
                          "max-w-[9.5rem] text-[10px] font-semibold",
                          fb.tone === "success" && "border-success/30 bg-success/10 text-success",
                          fb.tone === "warning" && "border-warning/30 bg-warning/10 text-warning"
                        )}
                      >
                        {fb.tone === "success" && <Sparkles className="mr-0.5 inline h-3 w-3 align-text-bottom" aria-hidden />}
                        {fb.label}
                      </Badge>
                    </div>
                    <PhoneForwarded className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
                <SheetInfoTrigger
                  onPress={() => setSettingsStorySheet("published-line")}
                  label="About this business line"
                />
                <button
                  type="button"
                  aria-label={`Edit business name for ${formatPhoneDisplay(num.number)}`}
                  title="Edit business name"
                  onClick={() => setRoutingModalNumber(num.number)}
                  className="flex shrink-0 items-center border-l border-border/60 px-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )
          })}

          {portingLoading && portingNumbers.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/85 py-6 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading port status…</span>
            </div>
          ) : null}
          {portingNumbers.map((p) => {
            const isComplete = p.status === "ported"
            const isError =
              p.status === "exception" || p.status === "rejected" || p.status === "failed"
            const isCancelled =
              p.status === "cancelled" ||
              p.status === "canceled" ||
              p.status === "cancel-pending"
            const canCancel =
              !isComplete &&
              !isError &&
              !isCancelled &&
              p.status !== "in-process" &&
              p.status !== "submitted" &&
              p.status !== "port-activating"
            const badgeColor = isComplete ? "bg-success/10 text-success" : isError ? "bg-destructive/10 text-destructive" : isCancelled ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning"
            const iconBg = isComplete ? "bg-success/10" : isError ? "bg-destructive/10" : "bg-warning/10"
            const iconColor = isComplete ? "text-success" : isError ? "text-destructive" : "text-warning"
            // For completed ports, show routing info and make tappable
            const routing = isComplete ? getRoutingForNumber(p.number) : null
            const portRowLabel = myNumbers.find((n) => n.number === p.number)?.label
            if (isComplete) {
              return (
                <div
                  key={p.id || p.number}
                  className="flex w-full items-stretch overflow-hidden rounded-2xl border border-border/70 bg-card/85 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
                >
                  <button
                    type="button"
                    onClick={() => setRoutingModalNumber(p.number)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 p-4 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconBg)}>
                        <Check className={cn("h-4 w-4", iconColor)} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{formatPhoneDisplay(p.number)}</p>
                        {portRowLabel ? (
                          <p className="truncate text-[11px] text-muted-foreground/90">{portRowLabel}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {routing
                            ? routing.receptionist
                              ? `→ ${routing.receptionist.name}${routing.isDefault ? " (default)" : ""}`
                              : `→ Your Phone${routing.isDefault ? " (default)" : ""}`
                            : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {p.id ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPortingMsgs({
                              id: p.id,
                              number: p.number,
                              allowReply: !isComplete && !isCancelled,
                            })
                          }}
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
                        >
                          Messages
                        </button>
                      ) : null}
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeColor)}>
                        Active
                      </span>
                      <PhoneForwarded className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                  <SheetInfoTrigger
                    onPress={() => setSettingsStorySheet("published-line")}
                    label="About this business line"
                  />
                  <button
                    type="button"
                    aria-label={`Edit business name for ${formatPhoneDisplay(p.number)}`}
                    title="Edit business name"
                    onClick={() => setRoutingModalNumber(p.number)}
                    className="flex shrink-0 items-center border-l border-border/60 px-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )
            }
            return (
              <div
                key={p.id || p.number}
                className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-card/85 p-4 text-left shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", iconBg)}>
                    <ArrowRightLeft className={cn("h-4 w-4", iconColor)} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{formatPhoneDisplay(p.number)}</p>
                    <p className="text-xs text-muted-foreground">{p.statusLabel || "Transfer in progress"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <SheetInfoTrigger
                    onPress={() => setSettingsStorySheet("porting-in-flight")}
                    label="About number porting"
                  />
                  {p.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Reply whenever the order is still open — not finished or cancelled.
                        // Do not treat exception/rejected/failed as read-only: those are often when the porting team asks for PIN fixes.
                        setPortingMsgs({
                          id: p.id,
                          number: p.number,
                          allowReply: !isComplete && !isCancelled,
                        })
                      }}
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
                    >
                      Messages
                    </button>
                  ) : null}
                  {canCancel && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm(`Cancel porting for ${formatPhoneDisplay(p.number)}?`)) return
                        try {
                          const res = await fetch("/api/numbers/porting/cancel", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ order_id: p.id }),
                          })
                          if (res.ok) {
                            setPortingNumbers((prev) => prev.filter((x) => x.id !== p.id))
                          } else {
                            const data = await res.json().catch(() => ({}))
                            alert(data.error || "Failed to cancel")
                          }
                        } catch {
                          alert("Failed to cancel. Try again.")
                        }
                      }}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-destructive transition-colors hover:bg-destructive/10"
                    >
                      Cancel
                    </button>
                  )}
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeColor)}>
                    {isComplete ? "Active" : isError ? "Action needed" : isCancelled ? "Cancelled" : "Porting"}
                  </span>
                  {isComplete && <PhoneForwarded className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            )
          })}

          {portingNotifs.length > 0 ? (
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Transfer updates</p>
                    <p className="text-xs text-muted-foreground">
                      Updates from carriers and the porting team about your transfer — we surface them here so you do not miss deadlines or PIN requests.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <SheetInfoTrigger
                    onPress={() => setSettingsStorySheet("porting-updates")}
                    label="About transfer updates"
                  />
                  {portingNotifsUnread > 0 ? (
                    <button
                      type="button"
                      onClick={() => void markAllPortingNotifsRead()}
                      className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20"
                    >
                      Mark all read
                    </button>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {portingNotifs.slice(0, 15).map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs",
                      !n.read_at && "border-primary/25 bg-primary/[0.04]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground">{displayPortingMessageBody(n.title)}</span>
                      {!n.read_at ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{displayPortingMessageBody(n.body)}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{formatPortingNotifTime(n.created_at)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex w-full items-stretch overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-primary/5 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/10">
            <button
              type="button"
              onClick={() => {
                setShowNumberModal(true)
                setNumberTab("buy")
                setBuyStep("search")
                setSelectedAreaCode("")
                setBuyPendingNumber(null)
                setBuyAcquireBusinessName("")
                resetPortForm()
              }}
              className="flex min-w-0 flex-1 items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <IconSurface tone="primary">
                  <Plus className="h-4 w-4" />
                </IconSurface>
                <div>
                  <p className="text-sm font-medium text-primary">Add business number</p>
                  <p className="text-xs text-muted-foreground">Buy new or port existing — calls route to your cell</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-primary/60" />
            </button>
            <div className="flex shrink-0 items-center border-l border-primary/20 bg-primary/[0.07] pr-1">
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("add-number")}
                label="Buy vs port a number"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Routing settings */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Call Routing
          </h3>
          <SheetInfoTrigger
            onPress={() => setSettingsStorySheet("routing-section-intro")}
            label="About call routing preferences"
          />
        </div>
        <div className="flex flex-col gap-2">
          {settings.map((setting) => {
            const Icon = setting.icon
            return (
              <div
                key={setting.id}
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm transition-colors"
              >
                <div className="flex items-center gap-3">
                  <IconSurface>
                    <Icon className={cn("h-4 w-4", setting.iconColor)} />
                  </IconSurface>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {setting.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {setting.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <SheetInfoTrigger
                    onPress={() => setSettingsStorySheet(`toggle-${setting.id}`)}
                    label={`About ${setting.label}`}
                  />
                  <Switch
                    checked={setting.enabled}
                    onCheckedChange={() => toggleSetting(setting.id)}
                    aria-label={setting.label}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* AI fallback — one screen only (no duplicate controls vs Settings). */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            AI fallback
          </h3>
          <SheetInfoTrigger
            onPress={() => setSettingsStorySheet("ai-fallback")}
            label="About AI fallback"
          />
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">
            Playbook, opening line, voice, and call limits are under{" "}
            <span className="font-medium text-foreground">Routing</span> → tap{" "}
            <span className="font-medium text-foreground">If no answer</span> → choose AI receptionist — not here.
          </p>
          <a
            href="/dashboard?ai=1"
            className="mt-3 flex items-center justify-between rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open AI fallback setup
            <ChevronRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Schedule */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Schedule
          </h3>
          <SheetInfoTrigger
            onPress={() => setSettingsStorySheet("business-hours")}
            label="About business hours"
          />
        </div>
        <button
          type="button"
          onClick={() => setSettingsStorySheet("business-hours")}
          className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-card/85 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5"
        >
          <div className="flex items-center gap-3">
            <IconSurface>
              <Clock className="h-4 w-4 text-primary" />
            </IconSurface>
            <div>
              <p className="text-sm font-medium text-foreground">
                Business Hours
              </p>
              <p className="text-xs text-muted-foreground">
                Mon-Fri, 9:00 AM - 5:00 PM — tap for how hours will control routing.
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </section>

      {/* Number Modal */}
      {showNumberModal && (
        <>
          <div
            className="fixed inset-0 z-[60] animate-in fade-in-0 bg-background/60 backdrop-blur-sm duration-150"
            onClick={() => {
              setShowNumberModal(false)
              setBuyPendingNumber(null)
              setBuyAcquireBusinessName("")
            }}
            aria-hidden="true"
          />
          <div className="fixed inset-x-4 top-16 z-[70] mx-auto max-h-[calc(100dvh-5rem)] max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card pb-3 shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200 [-webkit-overflow-scrolling:touch]">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-2 py-2 pl-3 pr-1">
              <div className="flex min-w-0 items-center gap-0.5">
                <h3 className="text-sm font-semibold text-foreground">Get a Number</h3>
                <SheetInfoTrigger
                  onPress={() => setSettingsStorySheet("number-modal-overview")}
                  label="About buying or porting in this modal"
                  className="h-8 w-8"
                />
              </div>
              <button
                onClick={() => {
                  setShowNumberModal(false)
                  setBuyPendingNumber(null)
                  setBuyAcquireBusinessName("")
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setNumberTab("buy")}
                className={cn(
                  "flex-1 py-2.5 text-center text-xs font-semibold transition-colors",
                  numberTab === "buy"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Buy New Number
              </button>
              <button
                onClick={() => setNumberTab("port")}
                className={cn(
                  "flex-1 py-2.5 text-center text-xs font-semibold transition-colors",
                  numberTab === "port"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Port Existing
              </button>
            </div>

            {/* Buy tab */}
            {numberTab === "buy" && (
              <div className="p-4">
                {buyStep === "search" ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">Search by area code to find available numbers.</p>
                      <StoryPopoverInfo storyKey="buy-step-search" label="About number search" triggerClassName="h-7 w-7" />
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Area code (e.g. 305)"
                          maxLength={3}
                          value={selectedAreaCode}
                          onChange={(e) => setSelectedAreaCode(e.target.value.replace(/\D/g, ""))}
                          className="w-full rounded-xl border border-border/70 bg-secondary py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={handleSearchNumbers}
                        disabled={selectedAreaCode.length < 3}
                        className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                      >
                        {buyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {availableNumbers.length} number{availableNumbers.length !== 1 ? "s" : ""} in ({selectedAreaCode})
                      </p>
                      <div className="flex shrink-0 items-center gap-1">
                        <StoryPopoverInfo storyKey="buy-step-purchase-label" label="About buying a number" triggerClassName="h-7 w-7" />
                        <button
                        onClick={() => {
                          setBuyStep("search")
                          setAvailableNumbers([])
                          setBuyError(null)
                          setBuySuccess(null)
                          setBuyPendingNumber(null)
                          setBuyAcquireBusinessName("")
                        }}
                        className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Change
                        </button>
                      </div>
                    </div>

                    {buySuccess && (
                      <div className="flex items-center gap-2 rounded-xl bg-success/10 p-3">
                        <Check className="h-4 w-4 text-success" />
                        <p className="text-xs font-medium text-success">
                          {formatPhoneDisplay(buySuccess)} purchased! It will appear in your business numbers shortly.
                        </p>
                      </div>
                    )}

                    {buyError && <p className="text-xs text-destructive">{buyError}</p>}

                    {buyPendingNumber ? (
                      <div className="rounded-xl border border-primary/35 bg-primary/5 p-3">
                        <p className="text-xs font-semibold text-foreground">
                          Buy {formatPhoneDisplay(buyPendingNumber)}
                        </p>
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          Line label for your team. If the whisper is on in Settings, they hear this label only right after they answer (before the caller is connected). While ringing, caller ID is usually this business number.
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <label htmlFor="sigo-buy-line-name" className="text-[11px] font-semibold text-muted-foreground">
                            Line label
                          </label>
                          <StoryPopoverInfo storyKey="buy-step-purchase-label" label="Why line label before purchase" triggerClassName="h-7 w-7" />
                        </div>
                        <input
                          id="sigo-buy-line-name"
                          type="text"
                          value={buyAcquireBusinessName}
                          onChange={(e) => setBuyAcquireBusinessName(e.target.value)}
                          placeholder="e.g. Main storefront, Dispatch west"
                          maxLength={120}
                          className="mt-1 w-full rounded-xl border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                          autoFocus
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setBuyPendingNumber(null)
                              setBuyAcquireBusinessName("")
                            }}
                            disabled={buyingNumber !== null}
                            className="flex-1 rounded-xl border border-border/70 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleBuyNumber(buyPendingNumber, buyAcquireBusinessName.trim())}
                            disabled={buyingNumber !== null || buyAcquireBusinessName.trim().length === 0}
                            className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                          >
                            {buyingNumber === buyPendingNumber ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Purchase"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2">
                      {availableNumbers.map((num) => (
                        <button
                          key={num.number}
                          type="button"
                          onClick={() => {
                            setBuyPendingNumber(num.number)
                            setBuyAcquireBusinessName("")
                          }}
                          disabled={buyingNumber !== null}
                          className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">{num.friendly}</p>
                            <p className="text-[11px] text-muted-foreground">{num.type}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">{num.price}</span>
                            <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                              Choose
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {availableNumbers.length === 0 && !buyError && (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Port tab - multi-step */}
            {numberTab === "port" && (
              <div className="p-4">
                {portSubmitted ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                      <Check className="h-6 w-6 text-success" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Port Request Submitted</p>
                      <p className="mt-1 text-xs text-muted-foreground">{portSubmitMessage}</p>
                    </div>
                    <button
                      onClick={() => { setShowNumberModal(false); resetPortForm() }}
                      className="mt-2 rounded-xl bg-primary px-6 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Progress bar */}
                    <div className="flex items-center gap-2 pb-1">
                      {[1, 2, 3].map((s) => (
                        <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", s <= portStep ? "bg-primary" : "bg-border")} />
                      ))}
                    </div>

                    {/* Step 1: Phone number */}
                    {portStep === 1 && (
                      <>
                        <div className="flex items-start justify-between gap-2 rounded-xl bg-secondary p-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Port your existing business number to {SITE_NAME}. No downtime, no missed calls.
                            </p>
                          </div>
                          <StoryPopoverInfo storyKey="port-step1-number" label="About port step 1" triggerClassName="h-7 w-7 shrink-0" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Phone number to port</label>
                          <input
                            type="tel"
                            placeholder="(555) 123-4567"
                            value={portNumber}
                            onChange={(e) => setPortNumber(e.target.value)}
                            className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Line label</label>
                          <input
                            type="text"
                            placeholder="e.g. Main office line, After-hours service"
                            value={portLineBusinessName}
                            onChange={(e) => setPortLineBusinessName(e.target.value)}
                            maxLength={120}
                            className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                          />
                          <p className="text-[10px] leading-snug text-muted-foreground">
                            Required. Saved on this number so your team can tell lines apart. Caller ID while ringing is this DID; if whisper is on, they hear this line label only after they answer.
                          </p>
                        </div>
                        {portError && <p className="text-xs text-destructive">{portError}</p>}
                        <button
                          onClick={() => { setPortError(null); setPortStep(2) }}
                          disabled={!portNumber.replace(/\D/g, "").length || !portLineBusinessName.trim().length}
                          className="sigo-btn-sm mt-1 w-full bg-primary py-2.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                        >
                          Next: Account info
                        </button>
                      </>
                    )}

                    {/* Step 2: Account information */}
                    {portStep === 2 && (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            Enter the account details from your current phone provider. This authorizes the transfer.
                          </p>
                          <StoryPopoverInfo storyKey="port-step2-account" label="About port account step" triggerClassName="h-7 w-7 shrink-0" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Name on account</label>
                          <input type="text" placeholder="Your name or business name" value={portAccountName} onChange={(e) => setPortAccountName(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" autoFocus />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Authorized person (who can approve the transfer)</label>
                          <input type="text" placeholder="Your full name" value={portAuthPerson} onChange={(e) => setPortAuthPerson(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Account number (optional)</label>
                          <input type="text" placeholder="From your current provider's bill" value={portAccountNumber} onChange={(e) => setPortAccountNumber(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Account PIN (optional)</label>
                          <input type="text" placeholder="If your carrier requires a PIN" value={portPin} onChange={(e) => setPortPin(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Recent carrier bill / invoice</label>
                          <p className="text-[10px] text-muted-foreground -mt-1">Upload a photo or PDF of your most recent phone bill. Required by carriers to verify the transfer.</p>
                          <label className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm transition-colors",
                            portInvoiceFile
                              ? "border-primary/40 bg-primary/5 text-primary"
                              : "border-border bg-secondary text-muted-foreground hover:border-primary/30 hover:bg-primary/5"
                          )}>
                            {portInvoiceFile ? (
                              <>
                                <Check className="h-4 w-4 shrink-0 text-primary" />
                                <span className="truncate text-xs font-medium">{portInvoiceFile.name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); handleInvoiceFile(null) }}
                                  className="ml-auto shrink-0 rounded-full p-0.5 hover:bg-primary/10"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 shrink-0" />
                                <span className="text-xs">Tap to upload bill</span>
                              </>
                            )}
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              className="hidden"
                              onChange={(e) => handleInvoiceFile(e.target.files?.[0] || null)}
                            />
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setPortStep(1)} className="flex-1 rounded-xl border border-border/70 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted">Back</button>
                          <button onClick={() => setPortStep(3)} disabled={!portAccountName || !portAuthPerson || !portInvoiceFile} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">Next: Address</button>
                        </div>
                      </>
                    )}

                    {/* Step 3: Service address + submit */}
                    {portStep === 3 && (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            Enter the address on file with your current carrier. This must match their records for the transfer to go through.
                          </p>
                          <StoryPopoverInfo storyKey="port-step3-address" label="About port address step" triggerClassName="h-7 w-7 shrink-0" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Street address</label>
                          <input type="text" placeholder="123 Main St" value={portStreet} onChange={(e) => setPortStreet(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" autoFocus />
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-semibold text-muted-foreground">City</label>
                            <input type="text" placeholder="City" value={portCity} onChange={(e) => setPortCity(e.target.value)} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-semibold text-muted-foreground">State</label>
                            <input type="text" placeholder="KY" maxLength={2} value={portState} onChange={(e) => setPortState(e.target.value.toUpperCase())} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-semibold text-muted-foreground">ZIP</label>
                            <input type="text" placeholder="40000" maxLength={5} value={portZip} onChange={(e) => setPortZip(e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                          </div>
                        </div>
                        {portError && <p className="text-xs text-destructive">{portError}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => setPortStep(2)} disabled={portSubmitLoading} className="flex-1 rounded-xl border border-border/70 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50">Back</button>
                          <button onClick={handlePortSubmit} disabled={!portStreet || !portCity || !portState || !portZip || portSubmitLoading} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
                            {portSubmitLoading ? (<><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Submitting...</>) : "Submit port request"}
                          </button>
                        </div>
                        <p className="text-center text-[10px] text-muted-foreground">
                          By submitting, you authorize the transfer of this number to {SITE_NAME}.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Per-number routing picker modal */}
      {routingModalNumber && (
        <>
          <div
            className="fixed inset-0 z-[60] animate-in fade-in-0 bg-background/60 backdrop-blur-sm duration-150"
            onClick={() => setRoutingModalNumber(null)}
            aria-hidden="true"
          />
          <div className="fixed inset-x-4 top-16 z-[70] mx-auto max-h-[calc(100dvh-5rem)] max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-card pb-3 shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200 [-webkit-overflow-scrolling:touch]">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <div className="flex min-w-0 items-start gap-1">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">Route Calls</h3>
                  <p className="text-xs text-muted-foreground">{formatPhoneDisplay(routingModalNumber)}</p>
                </div>
                <StoryPopoverInfo storyKey="route-modal-overview" label="About Route calls modal" triggerClassName="h-8 w-8" />
              </div>
              <button
                onClick={() => setRoutingModalNumber(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Business name: always editable here; PATCH /api/numbers/[id]. */}
            <div className="border-b border-border px-4 py-3">
              {(() => {
                const row = myNumbers.find((n) => n.number === routingModalNumber)
                return (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="sigo-settings-line-label" className="text-[11px] font-semibold text-muted-foreground">
                        Line label
                      </label>
                      <StoryPopoverInfo storyKey="route-modal-line-label" label="About line label" triggerClassName="h-7 w-7" />
                    </div>
                    <input
                      id="sigo-settings-line-label"
                      type="text"
                      value={routingLineLabelDraft}
                      onChange={(e) => setRoutingLineLabelDraft(e.target.value)}
                      placeholder="e.g. Main office, Dispatch"
                      maxLength={120}
                      className="mt-1.5 w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                    <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                      Name this line for your team (for example Dispatch or Main). Caller ID while ringing is{" "}
                      {formatPhoneDisplay(routingModalNumber)}. If the whisper is on in Settings, your team hears this
                      line label only, right after they answer (before the caller is connected).
                    </p>
                    {routingLineLabelError ? (
                      <p className="mt-1.5 text-[11px] text-destructive">{routingLineLabelError}</p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRoutingLineLabelDraft(row?.label ?? "")
                          setRoutingLineLabelError(null)
                        }}
                        disabled={routingLineLabelSaving}
                        className="flex-1 rounded-xl border border-border/70 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveRoutingLineLabel()}
                        disabled={routingLineLabelSaving}
                        className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {routingLineLabelSaving ? "Saving…" : "Save name"}
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>

            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">First ring</p>
              <StoryPopoverInfo storyKey="route-modal-first-ring" label="About first ring target" triggerClassName="h-7 w-7" />
            </div>
            <div className="flex flex-col py-1" role="listbox" aria-label="Select who receives calls for this number">
              {/* Option: Your Phone (owner) */}
              {(() => {
                const currentRouting = getRoutingForNumber(routingModalNumber)
                const isOwnerSelected = !currentRouting.receptionist && !currentRouting.isDefault
                const isOwnerDefault = !currentRouting.receptionist && currentRouting.isDefault
                return (
                  <button
                    onClick={() => saveNumberRouting(routingModalNumber, null)}
                    disabled={routingSaving}
                    role="option"
                    aria-selected={isOwnerSelected}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50",
                      isOwnerSelected || isOwnerDefault ? "bg-secondary/50" : "hover:bg-secondary"
                    )}
                  >
                    <div className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full",
                      isOwnerSelected || isOwnerDefault ? "bg-foreground/15" : "bg-muted-foreground/15"
                    )}>
                      <User className="h-4 w-4 text-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight text-foreground">Your Phone</p>
                      <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(user?.phone)} (owner)</p>
                    </div>
                    {(isOwnerSelected || isOwnerDefault) && (
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                        {isOwnerDefault ? "Default" : "Selected"}
                      </span>
                    )}
                  </button>
                )
              })()}

              {receptionistsList.length > 0 && (
                <>
                  <div className="mx-4 border-b border-border" />
                  <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Receptionists
                  </p>
                </>
              )}

              {receptionistsList.map((rec) => {
                const currentRouting = getRoutingForNumber(routingModalNumber)
                const isSelected = currentRouting.receptionist?.id === rec.id
                return (
                  <button
                    key={rec.id}
                    onClick={() => saveNumberRouting(routingModalNumber, rec.id)}
                    disabled={routingSaving}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50",
                      isSelected ? "bg-primary/5" : "hover:bg-secondary"
                    )}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className={cn(rec.color, "text-primary-foreground text-[10px] font-semibold")}>
                        {rec.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight text-foreground">{rec.name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatPhoneDisplay(rec.phone)}</p>
                    </div>
                    {isSelected && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Selected
                      </span>
                    )}
                  </button>
                )
              })}

              {receptionistsList.length === 0 && (
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    No receptionists yet. Open the <span className="font-medium text-foreground">Team</span> tab to add
                    people who can answer for you.
                  </p>
                </div>
              )}
            </div>

            {routingSaving && (
              <div className="flex items-center justify-center gap-2 border-t border-border py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Saving…</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Account */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Account
          </h3>
          <SheetInfoTrigger
            onPress={() => setSettingsStorySheet("account-section")}
            label="About account and support"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          You can also open your profile in the{" "}
          <span className="font-medium text-foreground">top-right corner</span> on any screen for Help, Settings, and Sign
          out.
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex overflow-hidden rounded-2xl border border-border/70 bg-card/85 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5">
            <a
              href={process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL || "/privacy"}
              target={process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL ? "_blank" : undefined}
              rel={process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL ? "noopener noreferrer" : undefined}
              className="flex min-w-0 flex-1 items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <IconSurface>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </IconSurface>
                <p className="text-sm font-medium text-foreground">
                  Security & Privacy
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </a>
            <div className="flex shrink-0 items-center border-l border-border/60 bg-card/85">
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("security-privacy")}
                label="About security and privacy"
              />
            </div>
          </div>

          <div className="flex overflow-hidden rounded-2xl border border-border/70 bg-card/85 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5">
            <Link
              href="/dashboard/help"
              className="flex min-w-0 flex-1 items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <IconSurface>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </IconSurface>
                <p className="text-sm font-medium text-foreground">Help, pricing & feedback</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
            <div className="flex shrink-0 items-center border-l border-border/60 bg-card/85">
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("help-feedback")}
                label="About help and feedback"
              />
            </div>
          </div>

          <div className="flex overflow-hidden rounded-2xl border border-destructive/25 bg-card/85 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-destructive/10">
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true)
                void signOutAndGoToLogin().finally(() => setSigningOut(false))
              }}
              className="flex min-w-0 flex-1 items-center justify-between p-4 text-left disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <IconSurface tone="danger">
                  <LogOut className="h-4 w-4 text-destructive" />
                </IconSurface>
                <p className="text-sm font-medium text-destructive">{signingOut ? "Signing out…" : "Sign out"}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
            <div className="flex shrink-0 items-center border-l border-destructive/25 bg-card/85">
              <SheetInfoTrigger
                onPress={() => setSettingsStorySheet("sign-out")}
                label="About signing out"
              />
            </div>
          </div>
        </div>
      </section>

      <Sheet open={settingsStorySheet != null} onOpenChange={(open) => !open && setSettingsStorySheet(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {(() => {
            const story = settingsStorySheet ? getAppSheetStory(settingsStorySheet) : null
            if (!settingsStorySheet) return null
            if (!story) {
              return (
                <div className="p-6 text-sm text-muted-foreground">
                  No story is defined for this control yet. Try another ⓘ icon.
                </div>
              )
            }
            return (
              <>
                <StorySheetHeader {...story} />
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Prefer changing who answers? Open{" "}
                    <Link href="/dashboard" className="font-medium text-primary underline-offset-4 hover:underline">
                      Call console (Routing)
                    </Link>
                    .
                  </p>
                </div>
                <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground">
                    Settings explains behavior; live call paths follow your routing and Telnyx configuration.
                  </p>
                </SheetFooter>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>

      <PortingOrderCommentsDialog
        orderId={portingMsgs?.id ?? null}
        phoneLabel={portingMsgs ? formatPhoneDisplay(portingMsgs.number) : ""}
        open={portingMsgs !== null}
        onOpenChange={(o) => {
          if (!o) setPortingMsgs(null)
        }}
        allowReply={portingMsgs?.allowReply ?? false}
      />

      {/* Version */}
      <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <BrandWordmark size="xs" />
        <span className="text-muted-foreground/80" aria-hidden>
          ·
        </span>
        <span>v1.0.0</span>
      </p>
    </div>
  )
}
