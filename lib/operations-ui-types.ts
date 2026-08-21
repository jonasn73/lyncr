/** Shared Activity row shape — safe for server + client (no "use client"). */

import type { CallActivityContext } from "@/lib/types"

export type UiCallType = "incoming" | "outgoing" | "missed" | "voicemail"

export interface UiCallRecord {
  id: string
  type: UiCallType
  callerName: string
  callerNumber: string
  /** Business line dialed (E.164). */
  targetLineE164: string
  routedTo: string
  routedToReceptionistId: string | null
  routedInitials: string
  routedColor: string
  date: string
  time: string
  /** ISO timestamp from call_logs.created_at for sorting and display. */
  createdAt: string
  /** Raw call_logs.call_type before UI normalization (e.g. manual_intake). */
  rawCallType: string
  /** Raw call_logs.status for missed-call detection. */
  callStatus: string
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number
  hasRecording: boolean
  recordingUrl: string | null
  /** Intake panel action + scheduling summary from /api/calls. */
  activity: CallActivityContext | null
}
