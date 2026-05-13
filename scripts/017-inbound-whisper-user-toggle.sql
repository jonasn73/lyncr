-- Per-account toggle: short spoken line-ID on the callee leg after they answer a forwarded call.
-- Default true so existing behavior is unchanged until the user turns it off in Settings.

ALTER TABLE users ADD COLUMN IF NOT EXISTS inbound_receptionist_whisper_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.inbound_receptionist_whisper_enabled IS 'When true, forwarded callee hears a short TeXML whisper (business name + line) before the caller is bridged.';
