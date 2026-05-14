/**
 * Large structured `console.log(JSON.stringify(...))` calls add measurable latency on serverless
 * (serialization + log pipeline). In production, hot-path voice logs are off unless explicitly enabled.
 *
 * Set `ZING_VOICE_DEBUG_LOGS=1` on Vercel to restore full routing / PSTN / fallback JSON lines.
 */
export function shouldEmitVoiceHotPathDebugLogs(): boolean {
  if (process.env.NODE_ENV !== "production") return true
  return ["1", "true", "yes", "on"].includes((process.env.ZING_VOICE_DEBUG_LOGS || "").trim().toLowerCase())
}
