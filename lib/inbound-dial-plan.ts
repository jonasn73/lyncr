// Shared inbound dial planner — one source of truth for Call Control + TeXML + Lines UI.
// Inputs: Who Answers mode + presence/capture plan + Available teammates.
// Outputs: who rings first, IVR fallback, and Labels for the "Rings now" strip.

import {
  getActiveRoutingModeForDid,
  getCustomRoutingPhoneForDid,
  getFirstAvailableOwnerReceptionist,
  getTeamReceptionistForDid,
} from "@/lib/active-routing-mode-db"
import {
  CAPTURE_DEFAULT_RING_E164,
  CAPTURE_STATUS_CALENDAR_BUSY,
  CAPTURE_STATUS_CALENDAR_OFF,
  CAPTURE_STATUS_PRESENCE_CLOSED,
  CAPTURE_STATUS_PRESENCE_ON_JOB,
  resolveInboundCapturePlan,
  type InboundCapturePlan,
} from "@/lib/inbound-time-capture"
import { isReasonablePstnDialString, normalizePhoneNumberE164 } from "@/lib/db"

/** Why the planner chose this hop (mirrors Call Control dialReason). */
export type InboundDialReason =
  | "day_dial"
  | "busy_backup_recv"
  | "team_receptionist"
  | "team_owner_available"
  | "busy_automation"
  | "custom_routing"
  | "legacy_recv"
  | "legacy_owner"
  | "failsafe"
  | "lyncr_pool"

export type InboundDialHopType =
  | "owner"
  | "receptionist"
  | "ivr"
  | "custom"
  | "none"
  | "pool"

/** One hop in the inbound waterfall (primary or fallback). */
export type InboundDialHop = {
  type: InboundDialHopType
  phoneE164: string | null
  name: string | null
  receptionistId: string | null
  reason: InboundDialReason
}

/** Full plan shared by voice webhooks and the Lines "Rings now" strip. */
export type InboundDialPlanResult = {
  mode: string
  captureKind: InboundCapturePlan["kind"]
  primaryHop: InboundDialHop
  fallbackHop: InboundDialHop
  /** PSTN to Dial right now — null means play the Busy / IVR menu. */
  dialTargetE164: string | null
  receptionistId: string | null
  routedToName: string | null
  reason: InboundDialReason
  /** True when Busy and an Available teammate owns first ring. */
  busyBackupLive: boolean
  /** True when automation / booking menu answers first (no PSTN hop). */
  ivrLive: boolean
  /** True when presence+calendar allow the owner cell. */
  ownerAvailable: boolean
  /** Short label for Lines: who rings on this call. */
  ringsNowLabel: string
  /** Short label for Lines: what happens if that hop misses. */
  ifNoAnswerLabel: string
  /** Available vs Busy for the strip badge. */
  presenceStatusLabel: "Available" | "Busy"
}

/** Pure inputs — unit tests call planInboundDial with these (no DB). */
export type PlanInboundDialInputs = {
  mode: string
  ownerPhoneE164: string
  captureKind: InboundCapturePlan["kind"]
  customPhoneE164?: string | null
  busyBackup?: {
    receptionistId: string
    name: string | null
    phoneE164: string
  } | null
  teamReceptionist?: {
    receptionistId: string
    name: string | null
    phoneE164: string | null
    isActive: boolean
  } | null
  legacyReceptionist?: {
    receptionistId: string
    name: string | null
    phoneE164: string
  } | null
  failsafePhoneE164?: string
}

function captureRoutedName(kind: InboundCapturePlan["kind"]): string {
  if (kind === "presence_closed") return CAPTURE_STATUS_PRESENCE_CLOSED
  if (kind === "presence_on_job") return CAPTURE_STATUS_PRESENCE_ON_JOB
  if (kind === "calendar_full_day") return CAPTURE_STATUS_CALENDAR_OFF
  if (kind === "calendar_partial") return CAPTURE_STATUS_CALENDAR_BUSY
  return "Owner"
}

function normalizeDialPhone(raw: string | null | undefined, failsafe: string): string {
  const trimmed = (raw || "").trim()
  if (!trimmed) return failsafe
  const e164 = normalizePhoneNumberE164(trimmed)
  if (e164 && isReasonablePstnDialString(e164)) return e164
  if (isReasonablePstnDialString(trimmed)) return trimmed
  return failsafe
}

function ivrHop(captureKind: InboundCapturePlan["kind"]): InboundDialHop {
  return {
    type: "ivr",
    phoneE164: null,
    name: captureRoutedName(captureKind),
    receptionistId: null,
    reason: "busy_automation",
  }
}

function ownerHop(phoneE164: string, reason: InboundDialReason): InboundDialHop {
  return {
    type: "owner",
    phoneE164,
    name: "Owner",
    receptionistId: null,
    reason,
  }
}

