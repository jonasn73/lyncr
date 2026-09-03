// Traditional IVR menu settings — dashboard-controlled greeting + digit actions (no AI).

export const DEFAULT_IVR_GREETING_TEXT =
  "Thanks for calling Key Squad 502. Press 1 to book on your phone without talking to anyone, or Press 2 to ring our phone."

/** Supported keypress actions for Digits 1 / 2. */
export type IvrMenuAction =
  | "sms_link"
  | "ring_phone"
  | "live_booking"
  | "voicemail"
  | "do_nothing"

export type IvrMenuSettings = {
  /** Spoken Gather prompt (also accepted as ivr_greeting in API payloads). */
  ivrGreetingText: string
  /** Digit 1 action (also digit_1_action). */
  ivrOption1Action: IvrMenuAction
  /** Digit 2 action (also digit_2_action). */
  ivrOption2Action: IvrMenuAction
  /** Off-duty master switch — inbound Redirect to /api/telnyx-menu when true. */
  ivrMenuEnabled: boolean
}

export const DEFAULT_IVR_MENU_SETTINGS: IvrMenuSettings = {
  ivrGreetingText: DEFAULT_IVR_GREETING_TEXT,
  ivrOption1Action: "sms_link",
  ivrOption2Action: "ring_phone",
  ivrMenuEnabled: false,
}

export function normalizeIvrMenuAction(raw: unknown, fallback: IvrMenuAction): IvrMenuAction {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (v === "sms_link" || v === "sms_booking_link") return "sms_link"
  if (v === "ring_phone" || v === "ring_owner" || v === "dial_owner" || v === "forward") {
    return "ring_phone"
  }
  if (v === "live_booking" || v === "auto_book_next_day" || v === "priority_slot_tomorrow") {
    return "live_booking"
  }
  if (v === "voicemail") return "voicemail"
  if (v === "do_nothing" || v === "none" || v === "noop") return "do_nothing"
  return fallback
}

export function normalizeIvrMenuSettings(raw: Partial<{
  ivr_greeting_text?: string | null
  ivr_greeting?: string | null
  ivr_option1_action?: string | null
  ivr_option2_action?: string | null
  digit_1_action?: string | null
  digit_2_action?: string | null
  ivr_menu_enabled?: boolean | string | null
  ivrGreetingText?: string | null
  ivrGreeting?: string | null
  ivrOption1Action?: string | null
  ivrOption2Action?: string | null
  digit1Action?: string | null
  digit2Action?: string | null
  ivrMenuEnabled?: boolean | null
}> | null | undefined): IvrMenuSettings {
  const greeting =
    (typeof raw?.ivrGreetingText === "string" && raw.ivrGreetingText.trim()) ||
    (typeof raw?.ivrGreeting === "string" && raw.ivrGreeting.trim()) ||
    (typeof raw?.ivr_greeting_text === "string" && raw.ivr_greeting_text.trim()) ||
    (typeof raw?.ivr_greeting === "string" && raw.ivr_greeting.trim()) ||
    DEFAULT_IVR_GREETING_TEXT

  const enabledRaw = raw?.ivrMenuEnabled ?? raw?.ivr_menu_enabled
  const ivrMenuEnabled =
    enabledRaw === true ||
    enabledRaw === "true" ||
    enabledRaw === "t" ||
    enabledRaw === "1"

  return {
    ivrGreetingText: greeting,
    ivrOption1Action: normalizeIvrMenuAction(
      raw?.ivrOption1Action ?? raw?.digit1Action ?? raw?.ivr_option1_action ?? raw?.digit_1_action,
      DEFAULT_IVR_MENU_SETTINGS.ivrOption1Action
    ),
    ivrOption2Action: normalizeIvrMenuAction(
      raw?.ivrOption2Action ?? raw?.digit2Action ?? raw?.ivr_option2_action ?? raw?.digit_2_action,
      DEFAULT_IVR_MENU_SETTINGS.ivrOption2Action
    ),
    ivrMenuEnabled,
  }
}
