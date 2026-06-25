/** Query/body flag: pass-1 caller greeting already played (pass-2 cell forward). */
export const INBOUND_GREETING_PASS_PARAM = "lyncrGreet"

/** Legacy pass flag from before lyncr rebrand — still accepted on inbound webhooks. */
const LEGACY_INBOUND_GREETING_PASS_PARAMS = ["zingGreet", "ZingGreet", "zing_greet"] as const

function greetingPassFlag(value: string | null | undefined): boolean {
  const v = value?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

/** True when pass 1 already played (`lyncrGreet=1` on URL or Telnyx POST body). */
export function inboundGreetingPassDone(
  searchParams: { get(name: string): string | null },
  fields?: Record<string, string>
): boolean {
  if (greetingPassFlag(searchParams.get(INBOUND_GREETING_PASS_PARAM))) return true
  if (!fields) return false
  if (greetingPassFlag(fields[INBOUND_GREETING_PASS_PARAM])) return true
  for (const key of LEGACY_INBOUND_GREETING_PASS_PARAMS) {
    if (greetingPassFlag(fields[key])) return true
  }
  if (greetingPassFlag(searchParams.get("zingGreet"))) return true
  return false
}

/** Pass-2 continue URL — marks greeting complete for cell PSTN forward. */
export function buildInboundGreetingContinueUrl(incomingUrl: string): string {
  const url = new URL(incomingUrl)
  url.searchParams.set(INBOUND_GREETING_PASS_PARAM, "1")
  url.searchParams.delete("zingGreet")
  return url.toString()
}