function receptionistHop(
  recv: { receptionistId: string; name: string | null; phoneE164: string },
  reason: InboundDialReason
): InboundDialHop {
  return {
    type: "receptionist",
    phoneE164: recv.phoneE164,
    name: recv.name?.trim() || "Receptionist",
    receptionistId: recv.receptionistId,
    reason,
  }
}

function finish(
  partial: Omit<
    InboundDialPlanResult,
    | "busyBackupLive"
    | "ivrLive"
    | "ownerAvailable"
    | "ringsNowLabel"
    | "ifNoAnswerLabel"
    | "presenceStatusLabel"
    | "dialTargetE164"
    | "receptionistId"
    | "routedToName"
    | "reason"
  > & {
    primaryHop: InboundDialHop
    fallbackHop: InboundDialHop
    captureKind: InboundCapturePlan["kind"]
  }
): InboundDialPlanResult {
  const primary = partial.primaryHop
  const fallback = partial.fallbackHop
  const ownerAvailable = partial.captureKind === "day_dial"
  const busyBackupLive =
    primary.type === "receptionist" &&
    (primary.reason === "busy_backup_recv" || primary.reason === "team_receptionist") &&
    !ownerAvailable
  const ivrLive = primary.type === "ivr"
  const presenceStatusLabel: "Available" | "Busy" = ownerAvailable ? "Available" : "Busy"

  let ringsNowLabel = primary.name || "—"
  if (primary.type === "ivr") ringsNowLabel = "Booking menu"
  if (primary.type === "custom") ringsNowLabel = primary.name || "Custom number"
  if (primary.type === "pool") ringsNowLabel = "Lyncr Pool"

  let ifNoAnswerLabel = fallback.name || "—"
  if (fallback.type === "ivr") ifNoAnswerLabel = "Booking menu"
  if (fallback.type === "owner") ifNoAnswerLabel = "Owner cell"
  if (fallback.type === "none") ifNoAnswerLabel = "Hang up"
  if (primary.type === "ivr") ifNoAnswerLabel = "Text booking link"

  return {
    ...partial,
    dialTargetE164: primary.phoneE164,
    receptionistId: primary.receptionistId,
    routedToName: primary.name,
    reason: primary.reason,
    busyBackupLive,
    ivrLive,
    ownerAvailable,
    ringsNowLabel,
    ifNoAnswerLabel,
    presenceStatusLabel,
  }
}

/**
 * Pure dial planner — same rules Call Control and TeXML must follow.
 * Available → owner (or team first). Busy + Available teammate → teammate. Else → IVR.
 */
