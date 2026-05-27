import { formatUsdFromCents } from "@/lib/billing-pricing"
import { getTelnyxAccountBalance } from "@/lib/telnyx-billing"
import type { LyncrAdminMetrics } from "@/lib/types"

/** Admin-only snapshot of the shared Telnyx developer / routing wallet. */
export async function fetchTelnyxRoutingPoolForAdmin(): Promise<LyncrAdminMetrics["telnyx_routing_pool"]> {
  try {
    const telnyx = await getTelnyxAccountBalance()
    return {
      balance_label: formatUsdFromCents(Math.round(telnyx.balance_usd * 100)),
      available_credit_label: formatUsdFromCents(Math.round(telnyx.available_credit_usd * 100)),
    }
  } catch (e) {
    console.error("[lyncr-admin] Telnyx routing pool balance:", e)
    return null
  }
}
