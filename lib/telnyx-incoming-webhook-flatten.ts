// Flatten Telnyx (and similar) JSON voice webhooks into a string map so TeXML handlers can use `pickField` / `resolveCalledParty`.

/**
 * Telnyx often nests callee / call id under `data.payload` (not only top-level `data.to`).
 * Recurses into `data`, `payload`, and `record` objects only — avoids walking huge unrelated JSON trees.
 */
export function flattenJsonWebhookToStringMap(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (key: string, val: unknown) => {
    if (val === null || val === undefined) return
    if (typeof val === "object" && !Array.isArray(val)) return
    const s = String(val).trim()
    if (!s) return
    if (out[key] == null || out[key] === "") out[key] = s
    const lk = String(key).toLowerCase()
    if (lk === "to" && key !== "To") put("To", val)
    if (lk === "from" && key !== "From") put("From", val)
    if (lk === "call_control_id" && key !== "CallSid") put("CallSid", val)
  }
  const shouldRecurse = (key: string) => {
    const k = key.toLowerCase()
    return k === "data" || k === "payload" || k === "record"
  }
  const walk = (obj: Record<string, unknown>, depth: number) => {
    if (depth > 8) return
    for (const [ik, iv] of Object.entries(obj)) {
      if (iv !== null && typeof iv === "object" && !Array.isArray(iv)) {
        if (shouldRecurse(ik)) walk(iv as Record<string, unknown>, depth + 1)
        continue
      }
      if (Array.isArray(iv)) continue
      put(ik, iv)
    }
  }
  for (const [k, v] of Object.entries(body)) {
    put(k, v)
    if (v && typeof v === "object" && !Array.isArray(v) && (k === "data" || k.toLowerCase() === "payload")) {
      walk(v as Record<string, unknown>, 0)
    }
  }
  const rootPayload = body.payload
  if (rootPayload && typeof rootPayload === "object" && !Array.isArray(rootPayload)) {
    walk(rootPayload as Record<string, unknown>, 0)
  }
  return out
}
