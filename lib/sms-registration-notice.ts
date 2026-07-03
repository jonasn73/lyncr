// Client-safe SMS / 10DLC notice state — shared by notification bell + banners.

export type SmsComplianceView = {
  sms_ready?: boolean
  pending_approval?: boolean
  organization_status?: string
  registration?: { status?: string } | null
  legacy_registration?: { status?: string; status_detail?: string | null } | null
  submission_summary?: {
    lifecycle_stage?: string
    telnyx_status?: string | null
    rejection_reason?: string | null
    status_detail?: string | null
  } | null
}

export type SmsNoticeState = "ready" | "rejected" | "pending" | "setup"

function failureDetailText(view: SmsComplianceView): string {
  return (
    view.submission_summary?.rejection_reason?.trim() ||
    view.submission_summary?.status_detail?.trim() ||
    view.legacy_registration?.status_detail?.trim() ||
    ""
  )
}

function detailLooksLikeFailure(detail: string): boolean {
  const blob = detail.toLowerCase()
  if (
    blob.includes("pending or failed status") ||
    blob.includes("brand in pending") ||
    blob.includes("brand is still being verified")
  ) {
    return false
  }
  return (
    blob.includes("registration failed") ||
    blob.includes("campaign creation failed") ||
    blob.includes("cannot associate campaign") ||
    blob.includes("carrier rejected") ||
    blob.includes("brand registration failed") ||
    blob.includes("campaign registration failed")
  )
}

/** Match the carrier registration modal — failed/rejected beats generic "pending review". */
export function resolveSmsNoticeState(view: SmsComplianceView): SmsNoticeState {
  if (view.sms_ready) return "ready"

  const telnyxStatus = (
    view.submission_summary?.telnyx_status ??
    view.legacy_registration?.status ??
    ""
  )
    .trim()
    .toLowerCase()
  const regStatus = view.registration?.status ?? ""
  const orgStatus = view.organization_status ?? ""
  const stage = view.submission_summary?.lifecycle_stage ?? ""
  const detail = failureDetailText(view)

  if (
    stage === "rejected" ||
    regStatus === "REJECTED" ||
    orgStatus === "REJECTED" ||
    telnyxStatus === "failed" ||
    telnyxStatus === "rejected" ||
    telnyxStatus.includes("tcr_failed") ||
    telnyxStatus.includes("telnyx_failed") ||
    detailLooksLikeFailure(detail)
  ) {
    return "rejected"
  }

  const isPending =
    view.pending_approval === true ||
    orgStatus === "PENDING_APPROVAL" ||
    regStatus === "PENDING_APPROVAL" ||
    stage === "carrier_review" ||
    ["paid", "submitted", "pending_review"].includes(telnyxStatus)

  if (isPending) return "pending"
  return "setup"
}

export function smsNoticeMessage(view: SmsComplianceView, state: SmsNoticeState): string {
  const detail = failureDetailText(view)
  if (state === "rejected") {
    if (detail) {
      const clipped = detail.length > 140 ? `${detail.slice(0, 139)}…` : detail
      return clipped.toLowerCase().startsWith("carrier")
        ? clipped
        : `Carrier rejection: ${clipped}`
    }
    return "Your 10DLC registration failed at the carrier. Update and resubmit to unlock business texts."
  }
  if (state === "pending") {
    return "SMS business registration is undergoing carrier review. Alerts will unlock shortly."
  }
  return "Register your business for SMS lead alerts (one-time carrier requirement)."
}

export function build10DlcComplianceUrl(organizationId: string | null): string {
  if (organizationId && !organizationId.startsWith("legacy-")) {
    return `/api/settings/10dlc?organization_id=${encodeURIComponent(organizationId)}`
  }
  return "/api/settings/10dlc"
}

/** Poll Telnyx then load dashboard compliance (same data as the registration modal). */
export async function fetchSmsComplianceView(
  organizationId: string | null
): Promise<SmsComplianceView | null> {
  try {
    await fetch("/api/messaging/10dlc/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(organizationId && !organizationId.startsWith("legacy-")
          ? { organization_id: organizationId }
          : {}),
      }),
    }).catch(() => {})

    const res = await fetch(build10DlcComplianceUrl(organizationId), {
      credentials: "include",
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = (await res.json().catch(() => ({}))) as { data?: SmsComplianceView }
    return json.data ?? null
  } catch {
    return null
  }
}

export function smsDismissStorageKey(organizationId: string | null): string {
  const orgKey =
    organizationId && !organizationId.startsWith("legacy-") ? organizationId : "default"
  return `lyncr_10dlc_nudge_dismissed_${orgKey}`
}
