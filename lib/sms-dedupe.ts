/**
 * Stop sending the same customer SMS twice (booked note, missed-call link, leftover cover).
 */

/** Collapse spaces/case so two copies of the same text match. */
function normalizeCustomerSmsBody(text: string): string {
  // Turn missing text into an empty string so callers never crash.
  const raw = String(text || "")
  // Ignore capital letters — "Hi Jade" and "hi jade" are the same.
  const lower = raw.toLowerCase()
  // Smash extra spaces/newlines into one space.
  const spaced = lower.replace(/\s+/g, " ")
  // Trim the ends.
  return spaced.trim()
}

/** True when two outbound texts are the same follow-up, not a new kind of message. */
export function smsBodiesLookDuplicate(a: string, b: string): boolean {
  // Normalize both sides the same way.
  const x = normalizeCustomerSmsBody(a)
  const y = normalizeCustomerSmsBody(b)
  // Empty text is not a duplicate of anything.
  if (!x || !y) return false
  // Exact same wording.
  if (x === y) return true
  // Same “you're booked” note (shop Follow-up template).
  if (x.includes("is booked") && y.includes("is booked")) return true
  // Same leftover / we-got-it cover.
  if (x.includes("we got your request") && y.includes("we got your request")) return true
  // Same missed-call / press-1 book link.
  if (x.includes("when you need us") && y.includes("when you need us")) return true
  // Same return-call “couldn't reach you” follow-up.
  if (x.includes("we tried calling") && y.includes("we tried calling")) return true
  // Different kinds of texts (book link vs booked note) are not duplicates.
  return false
}
