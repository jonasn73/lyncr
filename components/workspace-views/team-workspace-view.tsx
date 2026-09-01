"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, HardHat, Loader2, Network, Plus, Save, Send, Trash2, Users, UsersRound } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { FieldTechnician, Receptionist, ReceptionistPayoutMetrics } from "@/lib/types"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  notifyTeamRosterChanged,
  openTeamInviteModal,
  TEAM_ROSTER_CHANGED_EVENT,
} from "@/lib/team-invite-events"
import {
  PayPlanEditor,
  usePayPlans,
  type PayPlanTarget,
} from "@/components/compensation/pay-plan-editor"
import {
  ReceptionistAccessEditor,
  FieldTechAccessEditor,
  type CapabilityFlags,
} from "@/components/team/receptionist-access-editor"
import {
  ReceptionistAccountEditor,
  FieldTechAccountEditor,
  type TeamMemberAccountTarget,
} from "@/components/team/team-member-account-editor"
import { ReceptionistSettingsSheet } from "@/components/team/receptionist-settings-sheet"
import { TechnicianSettingsSheet } from "@/components/team/technician-settings-sheet"
import { AddTechnicianModal } from "@/components/team/add-technician-modal"
import { TechInviteSmsAlert } from "@/components/team/tech-invite-sms-alert"
import { TeamLiveRoster } from "@/components/workspace-views/team-live-roster"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { TechInviteSmsErrorType } from "@/lib/tech-invite-sms-types"
import type { ReceptionistCapabilities, FieldTechnicianCapabilities, TeamInvite } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Role = "receptionist" | "field_tech"

/** What the confirm dialog is about to delete. */
type PendingRemove =
  | { kind: "member"; role: Role; id: string; name: string }
  | { kind: "invite"; id: string; name: string }

type TechInviteResult = {
  name: string
  phone: string
  expires_at?: string
  setup_url: string
  sms_sent: boolean
  sms_error: string | null
  success?: boolean
  errorType?: TechInviteSmsErrorType
  message?: string
}

