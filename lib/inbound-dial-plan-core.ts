// Pure inbound dial planner + Lines strip helpers (client-safe — no DB / Neon imports).
// Call Control + TeXML load teammates via resolveInboundDialPlan in inbound-dial-plan.ts.

import { toE164 } from "@/lib/phone-e164"

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

export type InboundCaptureKind =
  | "presence_closed"
  | "presence_on_job"
  | "calendar_full_day"
  | "calendar_partial"
  | "day_dial"

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
  captureKind: InboundCaptureKind
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
  captureKind: InboundCaptureKind
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

const FAILSAFE_E164 = "+15022602716"

function isReasonablePstn(e164: string): boolean {
  const d = String(e164 ?? "").replace(/\D/g, "")
  return d.length >= 10 && d.length <= 15
}

function captureRoutedName(kind: InboundCaptureKind): string {
  if (kind === "presence_closed") return "Presence Closed"
  if (kind === "presence_on_job") return "Presence On-Job"
  if (kind === "calendar_full_day") return "Calendar Day Off"
  if (kind === "calendar_partial") return "Calendar Busy"
  return "Owner"
}

function normalizeDialPhone(raw: string | null | undefined, failsafe: string): string {
  const trimmed = (raw || "").trim()
  if (!trimmed) return failsafe
  try {
    const e164 = toE164(trimmed)
    if (e164 && isReasonablePstn(e164)) return e164
  } catch {
    /* fall through */
  }
  if (isReasonablePstn(trimmed)) return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/\D/g, "")}`
  return failsafe
}

function ivrHop(captureKind: InboundCaptureKind): InboundDialHop {
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
    captureKind: InboundCaptureKind
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
  const failsafe = input.failsafePhoneE164 || FAILSAFE_E164
  const ownerDial = normalizeDialPhone(input.ownerPhoneE164, failsafe)
  const mode = (input.mode || "your_phone").trim().toLowerCase() || "your_phone"
  const captureKind = input.captureKind

  if (mode === "custom_routing") {
    const custom = input.customPhoneE164?.trim() || ""
    if (custom && isReasonablePstn(custom)) {
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
        fallbackHop: {
          type: "none",
          phoneE164: null,
          name: null,
          receptionistId: null,
          reason: "custom_routing",
        },
      })
    }
  }

  if (mode === "team_receptionist") {
    const team = input.teamReceptionist
    const receptionistCanAnswer =
      Boolean(team?.isActive) &&
      Boolean(team?.phoneE164) &&
      isReasonablePstn(team!.phoneE164!)
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
      fallbackHop: {
        type: "none",
        phoneE164: null,
        name: null,
        receptionistId: null,
        reason: "busy_automation",
      },
    })
  }

  if (mode === "your_phone" || mode === "smart_ivr") {
    if (captureKind !== "day_dial") {
      const backup = input.busyBackup
      if (backup?.phoneE164 && isReasonablePstn(backup.phoneE164)) {
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
        fallbackHop: {
          type: "none",
          phoneE164: null,
          name: null,
          receptionistId: null,
          reason: "busy_automation",
        },
      })
    }
    return finish({
      mode,
      captureKind,
      primaryHop: ownerHop(ownerDial, "day_dial"),
      fallbackHop: ivrHop(captureKind),
    })
  }

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

  const legacy = input.legacyReceptionist
  if (legacy?.phoneE164 && isReasonablePstn(legacy.phoneE164)) {
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
