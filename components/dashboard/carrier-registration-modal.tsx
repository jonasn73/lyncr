"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SmsRegistrationForm } from "@/components/dashboard/sms-registration-form"
import { SmsRegistrationStatusView } from "@/components/dashboard/sms-registration-status-view"
import {
  CARRIER_REGISTRATION_UPDATED_EVENT,
} from "@/lib/settings-modals-events"
import type { SmsRegistrationSubmissionSummary } from "@/lib/sms-registration-submission-summary-types"
import type { SmsRegistration } from "@/lib/types"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { resolveSmsNoticeState } from "@/lib/sms-registration-notice"

type CompliancePayload = {
  registration?: SmsRegistration | null
  pending_approval?: boolean
  organization_status?: string
  sms_ready?: boolean
  legacy_registration?: { status?: string; status_detail?: string | null } | null
  submission_summary?: SmsRegistrationSubmissionSummary | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When true, open directly on the editable form (carrier rejection flow). */
  initialEdit?: boolean
}

export function CarrierRegistrationModal({ open, onOpenChange, initialEdit = false }: Props) {
  const { activeOrganizationId } = useDashboardWorkspace()
  const [loading, setLoading] = useState(false)
  const [compliance, setCompliance] = useState<CompliancePayload | null>(null)
  const [forceForm, setForceForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const orgId = activeOrganizationId ?? readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    try {
      const res = await fetch(`/api/settings/10dlc${qs}`, { credentials: "include", cache: "no-store" })
      const json = (await res.json().catch(() => ({}))) as { data?: CompliancePayload }
      setCompliance(json.data ?? null)
    } finally {
      setLoading(false)
    }
  }, [activeOrganizationId])

  const refreshFromCarrier = useCallback(async () => {
    const orgId = readActiveOrganizationId()
    try {
      await fetch("/api/messaging/10dlc/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId ?? undefined }),
      })
    } catch {
      // load() still refreshes dashboard copy from GET /api/settings/10dlc
    }
    await load()
  }, [load])

  useEffect(() => {
    if (!open) {
      setForceForm(false)
      return
    }
    if (initialEdit) setForceForm(true)
    void load()
  }, [open, initialEdit, load])

  useEffect(() => {
    if (!open) return
    const onRefresh = () => void load()
    window.addEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onRefresh)
    window.addEventListener("lyncr-organization-changed", onRefresh)
    return () => {
      window.removeEventListener(CARRIER_REGISTRATION_UPDATED_EVENT, onRefresh)
      window.removeEventListener("lyncr-organization-changed", onRefresh)
    }
  }, [open, load])

  const summary = compliance?.submission_summary ?? null
  const noticeState = compliance
    ? resolveSmsNoticeState({
        sms_ready: compliance.sms_ready,
        pending_approval: compliance.pending_approval,
        organization_status: compliance.organization_status,
        registration: compliance.registration,
        legacy_registration: compliance.legacy_registration,
        submission_summary: compliance.submission_summary,
      })
    : "setup"
  const isRejected = noticeState === "rejected"
  const showStatusView =
    !forceForm &&
    !initialEdit &&
    summary != null &&
    (noticeState === "pending" ||
      noticeState === "rejected" ||
      summary.lifecycle_stage === "carrier_review" ||
      summary.lifecycle_stage === "rejected" ||
      summary.lifecycle_stage === "approved")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Carrier 10DLC registration</DialogTitle>
          <DialogDescription>
            US carriers require a one-time business profile before lead-alert and customer SMS can deliver.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto pr-1">
          {!open ? null : loading && !compliance ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading registration status…
            </div>
          ) : showStatusView && summary ? (
            <SmsRegistrationStatusView
              summary={summary}
              loading={loading}
              variant="modal"
              onRefresh={() => void refreshFromCarrier()}
              onEdit={isRejected ? () => setForceForm(true) : undefined}
            />
          ) : (
            <SmsRegistrationForm
              variant="modal"
              onSubmitted={() => {
                setForceForm(false)
                void load()
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
