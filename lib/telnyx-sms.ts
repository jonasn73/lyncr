// Telnyx outbound SMS (lead alerts to owner).

import {
  getPhoneNumbers,
  getProviderLinkedActiveNumber,
  normalizePhoneNumberE164,
} from "@/lib/db"
import {
  configureNumberMessaging,
  ensureMessagingProfileWhitelisted,
  getOrCreateMessagingProfile,
  getTelnyx10DlcAssignmentStatus,
  isTelnyxOwnedNumber,
} from "@/lib/telnyx-messaging-config"

/** Env vars that may hold a verified outbound SMS DID (first non-empty wins in order). */
function readEnvMessagingFromCandidates(): string[] {
  const keys = [
    "TELNYX_OUTBOUND_NUMBER",
    "TELNYX_MESSAGING_FROM_E164",
    "TELNYX_PHONE_NUMBER",
    "TELNYX_FROM_NUMBER",
    "TELNYX_SMS_FROM",
  ] as const
  const out: string[] = []
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (!raw) continue
    const e164 = normalizePhoneNumberE164(raw)
    if (e164 && !out.includes(e164)) out.push(e164)
  }
  return out
}

type TelnyxErrorBody = {
  errors?: { code?: string; title?: string; detail?: string }[]
}

/** Shown to owners when carriers block outbound SMS (missing / unregistered 10DLC). */
export const TEN_DLC_BLOCK_USER_MESSAGE =
  "Message blocked by carrier due to missing 10DLC profile registration."

export type TelnyxSmsErrorType = "10DLC_BLOCK" | "OTHER"

/** Classify a Telnyx SMS API error body or message for owner-facing handling. */
export function classifyTelnyxSmsError(raw: string): { errorType: TelnyxSmsErrorType; message: string } {
  let code: string | undefined
  let title = ""
  let detail = ""
  try {
    const parsed = JSON.parse(raw) as TelnyxErrorBody
    const err = parsed.errors?.[0]
    code = err?.code != null ? String(err.code) : undefined
    title = err?.title ?? ""
    detail = err?.detail ?? ""
  } catch {
    // Not JSON — fall through to pattern match on raw text.
  }

  const blob = `${code ?? ""} ${title} ${detail} ${raw}`.toLowerCase()
  const is10Dlc =
    code === "40011" ||
    /10dlc|unregistered.*traffic|a2p|campaign.*not assigned|missing.*10dlc/i.test(blob)

  if (is10Dlc) {
    return { errorType: "10DLC_BLOCK", message: TEN_DLC_BLOCK_USER_MESSAGE }
  }

  const formatted = formatTelnyxSmsError(raw, null)
  return { errorType: "OTHER", message: formatted }
}

/** True when a post-accept delivery_warning means US carriers will block the text. */
export function is10DlcDeliveryWarning(warning: string | null | undefined): boolean {
  if (!warning?.trim()) return false
  return /10dlc|campaign not assigned|carriers block/i.test(warning)
}

export type TelnyxSmsSendResult =
  | {
      ok: true
      message_id: string | null
      from: string
      to: string
      /** Set when Telnyx accepts the message but carrier delivery may still fail (e.g. missing 10DLC). */
      delivery_warning: string | null
    }
  | { ok: false; error: string; errorType?: TelnyxSmsErrorType }

function formatTelnyxSmsError(raw: string, fromE164: string | null): string {
  try {
    const parsed = JSON.parse(raw) as TelnyxErrorBody
    const err = parsed.errors?.[0]
    if (!err) return raw.slice(0, 240)
    if (err.code === "40305") {
      return `SMS sender ${fromE164 ?? "unknown"} is not on your Telnyx messaging profile — click Repair SMS on the admin sandbox`
    }
    if (err.code === "40013" || /invalid (messaging )?source number/i.test(`${err.title} ${err.detail}`)) {
      return `SMS sender ${fromE164 ?? "unknown"} is not a valid Telnyx messaging source — use an active SMS-enabled business line`
    }
    if (err.title && err.detail) return `${err.title}: ${err.detail}`
    if (err.detail) return err.detail
    if (err.title) return err.title
  } catch {
    // Not JSON — return trimmed text.
  }
  return raw.slice(0, 240)
}

