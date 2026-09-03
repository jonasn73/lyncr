// Release a business line — carrier delete + mark inactive in our database.

import {
  countActivePhoneNumbers,
  getPhoneNumberByIdForUser,
  markPhoneNumberReleasedForUser,
} from "@/lib/db"
import { releaseTelnyxPhoneNumber } from "@/lib/telnyx-release-line"

type ReleaseNumberBlockReason = "not_found" | "last_line" | "porting_line" | "not_active" | "carrier_error"

export type ReleasePhoneNumberResult =
  | { ok: true; phone_number: string }
  | { ok: false; error: string; reason: ReleaseNumberBlockReason }

/** Release one owned business line when the account still has at least one other active line. */
export async function releasePhoneNumberForUser(
  userId: string,
  phoneNumberId: string
): Promise<ReleasePhoneNumberResult> {
  const row = await getPhoneNumberByIdForUser(phoneNumberId, userId)
  if (!row) {
    return { ok: false, error: "That line was not found on your account.", reason: "not_found" }
  }

  if (row.status === "porting") {
    return {
      ok: false,
      error: "This number is still being ported in. Cancel the port request first, or contact support.",
      reason: "porting_line",
    }
  }

  if (row.status === "released") {
    return { ok: false, error: "This line was already released.", reason: "not_active" }
  }

  if (row.status !== "active") {
    return { ok: false, error: "Only active lines can be released.", reason: "not_active" }
  }

  const activeCount = await countActivePhoneNumbers(userId)
  if (activeCount <= 1) {
    return {
      ok: false,
      error: "You need at least one business line. Buy or port another number before releasing this one.",
      reason: "last_line",
    }
  }

  const carrier = await releaseTelnyxPhoneNumber(row.number)
  if (!carrier.ok) {
    return { ok: false, error: carrier.error, reason: "carrier_error" }
  }

  const marked = await markPhoneNumberReleasedForUser(phoneNumberId, userId)
  if (!marked) {
    return { ok: false, error: "Could not update your account after releasing the line.", reason: "not_found" }
  }

  return { ok: true, phone_number: row.number }
}
