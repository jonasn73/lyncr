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
import type { SmsRegistrationSubmissionSummary } from "@/lib/sms-registration-submission-summary"
import type { SmsRegistration } from "@/lib/types"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"

type CompliancePayload = {
  registration?: SmsRegistration | null
  pending_approval?: boolean
  organization_status?: string
  sms_ready?: boolean
  submission_summary?: SmsRegistrationSubmissionSummary | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CarrierRegistrationModal({ open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [compliance, setCompliance] = useState<CompliancePayload | null>(null)
  const [forceForm, setForceForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const orgId = readActiveOrganizationId()
    const qs = orgId ? `?organization_id=${encodeURIComponent(orgId)}` : ""
    try {
      const res = await fetch(`/api/settings/10dlc${qs}`, { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as { data?: CompliancePayload }
      setCompliance(json.data ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setForceForm(false)
      return
    }
    void load()
  }, [open, load])

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
  const regStatus = compliance?.registration?.status ?? ""
  const orgStatus = compliance?.organization_status ?? ""
  const showStatusView =
    !forceForm &&
    summary != null &&
    (compliance?.pending_approval === true ||
      regStatus === "PENDING_APPROVAL" ||
      orgStatus === "PENDING_APPROVAL" ||
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
              onRefresh={() => void load()}
              onEdit={summary.lifecycle_stage === "rejected" ? () => setForceForm(true) : undefined}
            />
          ) : (
            <SmsRegistrationForm variant="modal" onSubmitted={() => onOpenChange(false)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
