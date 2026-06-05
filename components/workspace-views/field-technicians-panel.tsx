// Owner Team panel: invite field techs by mobile number (hands-free SMS setup link) and manage the
// roster. No passwords to manage — the tech taps their text and sets their own password.

"use client"

import { useCallback, useEffect, useState } from "react"
import { HardHat, Loader2, Plus, UserPlus, MessageSquare, Send, Check } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { FieldTechnician } from "@/lib/types"

type InviteResult = {
  name: string
  phone: string
  expires_at: string
  setup_url: string
  sms_sent: boolean
  sms_error: string | null
  success?: boolean
  errorType?: "10DLC_BLOCK" | "OTHER"
  message?: string
}

const TEN_DLC_BANNER_HEADLINE =
  "Delivery Failed: This system's outbound number is missing 10DLC profile registration. Carrier spam filters are blocking URLs."

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
  const [invite, setInvite] = useState<InviteResult | null>(null)
  const [resentId, setResentId] = useState<string | null>(null)
  const [resendError, setResendError] = useState<{ techId: string; message: string } | null>(null)

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
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
    setInvite(null)
    try {
      const res = await fetch("/api/technicians", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }),
      })
      const j = (await res.json()) as {
        error?: string
        success?: boolean
        errorType?: string
        data?: { technicians?: FieldTechnician[]; invite?: InviteResult }
      }
      if (!res.ok) {
        setError(j?.error || "Could not invite technician")
        return
      }
      if (Array.isArray(j.data?.technicians)) setTechs(j.data.technicians)
      if (j.data?.invite) setInvite(j.data.invite)
      if (j.success === false || j.data?.invite?.success === false) {
        setAdding(false)
        return
      }
      setFirstName("")
      setLastName("")
      setPhone("")
      setAdding(false)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function resend(tech: FieldTechnician) {
    setResentId(tech.id)
    setResendError(null)
    setInvite(null)
    try {
      const res = await fetch("/api/tech/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technicianId: tech.id }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        success?: boolean
        errorType?: string
        message?: string
        data?: { setup_url?: string; sms_error?: string | null }
      }
      if (j.errorType === "10DLC_BLOCK") {
        setResendError({
          techId: tech.id,
          message: TEN_DLC_BANNER_HEADLINE,
        })
        setResentId(null)
        return
      }
      if (!res.ok || j.success === false) {
        setResendError({
          techId: tech.id,
          message: j.message || "Could not resend invite text. Try again or share the setup link manually.",
        })
        setResentId(null)
        return
      }
      setTimeout(() => setResentId(null), 2500)
    } catch {
      setResentId(null)
      setResendError({ techId: tech.id, message: "Network error. Please try again." })
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

  return (
    <WorkspacePanel className="p-5">
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
              setInvite(null)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" /> Add technician
          </button>
        )}
      </div>

      {/* 10DLC carrier block — do not show green "texted" success */}
      {invite?.errorType === "10DLC_BLOCK" && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/50 p-4">
          <p className="text-sm font-semibold text-red-200">
            ⚠️ {TEN_DLC_BANNER_HEADLINE}
          </p>
          <p className="mt-2 text-xs text-red-100/80">
            Technician <span className="font-medium text-red-100">{invite.name}</span> was added, but the
            invite text did not leave our system. Register 10DLC under Settings → SMS lead-alert registration,
            or share this setup link manually:
          </p>
          <p className="mt-2 break-all rounded-lg bg-black/40 p-2 font-mono text-[11px] text-red-100/90">
            {invite.setup_url}
          </p>
          <p className="mt-2 text-[11px] text-red-200/60">Link expires in 48 hours.</p>
        </div>
      )}

      {/* Invite-sent confirmation (only when SMS actually succeeded) */}
      {invite && invite.errorType !== "10DLC_BLOCK" && invite.sms_sent && invite.success !== false && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
            <MessageSquare className="h-4 w-4" />
            Invite texted to {invite.name}
          </p>
          <p className="mt-1 text-xs text-emerald-100/80">
            We sent a secure setup link to {formatPhoneDisplay(invite.phone)}. They tap it, pick a password,
            and they&apos;re in — no password for you to manage.
          </p>
          <p className="mt-2 text-[11px] text-emerald-100/60">Link expires in 48 hours.</p>
        </div>
      )}

      {/* Other SMS failures — neutral fallback with manual link */}
      {invite && invite.errorType !== "10DLC_BLOCK" && !invite.sms_sent && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">Invite created for {invite.name}</p>
          <p className="mt-1 text-xs text-amber-100/80">
            We couldn&apos;t send the SMS automatically
            {invite.sms_error || invite.message ? ` (${invite.message || invite.sms_error})` : ""}. Share this
            setup link with them directly:
          </p>
          <p className="mt-2 break-all rounded-lg bg-black/30 p-2 font-mono text-[11px] text-amber-100">
            {invite.setup_url}
          </p>
          <p className="mt-2 text-[11px] text-amber-100/60">Link expires in 48 hours.</p>
        </div>
      )}

      {resendError && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/50 p-4">
          <p className="text-sm font-semibold text-red-200">
            ⚠️ {resendError.message.includes("10DLC") ? resendError.message : `Resend failed: ${resendError.message}`}
          </p>
        </div>
      )}

      {/* Invite form — first, last, mobile only */}
      {adding && (
        <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              required
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              required
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            placeholder="Mobile phone number"
            required
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
              Send invite
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
            We text them a secure link to set their own password — you never handle passwords.
          </p>
        </form>
      )}

      {/* Roster */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading technicians…
        </div>
      ) : techs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-600">
            <HardHat className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm text-zinc-500">No field technicians yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {techs.map((tech) => (
            <div
              key={tech.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{tech.name}</p>
                  {tech.invite_pending && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      Setup pending
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-zinc-500">
                  {tech.phone ? formatPhoneDisplay(tech.phone) : "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {tech.invite_pending && (
                  <button
                    onClick={() => void resend(tech)}
                    disabled={resentId === tech.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {resentId === tech.id ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {resentId === tech.id ? "Sent" : "Resend"}
                  </button>
                )}
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
