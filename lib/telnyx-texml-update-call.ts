// TeXML REST: redirect a live CallSid to a new instruction URL (voicemail / fallback).
// Call Control hangup APIs do not accept TeXML CallSids — use this for Decline → voicemail.

export type TexmlUpdateCallResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

function accountSid(): string | null {
  return (
    process.env.TELNYX_ACCOUNT_SID?.trim() ||
    process.env.TELNYX_TEXML_ACCOUNT_SID?.trim() ||
    null
  )
}

/** Redirect an in-progress TeXML call to fetch new instructions from `url`. */
export async function telnyxTexmlRedirectCall(params: {
  callSid: string
  url: string
}): Promise<TexmlUpdateCallResult> {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  const callSid = params.callSid.trim()
  const url = params.url.trim()
  if (!apiKey) return { ok: false, error: "TELNYX_API_KEY missing" }
  if (!callSid) return { ok: false, error: "missing_call_sid" }
  if (!url) return { ok: false, error: "missing_redirect_url" }

  const form = new URLSearchParams()
  form.set("Url", url)
  form.set("Method", "POST")

  const account = accountSid()
  const endpoints = account
    ? [
        `https://api.telnyx.com/v2/texml/Accounts/${encodeURIComponent(account)}/Calls/${encodeURIComponent(callSid)}`,
      ]
    : [
        // Fallback path used by some TeXML apps when account sid env is unset.
        `https://api.telnyx.com/v2/texml/calls/${encodeURIComponent(callSid)}/update`,
      ]

  let lastError = "TeXML update failed"
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      })
      if (res.ok) return { ok: true }
      const text = await res.text().catch(() => res.statusText)
      lastError = `Telnyx ${res.status}: ${text.slice(0, 240)}`
      // 404 on account-scoped path → try alternate if we add more later.
      if (res.status !== 404) {
        return { ok: false, error: lastError, status: res.status }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, error: lastError }
}
