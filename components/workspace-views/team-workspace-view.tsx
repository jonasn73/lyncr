"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Check, Copy, Loader2, Network, Plus, Save, Send, Trash2, Users } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Receptionist, ReceptionistPayoutMetrics } from "@/lib/types"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import Link from "next/link"
import {
  notifyTeamRosterChanged,
  openTeamInviteModal,
  TEAM_ROSTER_CHANGED_EVENT,
} from "@/lib/team-invite-events"
import { FieldTechniciansPanel } from "@/components/workspace-views/field-technicians-panel"
import { TeamLiveRoster } from "@/components/workspace-views/team-live-roster"
import type { TeamInvite } from "@/lib/types"
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

/** What the confirm dialog is about to delete. */
type PendingRemove =
  | { kind: "member"; id: string; name: string }
  | { kind: "invite"; id: string; name: string }

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
    <WorkspacePanel className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Network className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground sm:text-base">Live Instruction Script</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Dispatch notes, active pricing scripts, and immediate alerts for the live operators on your
              line — business hours, how to greet callers, and what details to collect on every call.
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          Live operators
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setJustSaved(false)
        }}
        disabled={!loaded || saving}
        rows={7}
        placeholder={
          "ALERT: Fully booked for key copies today — only accept emergency car lockouts!\n" +
          "Business hours: Mon–Fri 8am–6pm, closed weekends\n" +
          "Greeting: \"Thanks for calling Ace Mobile Detailing, how can I help?\"\n" +
          "Pricing: Basic wash $40 · Full detail from $150 — quote ranges only, never commit a final price\n" +
          "Always collect: caller name, callback number, vehicle, service needed, and ZIP"
        }
        className="mt-4 min-h-[160px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3 text-sm leading-relaxed text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
      />

      {error ? (
        <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-zinc-600">
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
    </WorkspacePanel>
  )
}

