// Owner Team panel: invite field techs by mobile number (hands-free SMS setup link) and manage the
// roster. No passwords to manage — the tech taps their text and sets their own password.

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HardHat, Loader2, Plus, Send, Check, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import { AddTechnicianModal } from "@/components/team/add-technician-modal"
import {
  PayPlanButton,
  PayPlanEditor,
  usePayPlans,
  type PayPlanTarget,
} from "@/components/compensation/pay-plan-editor"
import { TechInviteSmsAlert } from "@/components/team/tech-invite-sms-alert"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { organizationQueryString } from "@/lib/workspace-organizations"
import type { TechInviteSmsErrorType } from "@/lib/tech-invite-sms-types"
import type { FieldTechnician } from "@/lib/types"
import {
  notifyTeamRosterChanged,
  TEAM_ROSTER_CHANGED_EVENT,
} from "@/lib/team-invite-events"
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

type InviteResult = {
  name: string
  phone: string
  /** Written by this panel's own invite path; the add-technician modal does not supply
   *  one, and nothing renders it. Optional so both callers type-check honestly. */
  expires_at?: string
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
  // Confirm-dialog target before deleting a technician from the roster.
  const [removeTarget, setRemoveTarget] = useState<FieldTechnician | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // Pay plans for the fleet, and the tech currently open in the editor.
  const { plans, reload: reloadPlans } = usePayPlans()
  const [payTarget, setPayTarget] = useState<PayPlanTarget | null>(null)

  // Only the true first load (or a real org switch) shows the spinner — a roster refresh
  // triggered by TEAM_ROSTER_CHANGED_EVENT (invite sent, phone contact added, etc.) must not
  // blank the list back to a spinner every time.
  const loadedOrgRef = useRef<string | null>(null)
  const load = useCallback(() => {
    if (loadedOrgRef.current !== orgId) setLoading(true)
    const qs = organizationQueryString(orgId)
    fetch(`/api/technicians${qs}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: FieldTechnician[] }) => setTechs(Array.isArray(j.data) ? j.data : []))
      .catch(() => {})
      .finally(() => {
        loadedOrgRef.current = orgId
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => load(), [load])

  // Reload when another Team panel changes the roster (invite, phone contact, etc.).
  useEffect(() => {
    const onChanged = () => load()
    window.addEventListener(TEAM_ROSTER_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(TEAM_ROSTER_CHANGED_EVENT, onChanged)
  }, [load])

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

  /** Delete the technician after the owner confirms in the dialog. */
  async function confirmRemoveTech() {
    if (!removeTarget) return
    setRemoving(true)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/technicians/${removeTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || "Could not remove technician")
      }
      setTechs((prev) => prev.filter((t) => t.id !== removeTarget.id))
      notifyTeamRosterChanged({ action: "removed" })
      setRemoveTarget(null)
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Could not remove technician")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <WorkspacePanel density="default">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <HardHat className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground sm:text-base">Field Technicians</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Road staff who get jobs on the Lyncr mobile console.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalOpen(true)
            setInvite(null)
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/50 p-4">
          <p className="text-sm font-semibold text-destructive">
            ⚠️ {resendError.message.includes("10DLC") ? resendError.message : `Resend failed: ${resendError.message}`}
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading technicians…
        </div>
      ) : techs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/60 text-muted-foreground">
            <HardHat className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">No field technicians yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {techs.map((tech) => (
            <div
              key={tech.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{tech.name}</p>
                  {tech.invite_pending ? (
                    <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-2xs font-medium text-warning">
                      Setup pending
                    </span>
                  ) : tech.is_active ? (
                    <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-2xs font-medium text-success">
                      Active
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {tech.phone ? formatPhoneDisplay(tech.phone) : "—"}
                </p>
                {showWorkspacePicker ? (
                  <label className="mt-1.5 block text-2xs text-muted-foreground">
                    Business
                    <select
                      value={tech.organization_id ?? ""}
                      disabled={movingId === tech.id}
                      onChange={(e) => {
                        const next = e.target.value.trim()
                        void moveTech(tech, next ? next : null)
                      }}
                      className="mt-0.5 w-full max-w-[200px] rounded-md border border-border bg-card/80 px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
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
                <div className="mt-1.5">
                  <PayPlanButton
                    plan={plans[tech.id]}
                    label={tech.name}
                    onEdit={() =>
                      setPayTarget({
                        kind: "field_tech",
                        id: tech.id,
                        name: tech.name,
                        employmentType: plans[tech.id]?.employment_type ?? "UNSPECIFIED",
                        components: plans[tech.id]?.components ?? [],
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
                {tech.invite_pending && (
                  <button
                    type="button"
                    onClick={() => void resend(tech)}
                    disabled={resentId === tech.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-2xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {resentId === tech.id ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {resentId === tech.id ? "Sent" : "Resend"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRemoveError(null)
                    setRemoveTarget(tech)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-2xs font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${tech.name} from your team`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  Remove
                </button>
                <span className={`text-2xs font-medium ${tech.is_active ? "text-success" : "text-muted-foreground"}`}>
                  {tech.is_active ? "Active" : "Off"}
                </span>
                <Switch checked={tech.is_active} onCheckedChange={() => void toggle(tech)} aria-label={`${tech.name} active`} />
              </div>
            </div>
          ))}
        </div>
      )}

      <PayPlanEditor
        target={payTarget}
        onClose={() => setPayTarget(null)}
        onSaved={() => void reloadPlans()}
      />

      <AddTechnicianModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={({ technicians, invite: inviteResult }) => {
          setTechs(technicians)
          if (inviteResult) setInvite(inviteResult)
        }}
      />

      {/* Confirm before removing a field technician from the roster. */}
      <AlertDialog
        open={removeTarget != null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setRemoveTarget(null)
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogContent className="border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.name ?? "this technician"} from your team?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              They will disappear from Field Technicians and the live roster. Active/Off toggles stay
              available for everyone else — this only removes this person.
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
                void confirmRemoveTech()
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePanel>
  )
}
