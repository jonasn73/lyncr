// Traditional IVR menu settings — dashboard-controlled greeting + digit actions (no AI).

export const DEFAULT_IVR_GREETING_TEXT =
  "Thanks for calling Key Squad 5-0-2. We are fully booked today. Press 1 to receive a secure booking link by text. Press 2 to reserve our earliest priority slot tomorrow morning."

/** Supported keypress actions for Digits 1 / 2. */
export type IvrMenuAction = "sms_link" | "live_booking" | "voicemail"

export const IVR_MENU_ACTION_OPTIONS: {
  value: IvrMenuAction
  label: string
  description: string
}[] = [
  {
    value: "sms_link",
    label: "Send SMS Booking Link",
    description: "Texts a secure lyncr.app/book link to the caller, then hangs up.",
  },
  {
    value: "live_booking",
    label: "Auto-Book Next Day",
    description: "Reserves the earliest open block tomorrow and confirms by voice.",
  },
  {
    value: "voicemail",
    label: "Route to Voicemail",
    description: "Plays a short prompt and records a message.",
  },
]

export type IvrMenuSettings = {
  ivrGreetingText: string
  ivrOption1Action: IvrMenuAction
  ivrOption2Action: IvrMenuAction
}

export const DEFAULT_IVR_MENU_SETTINGS: IvrMenuSettings = {
  ivrGreetingText: DEFAULT_IVR_GREETING_TEXT,
  ivrOption1Action: "sms_link",
  ivrOption2Action: "live_booking",
}

export function normalizeIvrMenuAction(raw: unknown, fallback: IvrMenuAction): IvrMenuAction {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (v === "sms_link" || v === "sms_booking_link") return "sms_link"
  if (v === "live_booking" || v === "auto_book_next_day" || v === "priority_slot_tomorrow") {
    return "live_booking"
  }
  if (v === "voicemail") return "voicemail"
  return fallback
}

export function normalizeIvrMenuSettings(raw: Partial<{
  ivr_greeting_text?: string | null
  ivr_option1_action?: string | null
  ivr_option2_action?: string | null
  ivrGreetingText?: string | null
  ivrOption1Action?: string | null
  ivrOption2Action?: string | null
}> | null | undefined): IvrMenuSettings {
  const greeting =
    (typeof raw?.ivrGreetingText === "string" && raw.ivrGreetingText.trim()) ||
    (typeof raw?.ivr_greeting_text === "string" && raw.ivr_greeting_text.trim()) ||
    DEFAULT_IVR_GREETING_TEXT
  return {
    ivrGreetingText: greeting,
    ivrOption1Action: normalizeIvrMenuAction(
      raw?.ivrOption1Action ?? raw?.ivr_option1_action,
      DEFAULT_IVR_MENU_SETTINGS.ivrOption1Action
    ),
    ivrOption2Action: normalizeIvrMenuAction(
      raw?.ivrOption2Action ?? raw?.ivr_option2_action,
      DEFAULT_IVR_MENU_SETTINGS.ivrOption2Action
    ),
  }
}
