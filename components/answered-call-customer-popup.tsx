"use client"

// Back-compat export — primary implementation lives in CallAnsweredModal.tsx.

export { CallAnsweredModal, type CallAnsweredModalProps } from "@/components/dashboard/CallAnsweredModal"

import { CallAnsweredModal } from "@/components/dashboard/CallAnsweredModal"

/** @deprecated Use CallAnsweredModal */
export function AnsweredCallCustomerPopup({
  enabled,
  ownerUserId,
}: {
  enabled: boolean
  ownerUserId?: string | null
}) {
  return <CallAnsweredModal enabled={enabled} ownerUserId={ownerUserId} />
}
