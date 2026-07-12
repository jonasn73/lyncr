// Deterministic CNAM-style tokens for unknown inbound callers (client-safe).

/** North American Numbering Plan area code → display region. */
const NPA_REGION_LABEL: Record<string, string> = {
  "202": "Washington, DC",
  "212": "New York, NY",
  "213": "Los Angeles, CA",
  "305": "Miami, FL",
  "312": "Chicago, IL",
  "404": "Atlanta, GA",
  "415": "San Francisco, CA",
  "502": "Louisville, KY",
  "503": "Portland, OR",
  "512": "Austin, TX",
  "615": "Nashville, TN",
  "617": "Boston, MA",
  "702": "Las Vegas, NV",
  "704": "Charlotte, NC",
  "713": "Houston, TX",
  "718": "New York, NY",
  "720": "Denver, CO",
  "813": "Tampa, FL",
  "859": "Lexington, KY",
  "901": "Memphis, TN",
  "917": "New York, NY",
}

/** Digits-only phone key (last 10 when possible). */
export function phoneDigitsKey(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "")
  if (d.length >= 11 && d.startsWith("1")) return d.slice(-10)
  return d.slice(-10) || d
}

/**
 * CNAM utility string for unknown callers.
 * Example: "Louisville, KY • Verified Personal Line"
 */
export function formatUnknownCallerCnamToken(phone: string | null | undefined): string {
  const digits = phoneDigitsKey(phone)
  const npa = digits.length >= 10 ? digits.slice(0, 3) : ""
  const region = (npa && NPA_REGION_LABEL[npa]) || "US"
  return `${region} • Verified Personal Line`
}
