// Owner Team panel: invite field techs by mobile number (hands-free SMS setup link) and manage the
// roster. No passwords to manage — the tech taps their text and sets their own password.

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { HardHat, Loader2, Plus, Send, Check } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import { AddTechnicianModal } from "@/components/team/add-technician-modal"
import { TechInviteSmsAlert } from "@/components/team/tech-invite-sms-alert"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { TechInviteSmsErrorType } from "@/lib/tech-invite-sms-types"
import type { FieldTechnician } from "@/lib/types"

type InviteResult = {
  name: string
  phone: string
  expires_at: string
  setup_url: string
  sms_sent: boolean
  sms_error: string | null
  success?: boolean
  errorType?: TechInviteSmsErrorType
  message?: string
}

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

export function FieldTechniciansPanel() {
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-") ? activeOrganizationId : null
  const realOrganizations = useMemo(
    () => organizations.filter((org) => !org.id.startsWith("legacy-")),
    [organizations]
  )
  const showWorkspacePicker = realOrganizations.length > 1

  const [techs, setTechs] = useState<FieldTechnician[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [invite, setInvite] = useState<InviteResult | null>(null)
  const [resentId, setResentId] = useState<string | null>(null)
  const [resendError, setResendError] = useState<{ techId: string; message: string } | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const qs = organizationQueryString(orgId)
    fetch(`/api/technicians${qs}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: FieldTechnician[] }) => setTechs(Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => load(), [load])

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
        errorType?: TechInviteSmsErrorType
        message?: string
        data?: { setup_url?: string; sms_error?: string | null; expires_at?: string }
      }
      if (!res.ok || j.success === false) {
        const setupUrl = j.data?.setup_url
        if (setupUrl && j.errorType) {
          setInvite({
            name: tech.name,
            phone: tech.phone,
            expires_at: j.data?.expires_at ?? "",
            setup_url: setupUrl,
            sms_sent: false,
            sms_error: j.data?.sms_error ?? null,
            success: false,
            errorType: j.errorType,
            message: j.message,
          })
          setResentId(null)
          return
        }
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

  async function moveTech(tech: FieldTechnician, nextOrgId: string | null) {
    const previous = tech.organization_id ?? null
    if (nextOrgId === previous) return
    setMovingId(tech.id)
    setTechs((prev) =>
      prev.map((t) => (t.id === tech.id ? { ...t, organization_id: nextOrgId } : t))
    )
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
      }
    } catch {
      setTechs((prev) =>
        prev.map((t) => (t.id === tech.id ? { ...t, organization_id: previous } : t))
      )
    } finally {
      setMovingId(null)
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
        <button
          type="button"
          onClick={() => {
            setModalOpen(true)
            setInvite(null)
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add technician
        </button>
      </div>

      {invite ? (
        <TechInviteSmsAlert
          name={invite.name}
          phone={invite.phone}
          setupUrl={invite.setup_url}
          smsSent={invite.sms_sent}
          success={invite.success}
          errorType={invite.errorType}
          message={invite.message}
          smsError={invite.sms_error}
        />
      ) : null}

      {resendError && !invite ? (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/50 p-4">
          <p className="text-sm font-semibold text-red-200">
            ⚠️ {resendError.message.includes("10DLC") ? resendError.message : `Resend failed: ${resendError.message}`}
          </p>
        </div>
      ) : null}

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
                  {tech.invite_pending ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      Setup pending
                    </span>
                  ) : tech.is_active ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-zinc-500">
                  {tech.phone ? formatPhoneDisplay(tech.phone) : "—"}
                </p>
                {showWorkspacePicker ? (
                  <label className="mt-1.5 block text-[10px] text-zinc-500">
                    Business
                    <select
                      value={tech.organization_id ?? ""}
                      disabled={movingId === tech.id}
                      onChange={(e) => {
                        const next = e.target.value.trim()
                        void moveTech(tech, next ? next : null)
                      }}
                      className="mt-0.5 w-full max-w-[200px] rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                    >
                      <option value="">Unassigned</option>
                      {realOrganizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {tech.invite_pending && (
                  <button
                    type="button"
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

      <AddTechnicianModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={({ technicians, invite: inviteResult }) => {
          setTechs(technicians)
          if (inviteResult) setInvite(inviteResult)
        }}
      />
    </WorkspacePanel>
  )
}
