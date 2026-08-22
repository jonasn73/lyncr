/**
 * Merge CRM list paint heads into session/network lists — stops name/status
 * flicker on rows already painted (Messages thread-merge pattern).
 */

import type { CrmCustomerListItem } from "@/lib/types"

/** Live list still contains every painted customer id. */
export function crmListIsQuietExpansion(
  painted: CrmCustomerListItem[],
  live: CrmCustomerListItem[]
): boolean {
  if (painted.length === 0 || live.length < painted.length) return false
  const liveIds = new Set(live.map((r) => r.id))
  return painted.every((p) => liveIds.has(p.id))
}

/** Keep painted rows for stable names; append new customers from live. */
export function mergePaintedCrmHeads(
  painted: CrmCustomerListItem[],
  live: CrmCustomerListItem[]
): CrmCustomerListItem[] {
  if (painted.length === 0) return live
  const paintedIds = new Set(painted.map((r) => r.id))
  const liveIds = new Set(live.map((r) => r.id))
  const merged: CrmCustomerListItem[] = []
  for (const row of painted) {
    if (liveIds.has(row.id)) merged.push(row)
  }
  for (const row of live) {
    if (!paintedIds.has(row.id)) merged.push(row)
  }
  return merged
}
