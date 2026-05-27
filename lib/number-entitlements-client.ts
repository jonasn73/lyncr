export type NumberEntitlements = {
  allowed: boolean
  reason: "tier_limit" | "insufficient_credit" | null
  message: string | null
  upgrade_message: string | null
  subscription_tier: string
  subscription_tier_label: string
  subscription_active: boolean
  upgrade_target_tier: string | null
  upgrade_target_label: string | null
  active_number_count: number
  line_limit: number
  carrier_credit: number
  provisioning_fee_usd: number
}

/** Load tier limits + carrier credit before opening the buy-number flow. */
export async function fetchNumberEntitlements(): Promise<NumberEntitlements> {
  const res = await fetch("/api/numbers/entitlements", { credentials: "include" })
  const json = (await res.json().catch(() => ({}))) as { data?: NumberEntitlements; error?: string }
  if (!res.ok || !json.data) {
    throw new Error(json.error || "Could not load number entitlements")
  }
  return json.data
}