export const TeamWorkspaceView = memo(function TeamWorkspaceView() {
  const { toast } = useToast()
  const [members, setMembers] = useState<Receptionist[]>([])
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([])
  const [payoutsById, setPayoutsById] = useState<Record<string, ReceptionistPayoutMetrics>>({})
  const [billingCycleLabel, setBillingCycleLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [showRoutingTip, setShowRoutingTip] = useState(false)
  // Confirm-dialog target for removing a phone contact or canceling an invite.
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null)
  const [removing, setRemoving] = useState(false)
  // Pending-invite row actions (Copy link / Resend) — match Field Technicians pattern.
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null)
  const [inviteBusyKind, setInviteBusyKind] = useState<"copy" | "resend" | null>(null)
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [resentInviteId, setResentInviteId] = useState<string | null>(null)
  const [inviteActionError, setInviteActionError] = useState<{ id: string; message: string } | null>(
    null
  )

  const load = useCallback(() => {
    setLoading(true)
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
    ])
      .then(([rows, payoutData, invites]) => {
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
        // Only show invites that have not been accepted yet.
        setPendingInvites(invites.filter((i) => i.status === "PENDING" && !i.accepted_at))
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Reload after Add phone / Create invite succeeds in the shared modal.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      // Only nudge “Who answers” after someone was added — not after a remove.
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

  /** Copy a working register link for a pending invite (refreshes token if near expiry). */
  async function copyInviteLink(inv: TeamInvite) {
    setInviteBusyId(inv.id)
    setInviteBusyKind("copy")
    setInviteActionError(null)
    try {
      // Ask the server for a valid register URL (may refresh an expired token).
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

  /** Re-send the invite email (same Resend helper as Create invite). */
  async function resendInvite(inv: TeamInvite) {
    const hasEmail = Boolean(inv.email?.includes("@"))
    // SMS-only invites: no email to resend — nudge Copy link instead.
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

  /** Run the confirmed delete for a phone contact or pending invite. */
  async function confirmRemove() {
    if (!pendingRemove) return
    setRemoving(true)
    setError(null)
    try {
      if (pendingRemove.kind === "member") {
        const res = await fetch(`/api/receptionists/${pendingRemove.id}`, {
          method: "DELETE",
          credentials: "include",
        })
        if (!res.ok) throw new Error("Could not remove team member")
        setMembers((prev) => prev.filter((m) => m.id !== pendingRemove.id))
        setAvailability((prev) => {
          const next = { ...prev }
          delete next[pendingRemove.id]
          return next
        })
      } else {
        const res = await fetch(`/api/team/invites?id=${encodeURIComponent(pendingRemove.id)}`, {
          method: "DELETE",
          credentials: "include",
        })
        if (!res.ok) throw new Error("Could not cancel invite")
        setPendingInvites((prev) => prev.filter((i) => i.id !== pendingRemove.id))
      }
      notifyTeamRosterChanged({ action: "removed" })
      setPendingRemove(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="Dispatch" title="Team" />

      <WorkspacePanel className="p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-zinc-300">
          Add people who can answer your business calls.{" "}
          <span className="font-medium text-foreground">Phone contacts</span> ring their cell when you pick them under{" "}
          <span className="font-medium text-foreground">Who answers</span> (Custom Routing).{" "}
          <span className="font-medium text-foreground">App invites</span> let them create a receptionist login for your
          business.
        </p>
        <p className="mt-2 hidden text-xs text-zinc-500 md:block">
          Adding someone here does not start forwarding by itself — open Routing → Who answers and select them.
        </p>
      </WorkspacePanel>

      {showRoutingTip ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            Nice — next, set <span className="font-semibold">Who answers</span> so calls reach them.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Open Who answers
            </Link>
            <button
              type="button"
              onClick={() => setShowRoutingTip(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Live tech availability — dense roster for the mobile Team tab. */}
      <TeamLiveRoster />

      {/* Upper ops row: instruction script (wide) + operator network (narrow). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NetworkInstructionsPanel />
        </div>

        <WorkspacePanel className="flex h-full flex-col p-5 lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <Network className="h-5 w-5 text-primary" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground sm:text-base">People who can answer</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  Your phone contacts and invited receptionists for this business.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openTeamInviteModal()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add
            </button>
          </div>

          {billingCycleLabel ? (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] text-zinc-500">
              Payout totals · billing cycle {billingCycleLabel}
            </div>
          ) : null}

          {pendingInvites.length > 0 ? (
            <div className="mt-3 space-y-2 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
                Waiting to accept ({pendingInvites.length})
              </p>
              {pendingInvites.slice(0, 5).map((inv) => {
                const inviteLabel = inv.first_name || inv.email || inv.phone || "Invite"
                const hasEmail = Boolean(inv.email?.includes("@"))
                const busy = inviteBusyId === inv.id
                return (
                  <div key={inv.id} className="space-y-1.5 border-t border-amber-500/10 pt-2 first:border-t-0 first:pt-0">
                    <p className="min-w-0 truncate text-xs text-zinc-400">
                      {inv.first_name || "Invite"} · {inv.email || inv.phone || "link sent"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void copyInviteLink(inv)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 px-2 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
                        aria-label={`Copy invite link for ${inviteLabel}`}
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
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 px-2 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
                          aria-label={`Resend invite email to ${inviteLabel}`}
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
                        onClick={() =>
                          setPendingRemove({ kind: "invite", id: inv.id, name: inviteLabel })
                        }
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                        aria-label={`Cancel invite for ${inviteLabel}`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        Cancel
                      </button>
                    </div>
                    {inviteActionError?.id === inv.id ? (
                      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] leading-snug text-destructive">
                        {inviteActionError.message}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className="mt-4 flex-1">
            {error ? (
              <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading…
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-600">
                  <Users className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm text-zinc-500">No one added yet.</p>
                <p className="max-w-[16rem] text-xs text-zinc-600">
                  Tap Add to save a phone contact or send an invite link.
                </p>
              </div>
            ) : (
              <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-0.5">
                {members.map((member, i) => {
                  const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
                  const online = isMemberOnline(member)
                  const payout = payoutsById[member.id]
                  return (
                    <div key={member.id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="relative">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className={cn("text-xs font-semibold text-primary-foreground", color)}>
                                {initials(member.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                                online ? "bg-success" : "bg-zinc-600"
                              )}
                              aria-hidden
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
                            <p className="truncate text-xs text-zinc-500">{formatPhoneDisplay(member.phone)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setPendingRemove({ kind: "member", id: member.id, name: member.name })
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove ${member.name} from your team`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <Switch
                            checked={online}
                            disabled={togglingId === member.id}
                            onCheckedChange={() => void toggleActive(member)}
                            aria-label={`${member.name} availability`}
                          />
                        </div>
                      </div>
                      {payout ? (
                        <p className="mt-2 text-[11px] text-zinc-400">
                          {payout.answered_calls} call{payout.answered_calls === 1 ? "" : "s"} ·{" "}
                          <span className="font-medium text-zinc-200">{formatUsd(payout.total_earnings)} earned</span>
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </WorkspacePanel>
      </div>

      {/* Lower field staff: unified fleet directory. */}
      <FieldTechniciansPanel />

      {/* Confirm before removing a phone contact or canceling an invite. */}
      <AlertDialog
        open={pendingRemove != null}
        onOpenChange={(open) => {
          if (!open && !removing) setPendingRemove(null)
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemove?.kind === "invite"
                ? `Cancel invite for ${pendingRemove.name}?`
                : `Remove ${pendingRemove?.name ?? "this person"} from your team?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {pendingRemove?.kind === "invite"
                ? "Their invite link will stop working. You can send a new invite later."
                : "They will no longer appear under People who can answer. You can add them again anytime."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing} className="border-zinc-700 bg-zinc-900">
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
