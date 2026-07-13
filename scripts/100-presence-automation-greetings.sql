-- Custom On-Job / Closed IVR Speak scripts (dashboard Automation Voice Greetings).
-- Stored on account_settings (same row as presence_status) so TeXML uses the owner's copy.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS on_job_greeting_text TEXT NOT NULL DEFAULT
    'Thanks for calling Key Squad. We''re actively on a live lockout service right now, but we are open. Press 1 to get our next open dispatch slot text straight to your device, or stay on the line.',
  ADD COLUMN IF NOT EXISTS closed_greeting_text TEXT NOT NULL DEFAULT
    'Thanks for calling Key Squad. Our mobile technicians are currently off-duty for the evening. You can book a priority appointment slot for tomorrow morning by pressing 1, or leave a voicemail.';

COMMENT ON COLUMN account_settings.on_job_greeting_text IS
  'TeXML Speak when presence_status = ON_JOB. Editable in Lines → Automation Voice Greetings.';
COMMENT ON COLUMN account_settings.closed_greeting_text IS
  'TeXML Speak when presence_status = CLOSED. Editable in Lines → Automation Voice Greetings.';