function isInvalidFromAddressError(raw: string): boolean {
  const blob = raw.toLowerCase()
  return (
    raw.includes("40305") ||
    raw.includes("40013") ||
    blob.includes("invalid 'from' address") ||
    blob.includes("invalid source number") ||
    blob.includes("invalid messaging source number")
  )
}

/** Ordered "from" candidates for one owner (workspace DIDs first, then env). */
async function listOwnerSmsFromCandidates(userId?: string): Promise<string[]> {
  const out: string[] = []
  const add = (raw: string | null | undefined) => {
    const e164 = raw ? normalizePhoneNumberE164(raw) : ""
    if (e164 && !out.includes(e164)) out.push(e164)
  }

  if (userId) {
    add(await getProviderLinkedActiveNumber(userId))
    try {
      const lines = await getPhoneNumbers(userId)
      for (const line of lines) {
        if (line.status !== "active") continue
        if (!(line.provider_number_sid?.trim() || line.twilio_sid?.trim())) continue
        add(line.number)
      }
    } catch {
      // Schema/query issues — keep the primary candidate only.
    }
  }

  for (const envFrom of readEnvMessagingFromCandidates()) add(envFrom)

  if (!userId) {
    add(await getProviderLinkedActiveNumber())
  }

  return out
}

function isMissingWhitelistError(raw: string): boolean {
  return raw.toLowerCase().includes("whitelisted destinations")
}

async function buildDeliveryWarning(fromE164: string): Promise<string | null> {
  const dlc = await getTelnyx10DlcAssignmentStatus(fromE164)
  return dlc.assigned ? null : dlc.detail
}

/**
 * Resolve outbound SMS sender — Neon purchased line wins over Vercel env
 * (avoids typos like +15025758186 vs +15025758166).
 */
export async function resolveTelnyxMessagingFromE164(userId?: string): Promise<string | null> {
  const dbRaw =
    (await getProviderLinkedActiveNumber(userId)) ??
    (userId ? null : await getProviderLinkedActiveNumber())
  const dbFrom = dbRaw ? normalizePhoneNumberE164(dbRaw) : ""

  if (dbFrom) {
    for (const envFrom of readEnvMessagingFromCandidates()) {
      if (envFrom !== dbFrom) {
        console.warn(
          `[Telnyx SMS] Ignoring env SMS from=${envFrom} — using purchased line ${dbFrom}`
        )
      }
    }
    return dbFrom
  }

  for (const envFrom of readEnvMessagingFromCandidates()) {
    if (await isTelnyxOwnedNumber(envFrom)) return envFrom
  }
  return null
}

/**
 * Send a plain SMS via Telnyx REST API.
 * Returns ok:true when Telnyx accepts the message (not guaranteed phone delivery).
 * Never throws — callers get { ok: false } on carrier/config failures.
 */
