// client_state blob passed through Telnyx Call Control commands (base64 JSON).

export type TelnyxCallControlPhase =
  | "await_caller_answered"
  | "await_greeting_end"
  | "await_dial_end"
  | "await_voicemail_prompt_end"
  | "recording"

export type TelnyxCallControlClientState = {
  v: 1
  phase: TelnyxCallControlPhase
  userId: string
  businessLineE164: string
  callerE164: string
  /** Inbound caller leg — used to play voicemail after an outbound dial times out. */
  inboundCallControlId?: string
  /** Outbound PSTN (cell) dial leg — hang this up when the caller disconnects. */
  outboundCallControlId?: string
  dialTargetE164?: string
  ringTimeoutSec?: number
  fallbackType?: "voicemail" | "ai" | "owner"
}

export function encodeTelnyxCallControlState(state: TelnyxCallControlClientState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64")
}

export function decodeTelnyxCallControlState(raw: string | null | undefined): TelnyxCallControlClientState | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  try {
    const json = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) as TelnyxCallControlClientState
    if (json?.v !== 1 || !json.phase || !json.userId) return null
    return json
  } catch {
    return null
  }
}
