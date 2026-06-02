"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Check, Loader2, Network, Plus, Save } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Receptionist, ReceptionistPayoutMetrics } from "@/lib/types"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { TeamInviteModal } from "@/components/team-invite-modal"

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

function AddTeamMemberCard({ onClick }: { onClick: () => void }) {
  return (
    <WorkspacePanel
      className={cn(
        "flex min-h-[148px] flex-col items-center justify-center border-dashed border-zinc-800",
        "bg-transparent p-5 shadow-none ring-0",
        "opacity-90 transition-[opacity,border-color,background-color] duration-200",
        "hover:border-zinc-600 hover:bg-zinc-900/30 hover:opacity-100"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="group flex h-full w-full flex-col items-center justify-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 transition-colors group-hover:border-zinc-500 group-hover:text-zinc-200">
          <Plus className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <p className="mt-3 text-sm font-medium text-zinc-500 transition-colors group-hover:text-zinc-300">
          + Add Team Member
        </p>
      </button>
    </WorkspacePanel>
  )
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
    <WorkspacePanel className="mb-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10">
            <Network className="h-5 w-5 text-violet-300" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground sm:text-base">Lyncr Network Instructions</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Notes for the live operators answering your calls — business hours, how to greet callers,
              pricing scripts, and what details to collect. Saved to every operator on your lines.
            </p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-300 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden />
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
          "Business hours: Mon–Fri 8am–6pm, closed weekends\n" +
          "Greeting: \"Thanks for calling Ace Mobile Detailing, how can I help?\"\n" +
          "Pricing: Basic wash $40 · Full detail from $150 — quote ranges only, never commit a final price\n" +
          "Always collect: caller name, callback number, vehicle, service needed, and ZIP"
        }
        className="mt-4 min-h-[160px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3 text-sm leading-relaxed text-foreground placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/40 disabled:opacity-60"
      />

      {error ? (
        <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
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
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {saving ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </div>
    </WorkspacePanel>
  )
}

function formatTalkMinutes(seconds: number): string {
  const minutes = Math.round((seconds / 60) * 10) / 10
  return `${minutes} min`
}

export const TeamWorkspaceView = memo(function TeamWorkspaceView() {
  const [members, setMembers] = useState<Receptionist[]>([])
  const [payoutsById, setPayoutsById] = useState<Record<string, ReceptionistPayoutMetrics>>({})
  const [billingCycleLabel, setBillingCycleLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [inviteOpen, setInviteOpen] = useState(false)

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
    ])
      .then(([rows, payoutData]) => {
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
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
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

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="Routing" title="Team" />

      <NetworkInstructionsPanel />

      {billingCycleLabel ? (
        <p className="mb-4 text-xs text-zinc-500">
          Payout totals for billing cycle {billingCycleLabel}.
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Loading team…
        </div>
      ) : error && members.length === 0 ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AddTeamMemberCard onClick={() => setInviteOpen(true)} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member, i) => {
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
            const online = isMemberOnline(member)
            const payout = payoutsById[member.id]
            return (
              <WorkspacePanel key={member.id} className="min-h-[148px] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-11 w-11">
                        <AvatarFallback className={cn("text-sm font-semibold text-primary-foreground", color)}>
                          {initials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card transition-colors duration-200",
                          online ? "bg-success shadow-[0_0_8px_-2px_var(--success)]" : "bg-zinc-600"
                        )}
                        aria-label={online ? "Available" : "Unavailable"}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{member.name}</p>
                      <p className="text-xs text-zinc-500">{formatPhoneDisplay(member.phone)}</p>
                    </div>
                  </div>
                  <Switch
                    checked={online}
                    disabled={togglingId === member.id}
                    onCheckedChange={() => void toggleActive(member)}
                    aria-label={`${member.name} availability`}
                  />
                </div>
                <p
                  className={cn(
                    "mt-4 text-[11px] font-medium uppercase tracking-wide transition-colors duration-200",
                    online ? "text-success" : "text-zinc-500"
                  )}
                >
                  {online ? "Available for calls" : "Off duty"}
                </p>
                {payout ? (
                  <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
                    <p>
                      {payout.answered_calls} answered call{payout.answered_calls === 1 ? "" : "s"} this cycle
                    </p>
                    <p className="mt-1 font-medium text-zinc-200">
                      {formatUsd(payout.total_earnings)} earned
                      {payout.pay_mode === "PER_MINUTE" ? (
                        <span className="font-normal text-zinc-500">
                          {" "}
                          · {formatTalkMinutes(payout.total_talk_seconds)} @ {formatUsd(payout.rate_per_minute)}/min
                        </span>
                      ) : (
                        <span className="font-normal text-zinc-500">
                          {" "}
                          · {formatUsd(payout.flat_rate_usd)} flat / call
                        </span>
                      )}
                    </p>
                  </div>
                ) : null}
              </WorkspacePanel>
            )
          })}
          <AddTeamMemberCard onClick={() => setInviteOpen(true)} />
        </div>
      )}

      <TeamInviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </WorkspacePage>
  )
})