export async function sendTelnyxSms(params: {
  toE164: string
  text: string
  userId?: string
  fromE164?: string
}): Promise<TelnyxSmsSendResult> {
  try {
    const apiKey = process.env.TELNYX_API_KEY?.trim()
    if (!apiKey) {
      console.warn("Telnyx SMS skipped: Missing local environment variables")
      return {
        ok: false,
        error: "Telnyx SMS skipped: Missing local environment variables (TELNYX_API_KEY)",
      }
    }

    // Explicit caller ID first, then workspace/account resolver — always E.164 with '+'.
    let from = normalizePhoneNumberE164(
      params.fromE164?.trim() || (await resolveTelnyxMessagingFromE164(params.userId)) || ""
    )
    if (!from) {
      console.warn("Telnyx SMS skipped: Missing local environment variables")
      return {
        ok: false,
        error:
          "Telnyx SMS skipped: Missing local environment variables (TELNYX_PHONE_NUMBER / TELNYX_MESSAGING_FROM_E164) or no SMS-ready business line",
      }
    }

    if (!(await isTelnyxOwnedNumber(from))) {
      const fallback = await resolveTelnyxMessagingFromE164(params.userId)
      if (fallback && fallback !== from) from = fallback
    }

    const toE164 = normalizePhoneNumberE164(params.toE164)
    if (!toE164) {
      console.error("[Telnyx SMS] invalid destination number:", params.toE164)
      return { ok: false, error: "Invalid destination phone number" }
    }

    const sendOnce = async (fromE164: string, messagingProfileId: string | null) => {
      const body: Record<string, string> = {
        from: fromE164, // Verified outbound virtual number (source caller ID)
        to: toE164,
        text: params.text,
      }
      if (messagingProfileId) body.messaging_profile_id = messagingProfileId

      return fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
    }

    const successResult = async (
      res: Response,
      fromE164: string
    ): Promise<TelnyxSmsSendResult> => {
      const successBody = await res.json().catch(() => ({}))
      const messageId = (successBody as { data?: { id?: string } })?.data?.id ?? null
      const delivery_warning = await buildDeliveryWarning(fromE164)
      return {
        ok: true,
        message_id: messageId,
        from: fromE164,
        to: toE164,
        delivery_warning,
      }
    }

    let messagingProfileId: string | null = null
    try {
      messagingProfileId = await getOrCreateMessagingProfile()
      await configureNumberMessaging(from)
    } catch (e) {
      console.error("[Telnyx SMS] pre-send messaging setup:", e)
    }

    let res = await sendOnce(from, messagingProfileId)
    if (!res.ok) {
      let errText = await res.text().catch(() => res.statusText)
      if (isMissingWhitelistError(errText) && messagingProfileId) {
        try {
          await ensureMessagingProfileWhitelisted(messagingProfileId)
          res = await sendOnce(from, messagingProfileId)
          if (res.ok) return successResult(res, from)
          errText = await res.text().catch(() => res.statusText)
        } catch (whitelistErr) {
          const msg = whitelistErr instanceof Error ? whitelistErr.message : String(whitelistErr)
          console.error("[Telnyx SMS] whitelist repair failed:", msg)
          return { ok: false, error: msg }
        }
      }
      if (isInvalidFromAddressError(errText)) {
        // Repair messaging profile, then try other owner/env DIDs (same account only).
        const candidates: string[] = []
        for (const n of [from, ...(await listOwnerSmsFromCandidates(params.userId))]) {
          if (!candidates.includes(n)) candidates.push(n)
        }
        for (const candidate of candidates) {
          try {
            await configureNumberMessaging(candidate)
            if (!messagingProfileId) {
              messagingProfileId = await getOrCreateMessagingProfile()
            }
            res = await sendOnce(candidate, messagingProfileId)
            if (res.ok) {
              from = candidate
              return successResult(res, from)
            }
            errText = await res.text().catch(() => res.statusText)
            if (!isInvalidFromAddressError(errText)) break
          } catch (repairErr) {
            console.warn("[Telnyx SMS] skip invalid from candidate:", candidate, repairErr)
          }
        }
      }
      const classified = classifyTelnyxSmsError(errText)
      console.error("[Telnyx SMS] send rejected:", {
        to: toE164,
        from,
        errorType: classified.errorType,
        detail: errText.slice(0, 500),
      })
      return { ok: false, error: classified.message, errorType: classified.errorType }
    }

    return successResult(res, from)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error("[Telnyx SMS] unexpected send failure:", detail)
    return { ok: false, error: detail.slice(0, 240) }
  }
}
