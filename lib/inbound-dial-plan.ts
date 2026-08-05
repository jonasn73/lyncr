// Server resolver for the shared inbound dial planner (DB lookups + pure planInboundDial).

import {
  getActiveRoutingModeForDid,
  getCustomRoutingPhoneForDid,
  getFirstAvailableOwnerReceptionist,
  getTeamReceptionistForDid,
} from "@/lib/active-routing-mode-db"
import {
  CAPTURE_DEFAULT_RING_E164,
  resolveInboundCapturePlan,
  type InboundCapturePlan,
} from "@/lib/inbound-time-capture"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"
import {
  planInboundDial,
  type InboundDialPlanResult,
  type PlanInboundDialInputs,
} from "@/lib/inbound-dial-plan-core"

export type {
  InboundDialReason,
  InboundDialHopType,
  InboundDialHop,
  InboundDialPlanResult,
  PlanInboundDialInputs,
  InboundCaptureKind,
} from "@/lib/inbound-dial-plan-core"

export { planInboundDial, deriveRingsNowStrip } from "@/lib/inbound-dial-plan-core"

/**
 * Async resolver used by Call Control + TeXML — loads mode, capture plan, teammates, then plans.
 */
export async function resolveInboundDialPlan(params: {
  userId: string
  businessLineE164: string
  ownerPhone?: string | null
  preferredReceptionistId?: string | null
  legacyReceptionistPhone?: string | null
  legacyReceptionistName?: string | null
  legacyReceptionistId?: string | null
  /** Pre-resolved mode (skip DID lookup when TeXML already has it). */
  mode?: string | null
  /** Pre-resolved capture plan (skip when already loaded). */
  capturePlan?: InboundCapturePlan | null
}): Promise<InboundDialPlanResult> {
  const failsafe = CAPTURE_DEFAULT_RING_E164
  const ownerRaw = (params.ownerPhone || "").trim()
  const ownerNorm = ownerRaw ? normalizePhoneNumberE164(ownerRaw) : ""
  const ownerPhoneE164 =
    ownerNorm && isReasonablePstnDialString(ownerNorm)
      ? ownerNorm
      : ownerRaw && isReasonablePstnDialString(ownerRaw)
        ? ownerRaw
        : failsafe

  let mode = (params.mode || "").trim() || "your_phone"
  if (!params.mode) {
    try {
      mode = await getActiveRoutingModeForDid(params.businessLineE164)
    } catch (e) {
      console.warn("[inbound-dial-plan] mode lookup skipped:", e)
    }
  }

  let capturePlan: InboundCapturePlan = params.capturePlan || { kind: "day_dial" }
  if (!params.capturePlan) {
    try {
      capturePlan = await resolveInboundCapturePlan({ ownerUserId: params.userId })
    } catch (e) {
      console.warn("[inbound-dial-plan] capture plan lookup skipped:", e)
    }
  }

  let customPhoneE164: string | null = null
  if (mode === "custom_routing") {
    try {
      customPhoneE164 = await getCustomRoutingPhoneForDid(params.businessLineE164)
    } catch (e) {
      console.warn("[inbound-dial-plan] custom routing lookup skipped:", e)
    }
  }

  let teamReceptionist: PlanInboundDialInputs["teamReceptionist"] = null
  if (mode === "team_receptionist") {
    try {
      teamReceptionist = await getTeamReceptionistForDid(params.businessLineE164)
    } catch (e) {
      console.warn("[inbound-dial-plan] team receptionist lookup skipped:", e)
    }
  }

  let busyBackup: PlanInboundDialInputs["busyBackup"] = null
  if (
    (mode === "your_phone" || mode === "smart_ivr") &&
    capturePlan.kind !== "day_dial" &&
    params.userId
  ) {
    try {
      busyBackup = await getFirstAvailableOwnerReceptionist({
        ownerUserId: params.userId,
        preferredReceptionistId: params.preferredReceptionistId,
      })
    } catch (e) {
      console.warn("[inbound-dial-plan] busy-backup lookup skipped:", e)
    }
  }

  let legacyReceptionist: PlanInboundDialInputs["legacyReceptionist"] = null
  const legacyPhone = params.legacyReceptionistPhone?.trim() || ""
  const legacyId = params.legacyReceptionistId?.trim() || ""
  if (legacyId && legacyPhone) {
    const e164 = normalizePhoneNumberE164(legacyPhone) || legacyPhone
    if (isReasonablePstnDialString(e164)) {
      legacyReceptionist = {
        receptionistId: legacyId,
        name: params.legacyReceptionistName ?? null,
        phoneE164: e164,
      }
    }
  }

  return planInboundDial({
    mode,
    ownerPhoneE164,
    captureKind: capturePlan.kind,
    customPhoneE164,
    busyBackup,
    teamReceptionist,
    legacyReceptionist,
    failsafePhoneE164: failsafe,
  })
}
