import type { ActiveCallRow } from "@/lib/hooks/use-active-call-form"

/**
 * Field-for-field comparison of two call rows.
 *
 * The answered-call poll re-sends the same handful of fields every few seconds.
 * Callers use this to keep the previous object when a tick carries no change, so
 * effects and memos keyed on the row do not re-run for nothing.
 *
 * ActiveCallRow is a flat record of primitives. A missing key and an explicit
 * undefined count as the same value, so a merge that only adds optional keys is
 * not reported as a difference.
 */
export function sameCallRow(a: ActiveCallRow, b: ActiveCallRow): boolean {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!Object.is(left[key], right[key])) return false
  }
  return true
}
