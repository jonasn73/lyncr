"use client"

// Super-admin view: onboard "Global Lyncr Network Agents" — shared receptionists
// (receptionists.user_id = NULL) that any business can route to via the hybrid pool.
// Backed by GET/POST /api/admin/network-agents.

import { useCallback, useEffect, useState } from "react"
import { Loader2, UserPlus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { ROUTING_POOL_SKILL_TAGS, formatRoutingPoolSkillLabel } from "@/lib/routing-pool-skills"

// One shared network agent (matches GET /api/admin/network-agents).
type NetworkAgent = {
  id: string
  name: string
  phone: string
  skills: string[]
  is_active: boolean
  created_at: string
}

const opCard = "border-slate-700/80 bg-slate-900/50 text-slate-200 shadow-sm"

export function AdminNetworkAgentsBoard() {
  const { toast } = useToast()
  const [agents, setAgents] = useState<NetworkAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Onboarding form state.
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [customSkills, setCustomSkills] = useState("")

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/network-agents", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as { data?: { agents: NetworkAgent[] }; error?: string }
      if (json.data?.agents) setAgents(json.data.agents)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Toggle a canonical skill chip on/off.
  function toggleSkill(tag: string) {
    setSelectedSkills((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  async function createAgent() {
    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      toast({ title: "Enter the agent's name", variant: "destructive" })
      return
    }
    if (phone.replace(/\D/g, "").length < 10) {
      toast({ title: "Enter a valid phone number", variant: "destructive" })
      return
    }
    // Merge chip selections with any comma-separated custom tags.
    const custom = customSkills
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const skills = Array.from(new Set([...selectedSkills, ...custom]))

    setBusy(true)
    try {
      const res = await fetch("/api/admin/network-agents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, phone, skills }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { agent: NetworkAgent }; error?: string }
      if (!res.ok) {
        toast({ title: "Could not create agent", description: json.error ?? res.statusText, variant: "destructive" })
        return
      }
      toast({ title: "Network agent created", description: `${trimmedName} is now in the shared Lyncr pool.` })
      setName("")
      setPhone("")
      setSelectedSkills([])
      setCustomSkills("")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Lyncr network agents</h1>
          <p className="mt-1 text-sm text-slate-400">
            Shared, platform-managed receptionists (no owning business). Businesses on{" "}
            <span className="font-medium text-slate-300">Only Ring Lyncr Network</span> or{" "}
            <span className="font-medium text-slate-300">Ring My Team, Fallback to Lyncr</span> route to these by skill.
          </p>
        </div>
      </header>

      {/* Onboarding form */}
      <Card className={opCard}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-100">
            <UserPlus className="h-4 w-4 text-violet-300" aria-hidden />
            Onboard a global network agent
          </CardTitle>
          <CardDescription className="text-slate-400">
            Creates a receptionist row with <code className="rounded bg-slate-950 px-1 text-violet-200">user_id = NULL</code>{" "}
            (requires migration 048). Skills decide which industries they can answer for.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="net-agent-name" className="text-slate-400">
                Name
              </Label>
              <Input
                id="net-agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Pierce"
                className="border-slate-600 bg-slate-950/80 text-slate-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="net-agent-phone" className="text-slate-400">
                Phone (cell)
              </Label>
              <Input
                id="net-agent-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="border-slate-600 bg-slate-950/80 text-slate-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-400">Skills</Label>
            <div className="flex flex-wrap gap-2">
              {ROUTING_POOL_SKILL_TAGS.map((tag) => {
                const active = selectedSkills.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleSkill(tag)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-violet-500/60 bg-violet-600/25 text-violet-100"
                        : "border-slate-600 bg-slate-950/60 text-slate-300 hover:border-slate-500"
                    )}
                    aria-pressed={active}
                  >
                    {formatRoutingPoolSkillLabel(tag)}
                  </button>
                )
              })}
            </div>
            <Input
              value={customSkills}
              onChange={(e) => setCustomSkills(e.target.value)}
              placeholder="Custom tags, comma-separated (e.g. detailing_core, locksmith)"
              className="border-slate-600 bg-slate-950/80 text-slate-100"
            />
          </div>

          <Button
            type="button"
            disabled={busy}
            onClick={() => void createAgent()}
            className="bg-violet-600 text-white hover:bg-violet-500"
          >
            {busy ? "Creating…" : "Create network agent"}
          </Button>
        </CardContent>
      </Card>

      {/* Existing agents */}
      <Card className={opCard}>
        <CardHeader>
          <CardTitle className="text-base text-slate-100">Active network agents</CardTitle>
          <CardDescription className="text-slate-400">All receptionists with no owning business (user_id IS NULL).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
              Loading…
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-slate-400">No network agents yet. Onboard one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-300">Name</TableHead>
                  <TableHead className="text-slate-300">Phone</TableHead>
                  <TableHead className="text-slate-300">Skills</TableHead>
                  <TableHead className="text-slate-300">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.id} className="border-slate-800">
                    <TableCell className="text-sm text-slate-200">{a.name}</TableCell>
                    <TableCell className="text-sm tabular-nums text-slate-300">{a.phone}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {a.skills.length === 0 ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          a.skills.map((s) => (
                            <Badge
                              key={s}
                              variant="outline"
                              className="border-slate-600 bg-slate-950/60 text-[10px] text-slate-300"
                            >
                              {formatRoutingPoolSkillLabel(s)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          a.is_active
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border-slate-600 bg-slate-950/60 text-slate-400"
                        )}
                      >
                        {a.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
