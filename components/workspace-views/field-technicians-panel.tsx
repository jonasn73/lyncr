// Owner Team panel: provision field-tech logins for road staff and manage the roster.

"use client"

import { useCallback, useEffect, useState } from "react"
import { HardHat, Loader2, Plus, Copy, Check, UserPlus } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { FieldTechnician } from "@/lib/types"

type NewCredentials = { email: string; password: string; login_url: string }

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

export function FieldTechniciansPanel() {
  const [techs, setTechs] = useState<FieldTechnician[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<NewCredentials | null>(null)
  const [copied, setCopied] = useState(false)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/technicians", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: FieldTechnician[] }) => setTechs(Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => load(), [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCredentials(null)
    try {
      const res = await fetch("/api/technicians", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error || "Could not add technician")
        return
      }
      setCredentials(j.data.credentials as NewCredentials)
      setName("")
      setEmail("")
      setPhone("")
      setAdding(false)
      load()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(tech: FieldTechnician) {
    const next = !tech.is_active
    setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, is_active: next } : t)))
    try {
      await fetch(`/api/technicians/${tech.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      })
    } catch {
      setTechs((prev) => prev.map((t) => (t.id === tech.id ? { ...t, is_active: !next } : t)))
    }
  }

  function copyCreds() {
    if (!credentials) return
    const text = `Lyncr Field Console\nLogin: ${location.origin}${credentials.login_url}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <WorkspacePanel className="mt-6 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <HardHat className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground sm:text-base">Field Technicians</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Road staff who get jobs on the Lyncr mobile console.</p>
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true)
              setCredentials(null)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" /> Add technician
          </button>
        )}
      </div>

      {/* New-credentials banner (shown once after provisioning) */}
      {credentials && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-200">Technician login created</p>
          <p className="mt-1 text-xs text-emerald-100/80">
            Share these once — the password isn&apos;t shown again. They sign in at{" "}
            <span className="font-mono">{credentials.login_url}</span>.
          </p>
          <div className="mt-3 space-y-1 rounded-lg bg-black/30 p-3 font-mono text-xs text-emerald-100">
            <p>Email: {credentials.email}</p>
            <p>Password: {credentials.password}</p>
          </div>
          <button
            onClick={copyCreds}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy login details"}
          </button>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Login email"
              required
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Mobile phone (optional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create login
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            We generate a temporary password automatically. The tech can use it at the Lyncr Field Console.
          </p>
        </form>
      )}

      {/* Roster */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading technicians…
        </div>
      ) : techs.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No field technicians yet.</p>
      ) : (
        <div className="space-y-2">
          {techs.map((tech) => (
            <div
              key={tech.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{tech.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {tech.email || "—"}
                  {tech.phone ? ` · ${formatPhoneDisplay(tech.phone)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-[11px] font-medium ${tech.is_active ? "text-success" : "text-zinc-500"}`}>
                  {tech.is_active ? "Active" : "Off"}
                </span>
                <Switch checked={tech.is_active} onCheckedChange={() => void toggle(tech)} aria-label={`${tech.name} active`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </WorkspacePanel>
  )
}
