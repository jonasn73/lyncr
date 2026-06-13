// Compact carrier rule banner for the porting interaction drawer.

import { isWirelessPortingContext } from "@/lib/porting-carrier-exceptions"
import type { PortingConversationItem, PortingOrder } from "@/lib/types"

export type CarrierLookupBanner = {
  /** Bold label prefix, e.g. "Carrier Rule for Twilio/Onvoy" */
  rule_label: string
  /** Single-line rule body (no intro/outro paragraphs). */
  rule_body: string
}

function carrierRuleLabel(currentCarrier: string): string | null {
  const lower = currentCarrier.toLowerCase()
  const isTwilio = lower.includes("twilio")
  const isOnvoy = lower.includes("onvoy")
  if (isTwilio && isOnvoy) return "Carrier Rule for Twilio/Onvoy"
  if (isTwilio) return "Carrier Rule for Twilio"
  if (isOnvoy) return "Carrier Rule for Onvoy"
  return null
}

/** One slim micro-alert line — null when no carrier-specific rule applies. */
export function buildCarrierLookupBanner(
  order: PortingOrder,
  conversation: PortingConversationItem[] = []
): CarrierLookupBanner | null {
  const carrierLabel = order.current_carrier?.trim() || ""
  const twilioOnvoyLabel = carrierRuleLabel(carrierLabel)

  if (twilioOnvoyLabel) {
    return {
      rule_label: twilioOnvoyLabel,
      rule_body:
        "US ports require the last 8 alpha-numeric characters of your Twilio Account SID as your Account Number, plus your dedicated Porting Transfer PIN generated inside your project console.",
    }
  }

  const snippets = conversation
    .slice(-6)
    .map((item) => item.body)
    .filter(Boolean)
  const wireless = isWirelessPortingContext({
    current_carrier: order.current_carrier,
    carrier_rejection_reason: order.carrier_rejection_reason,
    conversation_snippets: snippets,
  })

  if (wireless) {
    return {
      rule_label: `Carrier Rule for ${carrierLabel || "mobile carriers"}`,
      rule_body:
        "Use the 4-to-6 digit Transfer PIN from your carrier mobile app or security settings — not your account login password.",
    }
  }

  return null
}