const AVATAR_COLORS = ["bg-primary", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

/**
 * Owner-authored script shown to the live Lyncr operators answering this business's calls.
 * Loads/saves onboarding_profiles.routing_instructions via /api/team/instructions.
 */
function NetworkInstructionsPanel() {
  const [text, setText] = useState("")
  const [baseline, setBaseline] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/team/instructions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { routing_instructions?: string } }) => {
        if (cancelled) return
        const v = j.data?.routing_instructions ?? ""
        setText(v)
        setBaseline(v)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = text !== baseline

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/team/instructions", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing_instructions: text }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        data?: { routing_instructions?: string }
        error?: string
      }
      if (!res.ok) throw new Error(j.error || "Could not save instructions")
      const v = j.data?.routing_instructions ?? text
      setText(v)
      setBaseline(v)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save instructions")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setJustSaved(false)
        }}
        disabled={!loaded || saving}
        rows={9}
        placeholder={
          "ALERT: Fully booked for key copies today — only accept emergency car lockouts!\n" +
          "Business hours: Mon–Fri 8am–6pm, closed weekends\n" +
          "Greeting: \"Thanks for calling Ace Mobile Detailing, how can I help?\"\n" +
          "Pricing: Basic wash $40 · Full detail from $150 — quote ranges only, never commit a final price\n" +
          "Always collect: caller name, callback number, vehicle, service needed, and ZIP"
        }
        className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-background/60 px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
      />

      {error ? (
        <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-2xs text-muted-foreground">
          {!loaded ? "Loading…" : `${text.length.toLocaleString()} characters`}
        </span>
        <div className="flex items-center gap-3">
          {justSaved ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!loaded || saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {saving ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </div>
    </div>
  )
}

export const TeamWorkspaceView = memo(function TeamWorkspaceView() {
  const { toast } = useToast()
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const orgId = activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const realOrganizations = useMemo(() => organizations.filter((org) => !org.id.startsWith("legacy-")), [organizations])
  const showWorkspacePicker = realOrganizations.length > 1

  // Receptionists
  const [members, setMembers] = useState<Receptionist[]>([])
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([])
  const [payoutsById, setPayoutsById] = useState<Record<string, ReceptionistPayoutMetrics>>({})
  const [billingCycleLabel, setBillingCycleLabel] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null)
  const [inviteBusyKind, setInviteBusyKind] = useState<"copy" | "resend" | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [resentInviteId, setResentInviteId] = useState<string | null>(null)
  const [inviteActionError, setInviteActionError] = useState<{ id: string; message: string } | null>(null)

  // Field techs
  const [techs, setTechs] = useState<FieldTechnician[]>([])
  const [techModalOpen, setTechModalOpen] = useState(false)
  const [techInviteAlert, setTechInviteAlert] = useState<TechInviteResult | null>(null)
  const [techTogglingId, setTechTogglingId] = useState<string | null>(null)
  const [techResentId, setTechResentId] = useState<string | null>(null)
  const [techMovingId, setTechMovingId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRoutingTip, setShowRoutingTip] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Popups that used to be permanently-visible panels.
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [liveRosterOpen, setLiveRosterOpen] = useState(false)

  // Shared editors — role-agnostic dialogs, just pointed at the right endpoint.
  const { plans, reload: reloadPlans } = usePayPlans()
  const [payTarget, setPayTarget] = useState<PayPlanTarget | null>(null)
  const [accessTarget, setAccessTarget] = useState<
    { role: Role; id: string; name: string; capabilities: CapabilityFlags } | null
  >(null)
  const [accountTarget, setAccountTarget] = useState<(TeamMemberAccountTarget & { role: Role }) | null>(null)

  // One settings sheet per person, opened by tapping their row. Keyed by id (not a snapshot)
  // so it always reflects the latest members/techs row after Pay/Access/Account save.
  const [settingsTarget, setSettingsTarget] = useState<{ id: string; color: string; role: Role } | null>(null)
  const settingsMember =
    settingsTarget?.role === "receptionist" ? members.find((m) => m.id === settingsTarget.id) ?? null : null
  const settingsTech =
    settingsTarget?.role === "field_tech" ? techs.find((t) => t.id === settingsTarget.id) ?? null : null

  const hasLoadedOnceRef = useRef(false)
  const load = useCallback(() => {
    if (!hasLoadedOnceRef.current) setLoading(true)
    const techQs = organizationQueryString(orgId)
    Promise.all([
      fetch("/api/receptionists", { credentials: "include" }).then(async (res) => {
        if (!res.ok) throw new Error("Could not load team")
        const json = (await res.json()) as { data?: Receptionist[] }
        return Array.isArray(json.data) ? json.data : []
      }),
      fetch("/api/receptionists/payouts", { credentials: "include" }).then(async (res) => {
        if (!res.ok) return null
        const json = (await res.json()) as {
          data?: {
            billing_cycle?: { start?: string; end?: string }
            agents?: ReceptionistPayoutMetrics[]
          }
        }
        return json.data ?? null
      }),
      fetch("/api/team/invites", { credentials: "include" }).then(async (res) => {
        if (!res.ok) return [] as TeamInvite[]
        const json = (await res.json()) as { data?: TeamInvite[] }
        return Array.isArray(json.data) ? json.data : []
      }),
      fetch(`/api/technicians${techQs}`, { credentials: "include" }).then(async (res) => {
        if (!res.ok) return [] as FieldTechnician[]
        const json = (await res.json()) as { data?: FieldTechnician[] }
        return Array.isArray(json.data) ? json.data : []
      }),
    ])
      .then(([rows, payoutData, invites, techRows]) => {
        setMembers(rows)
        setAvailability(Object.fromEntries(rows.map((m) => [m.id, m.is_active])))
        const byId = Object.fromEntries((payoutData?.agents ?? []).map((agent) => [agent.receptionist_id, agent]))
        setPayoutsById(byId)
        const start = payoutData?.billing_cycle?.start
        const end = payoutData?.billing_cycle?.end
        if (start && end) {
          const startDate = new Date(start)
          const endDate = new Date(end)
          setBillingCycleLabel(
            `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          )
        } else {
          setBillingCycleLabel(null)
        }
        setPendingInvites(invites.filter((i) => i.status === "PENDING" && !i.accepted_at))
        setTechs(techRows)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => {
        hasLoadedOnceRef.current = true
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === "added") setShowRoutingTip(true)
      load()
    }
    window.addEventListener(TEAM_ROSTER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(TEAM_ROSTER_CHANGED_EVENT, onChanged)
  }, [load])

  function isMemberOnline(member: Receptionist): boolean {
    return availability[member.id] ?? member.is_active
  }

  async function toggleActive(member: Receptionist) {
    const next = !isMemberOnline(member)
    setAvailability((prev) => ({ ...prev, [member.id]: next }))
    setTogglingId(member.id)
    try {
      const res = await fetch(`/api/receptionists/${member.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) throw new Error("Update failed")
      const json = (await res.json()) as { data?: Receptionist }
      if (json.data) {
        setMembers((prev) => prev.map((m) => (m.id === member.id ? json.data! : m)))
        setAvailability((prev) => ({ ...prev, [member.id]: json.data!.is_active }))
      }
    } catch {
      setAvailability((prev) => ({ ...prev, [member.id]: !next }))
      setError("Could not update availability")
    } finally {
      setTogglingId(null)
    }
  }

  async function toggleTechActive(tech: FieldTechnician) {
    const next = !tech.is_active
    setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, is_active: next } : t)))
    setTechTogglingId(tech.id)
    try {
      const res = await fetch(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) throw new Error("failed")
    } catch {
      setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, is_active: !next } : t)))
    } finally {
      setTechTogglingId(null)
    }
  }

  async function moveTech(tech: FieldTechnician, nextOrgId: string | null) {
    const previous = tech.organization_id ?? null
    if (nextOrgId === previous) return
    setTechMovingId(tech.id)
    setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, organization_id: nextOrgId } : t)))
    try {
      const res = await fetch(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: nextOrgId }),
      })
      if (!res.ok) throw new Error("move failed")
      if (orgId && nextOrgId !== orgId) {
        setTechs((prev) => prev.filter((t) => t.id !== tech.id))
        setSettingsTarget(null)
      }
    } catch {
      setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, organization_id: previous } : t)))
    } finally {
      setTechMovingId(null)
    }
  }

  async function resendTechInvite(tech: FieldTechnician) {
    setTechResentId(tech.id)
    try {
      const res = await fetch("/api/tech/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technicianId: tech.id }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        success?: boolean
        errorType?: TechInviteSmsErrorType
        message?: string
        data?: { setup_url?: string; sms_error?: string | null; expires_at?: string }
      }
      if (!res.ok || j.success === false) {
        const setupUrl = j.data?.setup_url
        setSettingsTarget(null)
        setTechInviteAlert({
          name: tech.name,
          phone: tech.phone,
          expires_at: j.data?.expires_at ?? "",
          setup_url: setupUrl ?? "",
          sms_sent: false,
          sms_error: j.data?.sms_error ?? null,
          success: false,
          errorType: j.errorType,
          message: j.message,
        })
        setTechResentId(null)
        return
      }
      toast({ title: "Invite text sent" })
      setTimeout(() => setTechResentId((id) => (id === tech.id ? null : id)), 2500)
    } catch {
      setTechResentId(null)
      toast({ title: "Network error", description: "Please try again." })
    }
  }

  /** Call resend API; optionally skip email (for Copy link when token may need refresh). */
  async function callInviteResend(
    inviteId: string,
    sendEmail: boolean
  ): Promise<{ register_url: string; email_sent: boolean; email_error: string | null } | null> {
    const res = await fetch(`/api/team/invites/${encodeURIComponent(inviteId)}/resend`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ send_email: sendEmail }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      data?: { register_url?: string; email_sent?: boolean; email_error?: string | null }
    }
    if (!res.ok || !json.data?.register_url) {
      throw new Error(json.error || "Could not get invite link")
    }
    return {
      register_url: json.data.register_url,
      email_sent: Boolean(json.data.email_sent),
      email_error: json.data.email_error ?? null,
    }
  }

  async function copyInviteLink(inv: TeamInvite) {
    setInviteBusyId(inv.id)
    setInviteBusyKind("copy")
    setInviteActionError(null)
    try {
      const data = await callInviteResend(inv.id, false)
      if (!data) return
      try {
        await navigator.clipboard.writeText(data.register_url)
      } catch {
        setInviteActionError({
          id: inv.id,
          message: "Could not copy — try again, or share the link from a new invite.",
        })
        return
      }
      setCopiedInviteId(inv.id)
      toast({ title: "Link copied" })
      setTimeout(() => setCopiedInviteId((id) => (id === inv.id ? null : id)), 2000)
    } catch (e) {
      setInviteActionError({
        id: inv.id,
        message: e instanceof Error ? e.message : "Could not copy invite link",
      })
    } finally {
      setInviteBusyId(null)
      setInviteBusyKind(null)
    }
  }

  async function resendInvite(inv: TeamInvite) {
    const hasEmail = Boolean(inv.email?.includes("@"))
    if (!hasEmail) {
      setInviteActionError({
        id: inv.id,
        message: "This invite has no email — use Copy link and share it yourself.",
      })
      return
    }
    setInviteBusyId(inv.id)
    setInviteBusyKind("resend")
    setInviteActionError(null)
    try {
      const data = await callInviteResend(inv.id, true)
      if (!data) return
      if (data.email_sent) {
        setResentInviteId(inv.id)
        toast({ title: "Invite email sent" })
        setTimeout(() => setResentInviteId((id) => (id === inv.id ? null : id)), 2500)
      } else {
        setInviteActionError({
          id: inv.id,
          message: data.email_error || "Email was not sent — use Copy link to share it yourself.",
        })
      }
    } catch (e) {
      setInviteActionError({
        id: inv.id,
        message: e instanceof Error ? e.message : "Could not resend invite",
      })
    } finally {
      setInviteBusyId(null)
      setInviteBusyKind(null)
    }
  }

  async function confirmRemove() {
    if (!pendingRemove) return
    setRemoving(true)
    setRemoveError(null)
    try {
      if (pendingRemove.kind === "member" && pendingRemove.role === "receptionist") {
        const res = await fetch(`/api/receptionists/${pendingRemove.id}`, { method: "DELETE", credentials: "include" })
        if (!res.ok) throw new Error("Could not remove team member")
        setMembers((prev) => prev.filter((m) => m.id !== pendingRemove.id))
        setAvailability((prev) => {
          const next = { ...prev }
          delete next[pendingRemove.id]
          return next
        })
      } else if (pendingRemove.kind === "member" && pendingRemove.role === "field_tech") {
        const res = await fetch(`/api/technicians/${pendingRemove.id}`, { method: "DELETE", credentials: "include" })
        if (!res.ok) throw new Error("Could not remove technician")
        setTechs((prev) => prev.filter((t) => t.id !== pendingRemove.id))
      } else {
        const res = await fetch(`/api/team/invites?id=${encodeURIComponent(pendingRemove.id)}`, {
          method: "DELETE",
          credentials: "include",
        })
        if (!res.ok) throw new Error("Could not cancel invite")
        setPendingInvites((prev) => prev.filter((i) => i.id !== pendingRemove.id))
      }
      notifyTeamRosterChanged({ action: "removed" })
      setSettingsTarget(null)
      setPendingRemove(null)
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Could not remove")
    } finally {
      setRemoving(false)
    }
  }

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members]
  )
  const activeTechs = useMemo(() => techs.filter((t) => !t.invite_pending).sort((a, b) => a.name.localeCompare(b.name)), [techs])
  const pendingTechs = useMemo(() => techs.filter((t) => t.invite_pending), [techs])
  const totalWaiting = pendingInvites.length + pendingTechs.length
  const totalTeam = members.length + techs.length

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="Dispatch" title="Team" />

      <WorkspacePanel density="compact">
        <p className="text-sm leading-relaxed text-foreground">
          Add people who can answer your calls or work jobs.{" "}
          <span className="font-medium text-foreground">Receptionists</span> ring their cell or web console when
          picked under Who answers. <span className="font-medium text-foreground">Technicians</span> get dispatched
          jobs from your mobile console.
        </p>
      </WorkspacePanel>

      {showRoutingTip ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            Nice — next, set <span className="font-semibold">Who answers</span> so calls reach them.
          </p>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Open Who answers
            </a>
            <button type="button" onClick={() => setShowRoutingTip(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Action bar: add either role, and pop out the two things that used to eat the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openTeamInviteModal()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add receptionist
        </button>
        <button
          type="button"
          onClick={() => {
            setTechModalOpen(true)
            setTechInviteAlert(null)
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add technician
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLiveRosterOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <UsersRound className="h-3.5 w-3.5" aria-hidden /> Live roster
          </button>
          <button
            type="button"
            onClick={() => setInstructionsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Network className="h-3.5 w-3.5" aria-hidden /> Instructions
          </button>
        </div>
      </div>

      {techInviteAlert ? (
        <TechInviteSmsAlert
          name={techInviteAlert.name}
          phone={techInviteAlert.phone}
          setupUrl={techInviteAlert.setup_url}
          smsSent={techInviteAlert.sms_sent}
          success={techInviteAlert.success}
          errorType={techInviteAlert.errorType}
          message={techInviteAlert.message}
          smsError={techInviteAlert.sms_error}
        />
      ) : null}

      {/* The main view: one list of everyone, both roles, active first, pending after. */}
      <WorkspacePanel density="default">
        {billingCycleLabel ? (
          <div className="mb-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-2xs text-muted-foreground">
            Receptionist payout totals · billing cycle {billingCycleLabel}
          </div>
        ) : null}

        {error ? (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading team…
          </div>
        ) : totalTeam === 0 && totalWaiting === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/60 text-muted-foreground">
              <Users className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">No one added yet.</p>
            <p className="max-w-[18rem] text-xs text-muted-foreground">
              Add a receptionist or technician above to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {totalTeam > 0 ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {sortedMembers.map((member, i) => {
                  const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
                  const online = isMemberOnline(member)
                  const payout = payoutsById[member.id]
                  return (
                    <li key={`r-${member.id}`}>
                      <button
                        type="button"
                        onClick={() => setSettingsTarget({ id: member.id, color, role: "receptionist" })}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60"
                      >
                        <div className="relative shrink-0">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className={cn("text-xs font-semibold text-primary-foreground", color)}>
                              {initials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                              online ? "bg-success" : "bg-muted-foreground"
                            )}
                            aria-hidden
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                              Receptionist
                            </span>
                            {member.account_locked ? (
                              <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-destructive">
                                Locked
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{formatPhoneDisplay(member.phone)}</p>
                        </div>
                        {payout ? (
                          <p className="shrink-0 text-right text-2xs text-muted-foreground">
                            {formatUsd(payout.total_earnings)}
                            <span className="block text-muted-foreground">this cycle</span>
                          </p>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
                {activeTechs.map((tech, i) => (
                  <li key={`t-${tech.id}`}>
                    <button
                      type="button"
                      onClick={() =>
                        setSettingsTarget({
                          id: tech.id,
                          color: AVATAR_COLORS[(sortedMembers.length + i) % AVATAR_COLORS.length],
                          role: "field_tech",
                        })
                      }
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback
                            className={cn(
                              "text-xs font-semibold text-primary-foreground",
                              AVATAR_COLORS[(sortedMembers.length + i) % AVATAR_COLORS.length]
                            )}
                          >
                            {initials(tech.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                            tech.is_active ? "bg-success" : "bg-muted-foreground"
                          )}
                          aria-hidden
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-foreground">{tech.name}</p>
                          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-warning">
                            Technician
                          </span>
                          {tech.account_locked ? (
                            <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-destructive">
                              Locked
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{formatPhoneDisplay(tech.phone)}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {totalWaiting > 0 ? (
              <div>
                <p className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wide text-warning/90">
                  Waiting to accept ({totalWaiting})
                </p>
                <ul className="divide-y divide-border rounded-xl border border-warning/20 bg-warning/5">
                  {pendingInvites.map((inv) => {
                    const inviteLabel = inv.first_name || inv.email || inv.phone || "Invite"
                    const hasEmail = Boolean(inv.email?.includes("@"))
                    const busy = inviteBusyId === inv.id
                    return (
                      <li key={`inv-${inv.id}`} className="space-y-2 px-3.5 py-3">
                        <div className="flex items-center gap-1.5">
                          <p className="min-w-0 truncate text-sm font-medium text-foreground">{inviteLabel}</p>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                            Receptionist
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{inv.email || inv.phone || "link sent"}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void copyInviteLink(inv)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                          >
                            {busy && inviteBusyKind === "copy" ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            ) : copiedInviteId === inv.id ? (
                              <Check className="h-3 w-3 text-success" aria-hidden />
                            ) : (
                              <Copy className="h-3 w-3" aria-hidden />
                            )}
                            {copiedInviteId === inv.id ? "Copied" : "Copy link"}
                          </button>
                          {hasEmail ? (
                            <button
                              type="button"
                              onClick={() => void resendInvite(inv)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                            >
                              {busy && inviteBusyKind === "resend" ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                              ) : resentInviteId === inv.id ? (
                                <Check className="h-3 w-3 text-success" aria-hidden />
                              ) : (
                                <Send className="h-3 w-3" aria-hidden />
                              )}
                              {resentInviteId === inv.id ? "Sent" : "Resend"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setPendingRemove({ kind: "invite", id: inv.id, name: inviteLabel })}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden />
                            Cancel
                          </button>
                        </div>
                        {inviteActionError?.id === inv.id ? (
                          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-2 text-2xs leading-snug text-destructive">
                            {inviteActionError.message}
                          </p>
                        ) : null}
                      </li>
                    )
                  })}
                  {pendingTechs.map((tech) => (
                    <li key={`pt-${tech.id}`}>
                      <button
                        type="button"
                        onClick={() => setSettingsTarget({ id: tech.id, color: AVATAR_COLORS[0], role: "field_tech" })}
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-warning/10"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-foreground">{tech.name}</p>
                            <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-warning">
                              Technician
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{formatPhoneDisplay(tech.phone)} · setup pending</p>
                        </div>
                        <HardHat className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </WorkspacePanel>

      {/* Popups: what used to permanently occupy the page. */}
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className="border-border bg-background text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" aria-hidden /> Live Instruction Script
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Dispatch notes, active pricing scripts, and immediate alerts for the live operators on your line.
            </DialogDescription>
          </DialogHeader>
          <NetworkInstructionsPanel />
        </DialogContent>
      </Dialog>

      <Dialog open={liveRosterOpen} onOpenChange={setLiveRosterOpen}>
        <DialogContent className="border-border bg-background p-0 text-foreground sm:max-w-md">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="flex items-center gap-2">
              <UsersRound className="h-4 w-4 text-primary" aria-hidden /> Live roster
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Real-time technician availability and job status.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-4">
            <TeamLiveRoster isActive={liveRosterOpen} />
          </div>
        </DialogContent>
      </Dialog>

      <PayPlanEditor
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onSaved={(summary) => {
          void reloadPlans()
          toast({ title: "Pay updated", description: summary })
        }}
      />

      {accessTarget?.role === "receptionist" ? (
        <ReceptionistAccessEditor
          target={accessTarget}
          onClose={() => setAccessTarget(null)}
          onSaved={(capabilities) => {
            const saved = capabilities as unknown as ReceptionistCapabilities
            setMembers((prev) => prev.map((m) => (m.id === accessTarget.id ? { ...m, capabilities: saved } : m)))
            toast({ title: "Access updated" })
          }}
        />
      ) : null}
      {accessTarget?.role === "field_tech" ? (
        <FieldTechAccessEditor
          target={accessTarget}
          onClose={() => setAccessTarget(null)}
          onSaved={(capabilities) => {
            const saved = capabilities as unknown as FieldTechnicianCapabilities
            setTechs((prev) => prev.map((t) => (t.id === accessTarget.id ? { ...t, capabilities: saved } : t)))
            toast({ title: "Access updated" })
          }}
        />
      ) : null}

      {accountTarget?.role === "receptionist" ? (
        <ReceptionistAccountEditor
          target={accountTarget}
          onClose={() => setAccountTarget(null)}
          onSaved={(patch) => {
            setMembers((prev) =>
              prev.map((m) =>
                m.id === accountTarget.id
                  ? {
                      ...m,
                      name: patch.name,
                      phone: patch.phone,
                      contact_email: patch.contactEmail,
                      address: patch.address,
                      account_locked: patch.accountLocked,
                    }
                  : m
              )
            )
            toast({ title: "Details updated" })
          }}
        />
      ) : null}
      {accountTarget?.role === "field_tech" ? (
        <FieldTechAccountEditor
          target={accountTarget}
          onClose={() => setAccountTarget(null)}
          onSaved={(patch) => {
            setTechs((prev) =>
              prev.map((t) =>
                t.id === accountTarget.id
                  ? {
                      ...t,
                      name: patch.name,
                      phone: patch.phone,
                      contact_email: patch.contactEmail,
                      address: patch.address,
                      account_locked: patch.accountLocked,
                    }
                  : t
              )
            )
            toast({ title: "Details updated" })
          }}
        />
      ) : null}

      <ReceptionistSettingsSheet
        member={settingsMember}
        avatarColor={settingsTarget?.color ?? AVATAR_COLORS[0]}
        online={settingsMember ? isMemberOnline(settingsMember) : false}
        togglingActive={settingsMember ? togglingId === settingsMember.id : false}
        plan={settingsMember ? plans[settingsMember.id] : undefined}
        payout={settingsMember ? payoutsById[settingsMember.id] : undefined}
        onToggleActive={() => settingsMember && void toggleActive(settingsMember)}
        onEditPay={() =>
          settingsMember &&
          setPayTarget({
            kind: "receptionist",
            id: settingsMember.id,
            name: settingsMember.name,
            employmentType: plans[settingsMember.id]?.employment_type ?? "UNSPECIFIED",
            components: plans[settingsMember.id]?.components ?? [],
          })
        }
        onEditAccess={() =>
          settingsMember &&
          setAccessTarget({ role: "receptionist", id: settingsMember.id, name: settingsMember.name, capabilities: { ...settingsMember.capabilities } })
        }
        onEditAccount={() =>
          settingsMember &&
          setAccountTarget({
            role: "receptionist",
            id: settingsMember.id,
            name: settingsMember.name,
            phone: settingsMember.phone,
            contactEmail: settingsMember.contact_email ?? null,
            address: settingsMember.address ?? null,
            accountLocked: settingsMember.account_locked === true,
            hasLogin: Boolean(settingsMember.portal_user_id),
          })
        }
        onRemove={() => {
          if (settingsMember) {
            setRemoveError(null)
            setPendingRemove({ kind: "member", role: "receptionist", id: settingsMember.id, name: settingsMember.name })
          }
        }}
        onClose={() => setSettingsTarget(null)}
      />

      <TechnicianSettingsSheet
        member={settingsTech}
        avatarColor={settingsTarget?.color ?? AVATAR_COLORS[0]}
        togglingActive={settingsTech ? techTogglingId === settingsTech.id : false}
        plan={settingsTech ? plans[settingsTech.id] : undefined}
        showWorkspacePicker={showWorkspacePicker}
        organizations={realOrganizations}
        movingWorkspace={settingsTech ? techMovingId === settingsTech.id : false}
        onToggleActive={() => settingsTech && void toggleTechActive(settingsTech)}
        onMoveWorkspace={(nextOrgId) => settingsTech && void moveTech(settingsTech, nextOrgId)}
        onEditPay={() =>
          settingsTech &&
          setPayTarget({
            kind: "field_tech",
            id: settingsTech.id,
            name: settingsTech.name,
            employmentType: plans[settingsTech.id]?.employment_type ?? "UNSPECIFIED",
            components: plans[settingsTech.id]?.components ?? [],
          })
        }
        onEditAccess={() =>
          settingsTech &&
          setAccessTarget({ role: "field_tech", id: settingsTech.id, name: settingsTech.name, capabilities: { ...settingsTech.capabilities } })
        }
        onEditAccount={() =>
          settingsTech &&
          setAccountTarget({
            role: "field_tech",
            id: settingsTech.id,
            name: settingsTech.name,
            phone: settingsTech.phone,
            contactEmail: settingsTech.contact_email ?? null,
            address: settingsTech.address ?? null,
            accountLocked: settingsTech.account_locked === true,
            hasLogin: Boolean(settingsTech.portal_user_id),
          })
        }
        onResendInvite={() => settingsTech && void resendTechInvite(settingsTech)}
        resendBusy={settingsTech ? techResentId === settingsTech.id : false}
        resendSent={false}
        onRemove={() => {
          if (settingsTech) {
            setRemoveError(null)
            setPendingRemove({ kind: "member", role: "field_tech", id: settingsTech.id, name: settingsTech.name })
          }
        }}
        onClose={() => setSettingsTarget(null)}
      />

      <AddTechnicianModal
        open={techModalOpen}
        onOpenChange={setTechModalOpen}
        onSuccess={({ technicians, invite: inviteResult }) => {
          setTechs(technicians)
          if (inviteResult) setTechInviteAlert(inviteResult)
        }}
      />

      {/* Confirm before removing a person or canceling an invite. */}
      <AlertDialog
        open={pendingRemove != null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setPendingRemove(null)
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogContent className="border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemove?.kind === "invite"
                ? `Cancel invite for ${pendingRemove.name}?`
                : `Remove ${pendingRemove?.name ?? "this person"} from your team?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {pendingRemove?.kind === "invite"
                ? "Their invite link will stop working. You can send a new invite later."
                : "This can't be undone. Their login is blocked immediately, and their pay plan, earnings history, and shift records are permanently deleted. You can add them again later using the same phone number or email."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing} className="border-border bg-card">
              Keep
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(e) => {
                e.preventDefault()
                void confirmRemove()
              }}
            >
              {removing ? "Removing…" : pendingRemove?.kind === "invite" ? "Cancel invite" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  )
})
