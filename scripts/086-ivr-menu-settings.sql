-- Dashboard-controlled traditional IVR menu (Gather prompt + digit actions).
-- Canonical on routing_config; denormalized on phone_numbers for /api/telnyx-menu webhook reads.

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS ivr_greeting_text TEXT NOT NULL DEFAULT
    'Thanks for calling Key Squad 5-0-2. Press 1 to book on your phone without talking to anyone, or Press 2 to ring our phone.',
  ADD COLUMN IF NOT EXISTS ivr_option1_action TEXT NOT NULL DEFAULT 'sms_link',
  ADD COLUMN IF NOT EXISTS ivr_option2_action TEXT NOT NULL DEFAULT 'live_booking';

COMMENT ON COLUMN routing_config.ivr_greeting_text IS
  'Spoken TeXML Gather prompt for traditional IVR (/api/telnyx-menu). Dashboard Greetings editor.';
COMMENT ON COLUMN routing_config.ivr_option1_action IS
  'Keypress 1 action: sms_link | live_booking | voicemail.';
COMMENT ON COLUMN routing_config.ivr_option2_action IS
  'Keypress 2 action: sms_link | live_booking | voicemail.';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS ivr_greeting_text TEXT,
  ADD COLUMN IF NOT EXISTS ivr_option1_action TEXT,
  ADD COLUMN IF NOT EXISTS ivr_option2_action TEXT;

COMMENT ON COLUMN phone_numbers.ivr_greeting_text IS
  'Denormalized IVR greeting for fast inbound TeXML menu reads.';
COMMENT ON COLUMN phone_numbers.ivr_option1_action IS
  'Denormalized IVR digit-1 action for /api/telnyx-menu.';
COMMENT ON COLUMN phone_numbers.ivr_option2_action IS
  'Denormalized IVR digit-2 action for /api/telnyx-menu.';
