-- Advanced Automation Voice Greetings: bypass code, TTS persona, holiday override window.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS ivr_bypass_code TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ivr_voice_engine_model TEXT NOT NULL DEFAULT 'en-US-Standard-C',
  ADD COLUMN IF NOT EXISTS holiday_override_start TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS holiday_override_end TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS holiday_greeting_text TEXT DEFAULT NULL;

COMMENT ON COLUMN account_settings.ivr_bypass_code IS
  'Numeric DTMF sequence; when matched during automation Gather, dials owner cell and bypasses presence.';
COMMENT ON COLUMN account_settings.ivr_voice_engine_model IS
  'TTS persona / engine id for TeXML <Say voice=…> (dashboard AI Voice Persona).';
COMMENT ON COLUMN account_settings.holiday_override_start IS
  'Inclusive start of scheduled holiday closure (UTC).';
COMMENT ON COLUMN account_settings.holiday_override_end IS
  'Inclusive end of scheduled holiday closure (UTC).';
COMMENT ON COLUMN account_settings.holiday_greeting_text IS
  'Spoken TeXML when now is inside the holiday override window.';
