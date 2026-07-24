// Global events so dashboard banner + settings rows open the same modals.

export const OPEN_CARRIER_REGISTRATION_MODAL_EVENT = "lyncr-open-carrier-registration-modal"
export const OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT = "lyncr-open-port-service-address-modal"
export const OPEN_SMS_AUTOMATION_MODAL_EVENT = "lyncr-open-sms-automation-modal"
export const OPEN_BUSINESS_PROFILE_MODAL_EVENT = "lyncr-open-business-profile-modal"
export const OPEN_BILLING_MODAL_EVENT = "lyncr-open-billing-modal"
export const OPEN_GET_PAID_MODAL_EVENT = "lyncr-open-get-paid-modal"
export const OPEN_ROUTING_STRATEGY_MODAL_EVENT = "lyncr-open-routing-strategy-modal"
export const OPEN_TEAM_INVITE_MODAL_EVENT = "lyncr-open-team-invite-modal"
export const CARRIER_REGISTRATION_UPDATED_EVENT = "lyncr-carrier-registration-updated"
/** Close the header Settings sheet (child screens open above / instead of under it). */
export const CLOSE_HEADER_SETTINGS_EVENT = "lyncr-close-header-settings"

/** Any of these means a Settings child UI is opening — Settings should close so it is not covering the child. */
export const SETTINGS_CHILD_OPEN_EVENTS = [
  OPEN_CARRIER_REGISTRATION_MODAL_EVENT,
  OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT,
  OPEN_SMS_AUTOMATION_MODAL_EVENT,
  OPEN_BUSINESS_PROFILE_MODAL_EVENT,
  OPEN_BILLING_MODAL_EVENT,
  OPEN_GET_PAID_MODAL_EVENT,
  OPEN_ROUTING_STRATEGY_MODAL_EVENT,
  OPEN_TEAM_INVITE_MODAL_EVENT,
] as const

export function closeHeaderSettings() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CLOSE_HEADER_SETTINGS_EVENT))
}

/** Optional payload when opening the carrier registration modal. */
export type CarrierRegistrationModalOpenDetail = {
  /** Open the editable form (e.g. after carrier rejection). */
  edit?: boolean
}

export function openCarrierRegistrationModal(detail?: CarrierRegistrationModalOpenDetail) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_CARRIER_REGISTRATION_MODAL_EVENT, { detail }))
}

export function openPortServiceAddressModal() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_PORT_SERVICE_ADDRESS_MODAL_EVENT))
}

export function openSmsAutomationModal() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_SMS_AUTOMATION_MODAL_EVENT))
}

export function openGetPaidModal() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(OPEN_GET_PAID_MODAL_EVENT))
}

export function notifyCarrierRegistrationUpdated() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(CARRIER_REGISTRATION_UPDATED_EVENT))
}
