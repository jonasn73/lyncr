/** Client-safe error codes returned when a tech invite SMS cannot send. */
export type TechInviteSmsErrorType =
  | "10DLC_BLOCK"
  | "PORTING"
  | "NO_SMS_LINE"
  | "INVALID_SENDER"
  | "OTHER"

export const TECH_INVITE_SMS_ERROR_HEADLINES: Record<TechInviteSmsErrorType, string> = {
  "10DLC_BLOCK":
    "Delivery Failed: This business line is missing 10DLC registration. Carrier spam filters may block URLs.",
  PORTING: "Business line still transferring — automatic invite texts are paused until the port completes.",
  NO_SMS_LINE: "No SMS-ready business line for this workspace yet.",
  INVALID_SENDER: "This workspace's business line is not set up for outbound SMS yet.",
  OTHER: "We couldn't send the invite text automatically.",
}
