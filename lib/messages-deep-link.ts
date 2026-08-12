/**
 * Messages inbox deep-link helpers (`/dashboard/messages?phone=`).
 * Keep selection stable across poll/refetch — only apply a phone query once, then clear it.
 */

/** Last 10 digits — matches Activity/CRM deep-links that use display formatting. */
export function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10)
}

/**
 * Resolve which conversation phone to open from `?phone=`.
 * Prefer an existing inbox thread key so history binds immediately.
 * Returns null when the query is missing or too short to match reliably.
 */
export function resolveMessagesDeepLinkPhone(
  phoneQuery: string | null | undefined,
  threads: ReadonlyArray<{ customerPhone: string }>
): string | null {
  const q = phoneQuery?.trim()
  if (!q) return null
  const key = phoneMatchKey(q)
  if (key.length < 10) return null
  const match = threads.find((t) => phoneMatchKey(t.customerPhone) === key)
  return match?.customerPhone ?? q
}

/**
 * Guard: a deep-link phone must open the thread once.
 * After we record the consumed key (and clear the URL), poll/refetch must NOT re-apply
 * the same query — otherwise tapping another conversation gets yanked back.
 */
export function shouldApplyMessagesDeepLink(opts: {
  phoneQuery: string | null | undefined
  /** Last-10 key already applied for the current URL phone param. */
  lastAppliedKey: string | null
}): { apply: true; key: string } | { apply: false } {
  const q = opts.phoneQuery?.trim()
  if (!q) return { apply: false }
  const key = phoneMatchKey(q)
  if (key.length < 10) return { apply: false }
  // Same deep-link already applied — ignore (threads array identity changes on poll).
  if (opts.lastAppliedKey === key) return { apply: false }
  return { apply: true, key }
}
