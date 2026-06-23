"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Check, Loader2, Network, Plus, Save, Users } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Receptionist, ReceptionistPayoutMetrics } from "@/lib/types"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { openTeamInviteModal } from "@/lib/team-invite-events"
import { FieldTechniciansPanel } from "@/components/workspace-views/field-technicians-panel"

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
  const [members, setMembers] = useState<Receptionist[]>([])
  const [payoutsById, setPayoutsById] = useState<Record<string, ReceptionistPayoutMetrics>>({})
  const [billingCycleLabel, setBillingCycleLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Record<string, boolean>>({})

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
                <h2 className="text-sm font-semibold text-foreground sm:text-base">Your Active Operator Network</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  Lyncr operators assigned to watch your inbound line.
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

          <div className="mt-4 flex-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading…
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-600">
                  <Users className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm text-zinc-500">No operators assigned yet.</p>
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
                        <Switch
                          checked={online}
                          disabled={togglingId === member.id}
                          onCheckedChange={() => void toggleActive(member)}
                          aria-label={`${member.name} availability`}
                        />
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
    </WorkspacePage>
  )
})
