/**
 * Large structured `console.log(JSON.stringify(...))` calls add measurable latency on serverless
 * (serialization + log pipeline). In production, hot-path voice logs are off unless explicitly enabled.
 *
 * Set `LYNCR_VOICE_DEBUG_LOGS=1` on Vercel (legacy `ZING_VOICE_DEBUG_LOGS` still works).
 */
import { envFlagOn } from "@/lib/lyncr-env"

export function shouldEmitVoiceHotPathDebugLogs(): boolean {
  if (process.env.NODE_ENV !== "production") return true
  return envFlagOn("VOICE_DEBUG_LOGS")
}