export function planInboundDial(input: PlanInboundDialInputs): InboundDialPlanResult {
  const failsafe = input.failsafePhoneE164 || CAPTURE_DEFAULT_RING_E164
  const ownerDial = normalizeDialPhone(input.ownerPhoneE164, failsafe)
  const mode = (input.mode || "your_phone").trim().toLowerCase() || "your_phone"
  const captureKind = input.captureKind

  // Custom Routing — forward only to the configured number.
  if (mode === "custom_routing") {
    const custom = input.customPhoneE164?.trim() || ""
    if (custom && isReasonablePstnDialString(custom)) {
      const primary: InboundDialHop = {
        type: "custom",
        phoneE164: custom,
        name: "Custom Routing",
        receptionistId: null,
        reason: "custom_routing",
      }
      return finish({
        mode,
        captureKind,
        primaryHop: primary,
        fallbackHop: { type: "none", phoneE164: null, name: null, receptionistId: null, reason: "custom_routing" },
      })
    }
  }

  // Team receptionist → Available teammate first; else owner if Available; else automation.
  if (mode === "team_receptionist") {
    const team = input.teamReceptionist
    const receptionistCanAnswer =
      Boolean(team?.isActive) &&
      Boolean(team?.phoneE164) &&
      isReasonablePstnDialString(team!.phoneE164!)
    if (receptionistCanAnswer && team) {
      return finish({
        mode,
        captureKind,
        primaryHop: receptionistHop(
          {
            receptionistId: team.receptionistId,
            name: team.name,
            phoneE164: team.phoneE164!,
          },
          "team_receptionist"
        ),
        fallbackHop:
          captureKind === "day_dial" ? ownerHop(ownerDial, "team_owner_available") : ivrHop(captureKind),
      })
    }
    if (captureKind === "day_dial") {
      return finish({
        mode,
        captureKind,
        primaryHop: ownerHop(ownerDial, "team_owner_available"),
        fallbackHop: ivrHop(captureKind),
      })
    }
    return finish({
      mode,
      captureKind,
      primaryHop: ivrHop(captureKind),
      fallbackHop: { type: "none", phoneE164: null, name: null, receptionistId: null, reason: "busy_automation" },
    })
  }

  // Your Phone / Smart IVR — Available rings owner; Busy rings Available teammate before automation.
  if (mode === "your_phone" || mode === "smart_ivr") {
    if (captureKind !== "day_dial") {
      const backup = input.busyBackup
      if (backup?.phoneE164 && isReasonablePstnDialString(backup.phoneE164)) {
        return finish({
          mode,
          captureKind,
          primaryHop: receptionistHop(backup, "busy_backup_recv"),
          fallbackHop: ivrHop(captureKind),
        })
      }
      return finish({
        mode,
        captureKind,
        primaryHop: ivrHop(captureKind),
        fallbackHop: { type: "none", phoneE164: null, name: null, receptionistId: null, reason: "busy_automation" },
      })
    }
    return finish({
      mode,
      captureKind,
      primaryHop: ownerHop(ownerDial, "day_dial"),
      fallbackHop: ivrHop(captureKind),
    })
  }

  // Lyncr Pool — network answers in-browser (TeXML handles pool dial separately).
  if (mode === "lyncr_pool") {
    return finish({
      mode,
      captureKind,
      primaryHop: {
        type: "pool",
        phoneE164: null,
        name: "Lyncr Pool",
        receptionistId: null,
        reason: "lyncr_pool",
      },
      fallbackHop: ivrHop(captureKind),
    })
  }

  // Pool / unknown mode — legacy selected-receptionist-or-owner.
  const legacy = input.legacyReceptionist
  if (legacy?.phoneE164 && isReasonablePstnDialString(legacy.phoneE164)) {
    return finish({
      mode,
      captureKind,
      primaryHop: receptionistHop(legacy, "legacy_recv"),
      fallbackHop: ownerHop(ownerDial, "legacy_owner"),
    })
  }

  return finish({
    mode,
    captureKind,
    primaryHop: ownerHop(ownerDial, "failsafe"),
    fallbackHop: ivrHop(captureKind),
  })
}

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
  const ownerPhoneE164 = normalizeDialPhone(params.ownerPhone, failsafe)

  let mode = (params.mode || "").trim() || "your_phone"
  if (!params.mode) {
    try {
      mode = await getActiveRoutingModeForDid(params.businessLineE164)
    } catch (e) {
      console.warn("[inbound-dial-plan] mode lookup skipped:", e)
    }
  }

  let capturePlan: InboundCapturePlan =
    params.capturePlan || { kind: "day_dial" }
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

/**
 * Client-side strip labels — mirrors planner rules without a network round-trip.
 * Keep in sync with planInboundDial for Your Phone / Smart IVR + Busy backup.
 */
export function deriveRingsNowStrip(params: {
  presenceBypass: boolean
  presenceReady: boolean
  teamRosterReady: boolean
  busyBackupName: string | null
  ownerLabel: string
  activeRoutingMode?: string | null
  teamReceptionistName?: string | null
  teamReceptionistActive?: boolean
}): {
  ringsNow: string
  ifNoAnswer: string
  statusLabel: "Available" | "Busy" | "…"
} {
  if (!params.presenceReady) {
    return { ringsNow: "…", ifNoAnswer: "…", statusLabel: "…" }
  }
  const mode = (params.activeRoutingMode || "your_phone").trim().toLowerCase()
  const busy = params.presenceBypass
  const backup = params.busyBackupName?.trim() || ""
  const teamName = params.teamReceptionistName?.trim() || ""
  const owner = params.ownerLabel?.trim() || "Owner"

  if (mode === "team_receptionist") {
    if (params.teamReceptionistActive && teamName) {
      return {
        ringsNow: teamName,
        ifNoAnswer: busy ? "Booking menu" : owner,
        statusLabel: busy ? "Busy" : "Available",
      }
    }
    if (!busy) {
      return { ringsNow: owner, ifNoAnswer: "Booking menu", statusLabel: "Available" }
    }
    return { ringsNow: "Booking menu", ifNoAnswer: "Text booking link", statusLabel: "Busy" }
  }

  if (busy) {
    // Gate on roster ready so we do not flash "Booking menu" before Alex hydrates.
    if (!params.teamRosterReady) {
      return { ringsNow: "…", ifNoAnswer: "…", statusLabel: "Busy" }
    }
    if (backup) {
      return { ringsNow: backup, ifNoAnswer: "Booking menu", statusLabel: "Busy" }
    }
    return { ringsNow: "Booking menu", ifNoAnswer: "Text booking link", statusLabel: "Busy" }
  }

  return { ringsNow: owner, ifNoAnswer: "Booking menu", statusLabel: "Available" }
}
