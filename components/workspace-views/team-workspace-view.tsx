"use client"

import { memo, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Plus } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Receptionist } from "@/lib/types"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"

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

function AddTeamMemberCard() {
  return (
    <WorkspacePanel
      className={cn(
        "flex min-h-[148px] flex-col items-center justify-center border-dashed border-zinc-800",
        "bg-transparent p-5 shadow-none ring-0",
        "opacity-90 transition-[opacity,border-color,background-color] duration-200",
        "hover:border-zinc-600 hover:bg-zinc-900/30 hover:opacity-100"
      )}
    >
      <Link
        href="/dashboard#dash-call-flow"
        className="group flex h-full w-full flex-col items-center justify-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 transition-colors group-hover:border-zinc-500 group-hover:text-zinc-200">
          <Plus className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <p className="mt-3 text-sm font-medium text-zinc-500 transition-colors group-hover:text-zinc-300">
          Add Team Member
        </p>
      </Link>
    </WorkspacePanel>
  )
}

export const TeamWorkspaceView = memo(function TeamWorkspaceView() {
  const [members, setMembers] = useState<Receptionist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/receptionists", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load team")
        const json = (await res.json()) as { data?: Receptionist[] }
        setMembers(Array.isArray(json.data) ? json.data : [])
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleActive(member: Receptionist) {
    setTogglingId(member.id)
    const next = !member.is_active
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
      } else {
        setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, is_active: next } : m)))
      }
    } catch {
      setError("Could not update availability")
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <WorkspacePage>
      <WorkspacePageHeader eyebrow="Routing" title="Team" />

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
            <AddTeamMemberCard />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member, i) => {
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
            const online = member.is_active
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
                          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                          online ? "bg-success" : "bg-zinc-600"
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
                <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {online ? "Available for calls" : "Off duty"}
                </p>
              </WorkspacePanel>
            )
          })}
          <AddTeamMemberCard />
        </div>
      )}
    </WorkspacePage>
  )
})
