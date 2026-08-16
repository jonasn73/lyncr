/**
 * Pick the best open Collect job for a customer phone.
 * Used when CRM / Messages Collect should open the job charge — not walk-up.
 */

import type { DispatchJob } from "@/lib/types"
import { phoneMatchKey } from "@/lib/messages-deep-link"

/** True when Collect should still treat this job as open. */
export function isOpenCollectJobStatus(jobStatus: string | null | undefined): boolean {
  const s = (jobStatus ?? "").toLowerCase()
  return s !== "completed" && s !== "cancelled" && s !== "canceled"
}

/**
 * Newest open job whose customer phone matches (last 10 digits).
 * Returns null when there is no match — caller may fall back to walk-up Collect.
 */
export function pickOpenCollectJobForPhone(
  jobs: readonly DispatchJob[],
  phone: string | null | undefined
): DispatchJob | null {
  const want = phoneMatchKey(phone || "")
  if (!want) return null
  const matches = jobs.filter((job) => {
    if (!isOpenCollectJobStatus(job.job_status)) return false
    const jobPhone = phoneMatchKey(job.customer_phone || "")
    return Boolean(jobPhone && jobPhone === want)
  })
  if (matches.length === 0) return null
  // Newest open job first when several share one phone.
  return [...matches].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]
}
